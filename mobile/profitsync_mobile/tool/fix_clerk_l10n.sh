#!/usr/bin/env bash
# clerk_flutter 0.0.15-beta ships ClerkSdkLocalizations as generated code that
# is NOT included in the published package, and its pubspec is missing
# `flutter: generate: true`. Without this, the app fails to compile with
# "'ClerkSdkLocalizations' isn't a type".
#
# This patches the cached package and generates the localizations. Re-run it
# whenever the pub cache is recreated (e.g. after `flutter pub cache clean`).
set -euo pipefail

PKG_DIR="$(find "${PUB_CACHE:-$HOME/.pub-cache}/hosted/pub.dev" -maxdepth 1 -type d -name 'clerk_flutter-*' | sort | tail -1)"
if [[ -z "${PKG_DIR}" ]]; then
  echo "clerk_flutter not found in pub cache. Run 'flutter pub get' first." >&2
  exit 1
fi
echo "Patching: ${PKG_DIR}"

# Add 'generate: true' under the top-level flutter: key if not already present.
if ! grep -qE '^[[:space:]]+generate:[[:space:]]*true' "${PKG_DIR}/pubspec.yaml"; then
  perl -0pi -e 's/^flutter:\s*\n/flutter:\n  generate: true\n/m' "${PKG_DIR}/pubspec.yaml"
fi

( cd "${PKG_DIR}" && flutter gen-l10n )

if ls "${PKG_DIR}/lib/generated/"*.dart >/dev/null 2>&1; then
  echo "OK: generated $(ls "${PKG_DIR}/lib/generated/")"
else
  echo "FAILED: localizations were not generated." >&2
  exit 1
fi
