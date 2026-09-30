# Building the Paylog app

The `android/` and `ios/` folders are generated from `app.json` by `npx expo prebuild`; don't edit them by hand.

## Android APK (on this Windows PC)

Needs Java 21 and the Android SDK (already installed on this PC: `C:\Program Files\Microsoft\jdk-21...` and
`%LOCALAPPDATA%\Android\Sdk`).

Windows limits path length and this project lives deep inside OneDrive, so build from a short drive letter.
In **PowerShell**:

```powershell
subst P: "$env:USERPROFILE\OneDrive\Desktop\paylog"      # once per PC restart
cd P:\mobile
npm install
npx expo prebuild --platform android --clean
cd android
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NODE_ENV = "production"
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
```

The APK is `P:\mobile\android\app\build\outputs\apk\release\app-release.apk`.

To use a different server: `$env:EXPO_PUBLIC_API_URL = "https://your-server"` before `gradlew`.

### Signing key (keep it safe!)

Release builds are signed with your private key `C:\Users\NIRMAL\.paylog\paylog-release.jks`. Its passwords are
in `C:\Users\NIRMAL\.gradle\gradle.properties` (lines starting `PAYLOG_UPLOAD_`).

- **Back up both files** (e.g. to a USB drive or a private cloud folder). Android only installs an update if it is
  signed with the same key; if you lose it, people must uninstall the app (losing nothing server-side) and reinstall.
- Never commit them to GitHub or paste them in chat.

### Install on your phone

1. Copy `app-release.apk` to the phone (USB cable, Google Drive, or email it to yourself).
2. Tap it. If Android asks, allow **Install unknown apps** for the app you opened it from.
3. Open **Paylog** and sign in with your usual account.
4. Add the widget: long-press an empty spot on the home screen → **Widgets** → **Paylog** → drag
   **Paylog quick note** onto the home screen.

## iPhone (iOS)

iOS apps can only be built on a Mac with Xcode, or in the cloud with Expo's **EAS Build**, which works from Windows:

1. Create a free account at https://expo.dev.
2. Join the **Apple Developer Program** (US$99/year). Apple requires it to install your own app on an iPhone.
3. In `P:\mobile` run `npx eas-cli@latest build --platform ios`. EAS asks for your Apple login, creates the
   certificates, and builds the app including the widget and the share extension.
4. Install it through **TestFlight**, or submit it to the App Store with `npx eas-cli@latest submit --platform ios`.

The iOS widget (`src/widgets/QuickNote.ios.tsx`) and share extension are configured in `app.json`, and EAS builds
them automatically. They have not been compiled yet, because this PC can't build iOS.

## Checks before a release

```
npx tsc --noEmit
npx expo lint
```
