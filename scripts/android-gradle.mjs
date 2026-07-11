// Cross-platform gradle wrapper runner for the Capacitor Android project.
// The npm scripts originally invoked `gradlew.bat` directly, which only works
// on Windows; this picks the right wrapper per platform.
//   node scripts/android-gradle.mjs assembleDebug
import { spawnSync } from "node:child_process"

const isWindows = process.platform === "win32"
const cmd = isWindows ? "gradlew.bat" : "./gradlew"
const args = process.argv.slice(2).length ? process.argv.slice(2) : ["assembleDebug"]

const res = spawnSync(cmd, args, {
  cwd: new URL("../android", import.meta.url).pathname,
  stdio: "inherit",
  shell: isWindows,
})
process.exit(res.status ?? 1)
