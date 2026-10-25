#!/usr/bin/env bash
# Builds the Android app with the Android SDK: an APK to install directly and an App Bundle (.aab)
# for Google Play, in build/android-out/. Needs Node 20+, JDK 17 and ANDROID_HOME.
# Set ANDROID_KEYSTORE_FILE and ANDROID_KEYSTORE_PASSWORD (and optionally ANDROID_KEY_ALIAS,
# ANDROID_KEY_PASSWORD) to sign with your upload key.
set -euo pipefail
cd "$(dirname "$0")/.."
export CI=1
NAME=$(node -p "const c=require('./autodeploy.config.json'); c.slug + '-' + c.version + '-' + c.buildNumber")

bash scripts/install-deps.sh
npx expo prebuild --platform android --no-install --clean

cd android
./gradlew assembleRelease bundleRelease --no-daemon --max-workers="${GRADLE_WORKERS:-2}" -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
cd ..

mkdir -p build/android-out
cp android/app/build/outputs/apk/release/app-release.apk "build/android-out/$NAME.apk"
cp android/app/build/outputs/bundle/release/app-release.aab "build/android-out/$NAME.aab"
echo "Built build/android-out/$NAME.apk and build/android-out/$NAME.aab"
