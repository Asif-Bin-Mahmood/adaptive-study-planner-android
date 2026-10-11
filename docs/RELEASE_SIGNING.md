# Signed release build

A debug APK is fine for your own phone. Build a signed release if you want a build
you can keep updating for years, or install on more than one phone, without losing
data. Android only installs an update over an existing app when both are signed with
the same key. **If you lose the key, you can never update that install again.** You
would have to export a backup, uninstall, install the new build and restore.

No keys or passwords are included in this repository. You create them once.

## 1. Create a keystore (once)

In PowerShell, using Android Studio's JDK:

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v `
  -keystore C:\keys\study-planner-release.jks `
  -alias studyplanner -keyalg RSA -keysize 4096 -validity 10000
```

Choose a strong password and answer the name questions (any values are fine).
Keep the `.jks` file **outside** the project folder.

Or in Android Studio: **Build > Generate Signed App Bundle / APK > APK > Create new…**.

## 2. Tell Gradle where it is

Create `android\keystore.properties` (it is listed in `.gitignore` and must never be
shared or zipped):

```
storeFile=C:\\keys\\study-planner-release.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=studyplanner
keyPassword=YOUR_KEY_PASSWORD
```

`android/app/build.gradle` reads this file only if it exists. Without it, release
builds are produced unsigned.

## 3. Build

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleRelease
Get-FileHash app\build\outputs\apk\release\app-release.apk -Algorithm SHA256
```

Before each new release, raise `versionCode` (and `versionName`) in
`android/app/build.gradle`. Android refuses to install an update with the same or a
lower `versionCode`.

## 4. Switching from the debug build

Debug and release builds are signed with different keys, so Android will not install
one over the other. Once only:

1. In the debug app: Settings > Backup and restore > **Export backup**, and save the
   file somewhere outside the app (Files, a USB copy).
2. Uninstall the debug app. **This deletes its data.**
3. Install the release APK.
4. On the first-run screen choose **Restore from a backup file**.

## 5. Keep the key safe

- Store the `.jks` file and both passwords in two places you control, for example an
  encrypted USB drive and a password manager.
- Never upload the keystore or `keystore.properties` to GitHub, Drive or a chat.
- `keytool -list -v -keystore C:\keys\study-planner-release.jks` shows the
  certificate fingerprint. Note it down so you can confirm later builds use the
  same key (`apksigner verify --print-certs app-release.apk`).
