// Regenerates the iOS app icon + launch splash from the SHARED brand sources in
// assets/ — the exact same images the Android pipeline consumes
// (scripts/android-brand-assets.mjs writes them from public/logo.png). Keeping
// both platforms on one source of truth means the two apps never drift.
//
//   node scripts/ios-brand-assets.mjs
//
// Sources (committed, produced by scripts/android-brand-assets.mjs):
//   assets/icon-only.png   1024x1024  brand mark centered on white  → app icon
//   assets/splash.png      2732x2732  full lockup centered on white → launch splash
//
// iOS requirements this script enforces:
//   - App icons MUST be opaque (no alpha) or App Store validation rejects them,
//     so every output is flattened onto white and stripped of its alpha channel.
//   - The modern single 1024x1024 "universal" icon (Contents.json already points
//     at AppIcon-512@2x.png) — Xcode downsamples the rest at build time.
//   - Capacitor's Splash.imageset uses one 2732x2732 image at @1x/@2x/@3x.
import sharp from "sharp"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const A = (p) => join(REPO, p)
const WHITE = { r: 255, g: 255, b: 255 }

const ICON_SRC = A("assets/icon-only.png")
const SPLASH_SRC = A("assets/splash.png")
const ICON_OUT = A("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
const SPLASH_OUTS = [
  A("ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png"),
  A("ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png"),
  A("ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png"),
]

async function opaqueSquare(src, size) {
  return sharp(src)
    .resize(size, size, { fit: "contain", background: WHITE })
    .flatten({ background: WHITE }) // composite over white → drop transparency
    .removeAlpha() // 3-channel RGB: iOS rejects icons with an alpha channel
    .png()
    .toBuffer()
}

async function main() {
  const icon = await opaqueSquare(ICON_SRC, 1024)
  await sharp(icon).toFile(ICON_OUT)
  console.log(`wrote ${ICON_OUT} (1024x1024, opaque)`)

  const splash = await opaqueSquare(SPLASH_SRC, 2732)
  for (const out of SPLASH_OUTS) {
    await sharp(splash).toFile(out)
    console.log(`wrote ${out} (2732x2732, opaque)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
