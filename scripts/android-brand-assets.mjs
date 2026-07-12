// Rebuilds the @capacitor/assets source images in assets/ from the brand
// files in public/, then you run the generator to refresh the native icons:
//
//   node scripts/android-brand-assets.mjs
//   npx @capacitor/assets generate --android \
//     --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#ffffff' \
//     --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#ffffff'
//
// Outputs (all committed — they are the canonical icon/splash sources):
//   assets/icon-only.png       1024x1024  mark centered on white (legacy launcher)
//   assets/icon-foreground.png 1024x1024  mark at ~55% (adaptive-icon safe zone)
//   assets/icon-background.png 1024x1024  solid white
//   assets/splash.png          2732x2732  full lockup centered on white
//   assets/splash-dark.png     same as splash (the logo has a baked white bg)
//
// The generator also reformats AndroidManifest.xml (whitespace only) — discard
// that hunk with `git checkout android/app/src/main/AndroidManifest.xml`.
import sharp from "sharp"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(REPO, "assets")
mkdirSync(OUT, { recursive: true })
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
const LOGO = join(REPO, "public", "logo.png")

// Extract the mark from the 1254x1254 lockup. Measured on the current
// public/logo.png: the mark spans rows ~285-752, the wordmark starts at row
// 798 — the crop window ends at 775 (mid-gap) so no letter tops leak in.
// (Two passes: sharp runs trim/extract in a fixed internal order, so chaining
// them in one pipeline computes the extract against the trimmed image.)
const markWindow = await sharp(LOGO)
  .extract({ left: 330, top: 200, width: 600, height: 575 })
  .toBuffer()
const markTight = await sharp(markWindow)
  .trim({ background: "#ffffff", threshold: 40 })
  .toBuffer()
const markMeta = await sharp(markTight).metadata()
console.log(`mark tight bbox: ${markMeta.width}x${markMeta.height}`)

async function markOnCanvas(canvas, markSize, file) {
  const mark = await sharp(markTight)
    .resize(markSize, markSize, { fit: "inside" })
    .toBuffer()
  await sharp({
    create: { width: canvas, height: canvas, channels: 3, background: WHITE },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(file)
  console.log(`wrote ${file}`)
}

await markOnCanvas(1024, 820, join(OUT, "icon-only.png"))
await markOnCanvas(1024, 560, join(OUT, "icon-foreground.png"))

await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: WHITE },
})
  .png()
  .toFile(join(OUT, "icon-background.png"))
console.log("wrote icon-background.png")

// Splash: full lockup centered on a 2732x2732 white canvas, sized so the logo
// stays comfortably visible after the per-density center-crop.
const lockup = await sharp(LOGO)
  .trim({ background: "#ffffff", threshold: 40 })
  .toBuffer()
const lockupResized = await sharp(lockup)
  .resize(1100, 1100, { fit: "inside" })
  .toBuffer()
for (const name of ["splash.png", "splash-dark.png"]) {
  await sharp({
    create: { width: 2732, height: 2732, channels: 3, background: WHITE },
  })
    .composite([{ input: lockupResized, gravity: "center" }])
    .png()
    .toFile(join(OUT, name))
  console.log(`wrote ${name}`)
}
console.log("done")
