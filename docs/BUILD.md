# Building the APK

The commands are for Windows PowerShell. On macOS or Linux use `./gradlew` instead of
`.\gradlew.bat` and `shasum -a 256` / `sha256sum` instead of `Get-FileHash`. Every push to
`main` also builds a debug APK in GitHub Actions (see `.github/workflows/android.yml`).

These steps build the debug APK and install it on your phone. You need about
10 GB of free disk space and an internet connection for the first build (Gradle
downloads the Android libraries once). The app itself never uses the internet.

## 1. Install the tools (once)

1. **Node.js 22 LTS or newer** from https://nodejs.org (Capacitor 8 requires Node 22+).
   Check in PowerShell: `node -v` should print v22 or higher.
2. **Android Studio** from https://developer.android.com/studio. Use a version that
   supports Android Gradle Plugin 8.13 (Narwhal 3 Feature Drop, 2025.1.3, or newer).
   During setup, accept the standard install. It includes the Android SDK and a
   bundled JDK 21.
3. In Android Studio: **More Actions > SDK Manager**.
   - *SDK Platforms*: tick **Android 16 (API 36)**.
   - *SDK Tools*: tick **Android SDK Build-Tools** and **Android SDK Platform-Tools**.
   - Click **Apply** and accept the licences.

## 2. Prepare the project

1. Clone the repository to a short path without spaces, for example
   `C:\dev\adaptive-study-planner-android`. Long paths can break Gradle on Windows.
2. Open PowerShell in that folder and run:

   ```powershell
   npm ci
   npm test
   npm run build
   npx cap sync android
   ```

   `npm ci` installs the exact versions in `package-lock.json`. `npm test` should
   report all tests passed. `npx cap sync android` copies the built app into
   `android\app\src\main\assets\public`.

## 3a. Build in Android Studio

1. **File > Open** and choose the `android` folder (not the project root).
2. Wait for "Gradle sync" to finish. If Studio offers to upgrade the Android Gradle
   Plugin, choose **Don't remind me** for now.
3. **Build > Build App Bundle(s) / APK(s) > Build APK(s)**.
4. The APK is at `android\app\build\outputs\apk\debug\app-debug.apk`.
   Studio's notification has a **locate** link.

## 3b. Or build from PowerShell

Android Studio's bundled JDK must be on the path for this shell:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd android
.\gradlew.bat assembleDebug
```

If Gradle says the SDK location is not found, create `android\local.properties`
containing (note the doubled backslashes):

```
sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

## 4. Record the checksum

```powershell
Get-FileHash android\app\build\outputs\apk\debug\app-debug.apk -Algorithm SHA256
```

Keep that value with the APK so you can tell copies apart later.

## 5. Install on your phone

**With a USB cable (recommended):**

1. On the phone: Settings > About phone > tap **Build number** seven times, then
   Settings > System > Developer options > turn on **USB debugging**.
2. Connect the phone, accept the prompt, then in Android Studio pick the phone in
   the device menu and press **Run**, or run:

   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r android\app\build\outputs\apk\debug\app-debug.apk
   ```

**Without a cable:** copy `app-debug.apk` to the phone, open it in Files, and allow
"Install unknown apps" for Files when asked.

## 6. First launch checklist

These native behaviours are not covered by the automated tests, so check them once on a device:

1. Tap **Create a semester** and finish the setup wizard. Today should show the date.
2. Log a sleep value, force-close the app (recent apps > swipe away), reopen it.
   The value should still be there.
3. Settings > Reminders > turn them on and tap **Send a test notification**. Android 13+
   asks for notification permission once.
4. Settings > Backup and restore > **Export backup**. The Share sheet should open with a `.json` file.
5. Press the phone's Back button while a sheet is open. It should close the sheet,
   not the app.

## Updating the app later

After changing anything under `src/`, run `npm run build` and `npx cap sync android`
again, then rebuild. Installing a newer debug APK over the old one keeps your data,
as long as both were signed with the same debug key (the same computer). A debug
APK from another computer will not install over this one without uninstalling,
which deletes the data. **Export a backup first.** For long-term use, follow
[RELEASE_SIGNING.md](RELEASE_SIGNING.md).

## Common problems

| Message | Fix |
| --- | --- |
| `SDK location not found` | Create `android\local.properties` as shown above. |
| `Unsupported class file major version` or a JDK error | Use Android Studio's bundled JDK 21 (`JAVA_HOME` above). |
| `Failed to find target with hash string 'android-36'` | Install Android 16 (API 36) in SDK Manager. |
| `npm ci` fails on Node version | Install Node 22 LTS or newer. |
| Blank white screen after install | You skipped `npm run build` / `npx cap sync android`. Run both and rebuild. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed copy was signed with another key. Export a backup, uninstall, install, restore. |
