// Headless iOS build for the Capacitor project — the xcodebuild analogue of
// scripts/android-gradle.mjs. Builds the App scheme for the iOS Simulator SDK so
// CI / a scripted smoke test can compile the app without opening Xcode. Device
// and App Store archive builds (signing, ExportOptions) come in native-06.
//
//   node scripts/ios-xcodebuild.mjs            # Debug simulator build
//   node scripts/ios-xcodebuild.mjs Release    # Release simulator build
//
// SPM packages are resolved into ios/DerivedData/SourcePackages (gitignored) so
// repeat builds are incremental. macOS + Xcode only.
import { spawnSync } from "node:child_process"

if (process.platform !== "darwin") {
  console.error("iOS builds require macOS + Xcode. Skipping (this is not macOS).")
  process.exit(1)
}

const configuration = process.argv[2] ?? "Debug"
const root = new URL("..", import.meta.url).pathname

const res = spawnSync(
  "xcodebuild",
  [
    "-project", "ios/App/App.xcodeproj",
    "-scheme", "App",
    "-sdk", "iphonesimulator",
    "-configuration", configuration,
    "-derivedDataPath", "ios/DerivedData",
    "-clonedSourcePackagesDirPath", "ios/DerivedData/SourcePackages",
    "build",
  ],
  { cwd: root, stdio: "inherit" },
)
process.exit(res.status ?? 1)
