#!/usr/bin/env bash
# Builds the iOS app with Xcode (macOS only), into build/ios-out/.
#  - With IOS_P12_BASE64 (+ IOS_P12_PASSWORD) and IOS_PROFILE_BASE64: a signed .ipa
#    (IOS_EXPORT_METHOD: app-store-connect (default), release-testing for ad hoc, or enterprise).
#    With APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID and APP_STORE_CONNECT_KEY_BASE64
#    it is also uploaded to App Store Connect (TestFlight).
#  - Without signing secrets: an unsigned simulator build, to check that the app builds and runs.
set -euo pipefail
cd "$(dirname "$0")/.."
export CI=1
TMP=${RUNNER_TEMP:-$(mktemp -d)}
NAME=$(node -p "const c=require('./autodeploy.config.json'); c.slug + '-' + c.version + '-' + c.buildNumber")
BUNDLE_ID=$(node -p "require('./app.json').expo.ios.bundleIdentifier")

bash scripts/install-deps.sh
npx expo prebuild --platform ios --clean

WS=$(ls -d ios/*.xcworkspace | head -1)
SCHEME=$(basename "$WS" .xcworkspace)
OUT="$PWD/build/ios-out"
mkdir -p "$OUT"

if [ -z "${IOS_P12_BASE64:-}" ] || [ -z "${IOS_PROFILE_BASE64:-}" ]; then
  echo "::warning::No iOS signing secrets (IOS_P12_BASE64, IOS_PROFILE_BASE64): building an unsigned simulator app. Add them to get an .ipa for the App Store or TestFlight."
  xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$TMP/dd" CODE_SIGNING_ALLOWED=NO -quiet build
  APP=$(ls -d "$TMP"/dd/Build/Products/Release-iphonesimulator/*.app | head -1)
  ditto -c -k --keepParent "$APP" "$OUT/$NAME-simulator.zip"
  echo "Built $OUT/$NAME-simulator.zip"
  exit 0
fi

# Signing certificate in a temporary keychain
KC="$TMP/build.keychain-db"
KCP=$(openssl rand -hex 16)
security create-keychain -p "$KCP" "$KC"
security set-keychain-settings -lut 21600 "$KC"
security unlock-keychain -p "$KCP" "$KC"
echo "$IOS_P12_BASE64" | base64 --decode > "$TMP/cert.p12"
security import "$TMP/cert.p12" -P "${IOS_P12_PASSWORD:-}" -A -t cert -f pkcs12 -k "$KC"
security set-key-partition-list -S apple-tool:,apple: -k "$KCP" "$KC" >/dev/null
security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')

# Provisioning profile
PROFILE="$TMP/app.mobileprovision"
echo "$IOS_PROFILE_BASE64" | base64 --decode > "$PROFILE"
security cms -D -i "$PROFILE" > "$TMP/profile.plist"
UUID=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$TMP/profile.plist")
TEAM=$(/usr/libexec/PlistBuddy -c 'Print TeamIdentifier:0' "$TMP/profile.plist")
for d in "$HOME/Library/MobileDevice/Provisioning Profiles" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
  mkdir -p "$d"
  cp "$PROFILE" "$d/$UUID.mobileprovision"
done

# Manual signing on the app target only (CocoaPods targets stay unsigned)
TEAM="$TEAM" UUID="$UUID" IDENTITY="${IOS_CODE_SIGN_IDENTITY:-Apple Distribution}" ruby -e '
  require "xcodeproj"
  project = Xcodeproj::Project.open(Dir["ios/*.xcodeproj"].first)
  project.targets.select { |t| t.product_type == "com.apple.product-type.application" }.each do |t|
    t.build_configurations.each do |c|
      c.build_settings["CODE_SIGN_STYLE"] = "Manual"
      c.build_settings["DEVELOPMENT_TEAM"] = ENV["TEAM"]
      c.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = ENV["UUID"]
      c.build_settings["CODE_SIGN_IDENTITY"] = ENV["IDENTITY"]
    end
  end
  project.save
'

cat > "$TMP/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>${IOS_EXPORT_METHOD:-app-store-connect}</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>manual</string>
  <key>provisioningProfiles</key><dict><key>$BUNDLE_ID</key><string>$UUID</string></dict>
</dict></plist>
PLIST

xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' -archivePath "$TMP/App.xcarchive" -quiet archive
xcodebuild -exportArchive -archivePath "$TMP/App.xcarchive" -exportOptionsPlist "$TMP/ExportOptions.plist" -exportPath "$TMP/export"
IPA=$(ls "$TMP"/export/*.ipa | head -1)
cp "$IPA" "$OUT/$NAME.ipa"
echo "Built $OUT/$NAME.ipa"

if [ -n "${APP_STORE_CONNECT_KEY_ID:-}" ] && [ -n "${APP_STORE_CONNECT_ISSUER_ID:-}" ] && [ -n "${APP_STORE_CONNECT_KEY_BASE64:-}" ]; then
  mkdir -p "$HOME/.appstoreconnect/private_keys"
  echo "$APP_STORE_CONNECT_KEY_BASE64" | base64 --decode > "$HOME/.appstoreconnect/private_keys/AuthKey_$APP_STORE_CONNECT_KEY_ID.p8"
  xcrun altool --upload-app -t ios -f "$OUT/$NAME.ipa" --apiKey "$APP_STORE_CONNECT_KEY_ID" --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"
  echo "Uploaded to App Store Connect. It shows up in TestFlight after Apple finishes processing."
fi
