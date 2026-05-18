#!/usr/bin/env bash
set -euo pipefail

# Build, Developer ID sign, notarize, staple, and verify the native macOS
# Otto Canvas app from apps/mac/otto.
#
# Prerequisites:
#   1. Developer ID Application certificate installed in Keychain.
#   2. A notarytool keychain profile, e.g.:
#        xcrun notarytool store-credentials otto-notary --team-id FRUHQC68JC
#
# Usage:
#   ./scripts/build-mac-otto-canvas-release.sh
#   ./scripts/build-mac-otto-canvas-release.sh --skip-notarize
#
# Environment overrides:
#   APPLE_TEAM_ID=FRUHQC68JC
#   NOTARY_PROFILE=otto-notary
#   SIGNING_IDENTITY="Developer ID Application: slashforge technologies private limited (FRUHQC68JC)"
#   OUTPUT_DMG=dist/otto-canvas-mac-arm64.dmg

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/apps/mac/otto/otto.xcodeproj"
SCHEME="otto"
CONFIGURATION="Release"
APP_NAME="Otto Canvas"
BUNDLE_ID="io.ottocode.canvas"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-FRUHQC68JC}"
NOTARY_PROFILE="${NOTARY_PROFILE:-otto-notary}"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-Developer ID Application: slashforge technologies private limited (FRUHQC68JC)}"
OUTPUT_DMG="${OUTPUT_DMG:-$ROOT/dist/otto-canvas-mac-arm64.dmg}"
SKIP_NOTARIZE=false

for arg in "$@"; do
  case "$arg" in
    --skip-notarize) SKIP_NOTARIZE=true ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Error: this release script must run on macOS." >&2
  exit 1
fi

command -v xcodebuild >/dev/null || { echo "Error: xcodebuild not found." >&2; exit 1; }
command -v xcrun >/dev/null || { echo "Error: xcrun not found." >&2; exit 1; }
command -v hdiutil >/dev/null || { echo "Error: hdiutil not found." >&2; exit 1; }

ARCHIVE_PATH="${ARCHIVE_PATH:-/tmp/otto-canvas.xcarchive}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-/tmp/otto-canvas-archive-dd}"
EXPORT_PATH="${EXPORT_PATH:-/tmp/otto-canvas-export}"
DMG_ROOT="${DMG_ROOT:-/tmp/otto-canvas-dmg-root}"
EXPORT_OPTIONS="${EXPORT_OPTIONS:-/tmp/otto-canvas-export-options.plist}"
APP_PATH="$EXPORT_PATH/$APP_NAME.app"

mkdir -p "$(dirname "$OUTPUT_DMG")"
rm -rf "$ARCHIVE_PATH" "$DERIVED_DATA_PATH" "$EXPORT_PATH" "$DMG_ROOT"

cat > "$EXPORT_OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>developer-id</string>
  <key>teamID</key>
  <string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>signingCertificate</key>
  <string>Developer ID Application</string>
  <key>stripSwiftSymbols</key>
  <true/>
</dict>
</plist>
PLIST

echo "=== Archiving $APP_NAME ==="
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=macOS' \
  -archivePath "$ARCHIVE_PATH" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  archive

echo "=== Exporting Developer ID app ==="
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates

if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: expected exported app not found: $APP_PATH" >&2
  find "$EXPORT_PATH" -maxdepth 2 -print >&2 || true
  exit 1
fi

echo "=== Creating DMG ==="
mkdir -p "$DMG_ROOT"
cp -R "$APP_PATH" "$DMG_ROOT/"
ln -s /Applications "$DMG_ROOT/Applications"
rm -f "$OUTPUT_DMG"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$DMG_ROOT" \
  -ov \
  -format UDZO \
  "$OUTPUT_DMG"

echo "=== Signing DMG ==="
codesign --force --sign "$SIGNING_IDENTITY" "$OUTPUT_DMG"

echo "=== Verifying signatures ==="
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign --verify --strict --verbose=2 "$APP_PATH/Contents/Resources/binaries/otto-darwin-arm64"
codesign --verify --verbose=2 "$OUTPUT_DMG"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Contents/Info.plist" | grep -qx "$BUNDLE_ID"
/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP_PATH/Contents/Info.plist" | grep -qx "$APP_NAME"

if [[ "$SKIP_NOTARIZE" == false ]]; then
  echo "=== Submitting DMG for notarization ==="
  xcrun notarytool submit "$OUTPUT_DMG" \
    --keychain-profile "$NOTARY_PROFILE" \
    --team-id "$APPLE_TEAM_ID" \
    --wait

  echo "=== Stapling notarization ticket ==="
  xcrun stapler staple "$OUTPUT_DMG"
  xcrun stapler validate "$OUTPUT_DMG"

  echo "=== Verifying Gatekeeper acceptance ==="
  spctl -a -vv -t open --context context:primary-signature "$OUTPUT_DMG"
else
  echo "Skipping notarization. DMG is signed but may show Gatekeeper warnings."
fi

echo ""
echo "Built: $OUTPUT_DMG"
ls -lh "$OUTPUT_DMG"
