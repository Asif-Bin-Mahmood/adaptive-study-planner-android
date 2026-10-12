# Release signing and publishing

Releases are built and signed by `.github/workflows/release.yml` and published as
`study-planner.apk` on the repository's Releases page.

Android only installs an update over an existing app when both APKs are signed with the
**same key**. If the key is lost or changed, users must uninstall (deleting their local
data) to install a new version. Create the key once, back it up, and never replace it.
The workflow refuses to publish an APK whose certificate does not match the fingerprint
stored in the `RELEASE_CERT_SHA256` variable.

No keystore or password is stored in this repository.

## One-time setup

### 1. Create the keystore

Use a JDK 17+ `keytool` (Android Studio ships one in `jbr/bin`). PKCS12 keystores use one
password for both the store and the key, so enter the same password for both.

```sh
keytool -genkeypair -v -storetype PKCS12 \
  -keystore study-planner-release.p12 \
  -alias studyplanner -keyalg RSA -keysize 4096 -validity 10000
```

Keep the file outside the repository folder.

### 2. Back it up

Store the `.p12` file and its password in two places you control, for example a
password manager and an encrypted USB drive. Never upload it to GitHub, a chat or a
shared drive.

### 3. Note the certificate fingerprint

```sh
keytool -list -v -storetype PKCS12 -keystore study-planner-release.p12 -alias studyplanner
```

Copy the `SHA256:` value (for example `AB:CD:...`).

### 4. Add the GitHub Actions secrets and variable

In **Settings > Secrets and variables > Actions**:

| Tab | Name | Value |
| --- | --- | --- |
| Secrets | `ANDROID_KEYSTORE_BASE64` | the keystore file, base64-encoded (below) |
| Secrets | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| Secrets | `ANDROID_KEY_ALIAS` | `studyplanner` |
| Secrets | `ANDROID_KEY_PASSWORD` | the same password |
| Variables | `RELEASE_CERT_SHA256` | the fingerprint from step 3 |

Base64-encode the keystore without line breaks:

- macOS / Linux: `base64 < study-planner-release.p12 | tr -d '\n'`
- Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("study-planner-release.p12"))`

Paste the output straight into the secret and do not save it in a file.

### 5. Check the setup without publishing

Open **Actions > Release > Run workflow** on `main`. This builds and verifies a signed
APK but publishes nothing. It fails with a list of anything missing, and the
**Validate signing secrets** step reports (yes/no only) whether the keystore, alias and
key password work. "Password is not ASCII" from Gradle means a password secret contains
a line break, tab or non-ASCII character, often from copying; paste it again exactly.

## Publishing a version

1. Raise `version` in `package.json` (for example `1.0.0` to `1.0.1`). The Android
   `versionName` and `versionCode` are derived from it, and Android refuses an update
   whose `versionCode` is not higher.
2. Run `npm install --package-lock-only`, commit, and push to `main`.
3. Tag and push: `git tag v1.0.1 && git push origin v1.0.1`.

The workflow checks that the tag matches `package.json`, runs the type check, tests and
build, signs the APK, verifies the signature and certificate fingerprint, and creates
the release with the APK, its SHA-256 file and a changelog.

## Local signed builds

Create `android/keystore.properties` (ignored by Git):

```
storeFile=/absolute/path/to/study-planner-release.p12
storePassword=...
keyAlias=studyplanner
keyPassword=...
```

Then `npm run build && npx cap sync android && cd android && ./gradlew assembleRelease`.
Without signing details the release APK is unsigned and cannot be installed.

## Switching from a debug build

Debug builds use a different key. To move to the release build: in the debug app use
**Settings > Backup and restore > Export backup**, save the file outside the app,
uninstall the debug app, install `study-planner.apk`, then choose
**Restore from a backup file**.
