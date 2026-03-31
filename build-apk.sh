#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-apk.sh — Build Donna debug APK
#
# Prerequisites (run this on your local machine):
#   1. Android Studio installed (or Android command-line tools)
#      https://developer.android.com/studio
#   2. ANDROID_HOME / ANDROID_SDK_ROOT env var pointing to your SDK
#   3. Java 17+ installed
#   4. .env file configured (see .env.example)
#
# Google Cloud Console setup (one-time):
#   1. Create a project at https://console.cloud.google.com
#   2. Enable "Google Calendar API"
#   3. Create OAuth 2.0 credentials → Android type
#      - Package name: ai.donna.app
#      - SHA-1 fingerprint: run `keytool -keystore ~/.android/debug.keystore
#        -list -v -storepass android` and copy the SHA1
#   4. Also create Web Application credentials:
#      - Authorized JavaScript origins: http://localhost:5173
#   5. Put the Client ID in VITE_GOOGLE_CLIENT_ID in your .env
#      (Android: use the Web Client ID, not the Android-type one)
#   6. Add "donna://oauth2redirect" as a custom scheme redirect URI
#      in your Google Cloud Console → OAuth → Authorized redirect URIs
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "▸ Installing dependencies..."
npm ci

echo "▸ Building web assets..."
npm run build

echo "▸ Syncing Capacitor..."
npx cap sync android

echo "▸ Building debug APK..."
cd android
./gradlew assembleDebug --stacktrace

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  echo ""
  echo "✅ APK built successfully!"
  echo "   Location: android/$APK_PATH"
  echo ""
  echo "▸ Install on connected device:"
  echo "   adb install android/$APK_PATH"
  echo ""
  echo "▸ Or open android/ in Android Studio → Run ▶"
else
  echo "❌ Build failed — check output above"
  exit 1
fi
