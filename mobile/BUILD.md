# Building the Paylog app

The `android/` and `ios/` folders are generated from `app.json` by `npx expo prebuild`; don't edit them by hand.

## Android APK (on this Windows PC)

Needs Java 21 and the Android SDK (already installed on this PC: `C:\Program Files\Microsoft\jdk-21...` and
`%LOCALAPPDATA%\Android\Sdk`).

One command does everything. In **PowerShell**, from the `mobile` folder:

```powershell
.\scripts\build-android.ps1
```

It copies the source to `C:\pl\mobile` (a short local folder: React Native's native build breaks on long Windows
paths, and building inside OneDrive would sync gigabytes of build files), installs packages, generates the
Android project and builds. The finished APK is copied to **`mobile\dist\paylog.apk`**.

- Test build for the Android emulator, talking to the backend on this PC (`http://10.0.2.2:5001`):
  `.\scripts\build-android.ps1 -Emulator`
- Different server: `.\scripts\build-android.ps1 -ApiUrl https://your-server`

The first build takes 10–20 minutes; later ones are faster.

### Signing key (keep it safe!)

Release builds are signed with your private key `C:\Users\NIRMAL\.paylog\paylog-release.jks`. Its passwords are
in `C:\Users\NIRMAL\.gradle\gradle.properties` (lines starting `PAYLOG_UPLOAD_`).

- **Back up both files** (e.g. to a USB drive or a private cloud folder). Android only installs an update if it is
  signed with the same key; if you lose it, people must uninstall the app (losing nothing server-side) and reinstall.
- Never commit them to GitHub or paste them in chat.

### Install on your phone

1. Copy `dist\paylog.apk` to the phone (USB cable, Google Drive, or email it to yourself).
2. Tap it. If Android asks, allow **Install unknown apps** for the app you opened it from.
3. Open **Paylog** and sign in with your usual account.
4. Add the widget: long-press an empty spot on the home screen → **Widgets** → **Paylog** → drag
   **Paylog quick note** onto the home screen.

## iPhone (iOS)

iOS apps can only be built on a Mac with Xcode, or in the cloud with Expo's **EAS Build**, which works from Windows:

1. Create a free account at https://expo.dev.
2. Join the **Apple Developer Program** (US$99/year). Apple requires it to install your own app on an iPhone.
3. In the `mobile` folder run `npx eas-cli@latest build --platform ios`. EAS asks for your Apple login, creates the
   certificates, and builds the app including the widget and the share extension.
4. Install it through **TestFlight**, or submit it to the App Store with `npx eas-cli@latest submit --platform ios`.

The iOS widget (`src/widgets/QuickNote.ios.tsx`) and share extension are configured in `app.json`, and EAS builds
them automatically. They have not been compiled yet, because this PC can't build iOS.

## Checks before a release

```
npx tsc --noEmit
npx expo lint
```
