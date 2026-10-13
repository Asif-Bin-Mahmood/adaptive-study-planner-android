# Study Planner

[![Android CI](https://github.com/Asif-Bin-Mahmood/adaptive-study-planner-android/actions/workflows/android.yml/badge.svg)](https://github.com/Asif-Bin-Mahmood/adaptive-study-planner-android/actions/workflows/android.yml)
[![Latest release](https://img.shields.io/github/v/release/Asif-Bin-Mahmood/adaptive-study-planner-android)](https://github.com/Asif-Bin-Mahmood/adaptive-study-planner-android/releases/latest)

An offline Android app for planning a semester's study, logging what actually happened,
and replanning when a day goes wrong.

<p>
  <img src="docs/screenshots/today.png" width="260" alt="Today screen">
  <img src="docs/screenshots/plan.png" width="260" alt="Weekly plan">
</p>

## Features

- **Any semester**: courses, labs, class times, exams and projects, set up in a short wizard
- **Today view**: one-tap Done, Partial or Missed, with a sleep and focus check-in
- **Replanning**: handles missed blocks, lost time, new deadlines and cancelled classes,
  and shows every change for confirmation before applying it
- **Practice**: timed sets, an error log and spaced retests
- **Progress**: weekly completion, accuracy and a short review
- **Reminders**: optional, and never during your sleep window
- **Backup**: export and restore a JSON file, with validation and undo

## Download

Get `study-planner.apk` from the [latest release](https://github.com/Asif-Bin-Mahmood/adaptive-study-planner-android/releases/latest)
and open it on a phone running Android 7.0 or newer. Each release lists the APK's
SHA-256 checksum.

## Privacy

All data stays in a SQLite database on your phone. There is no account, server,
analytics or tracking, the app makes no network requests, and Android cloud backup is
turned off. Data leaves the device only when you export a backup file.

## Building from source

Requires Node 22+, JDK 21 and the Android SDK (API 36).

```sh
npm ci
npm test
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Built with React, TypeScript, Vite, Capacitor and SQLite, and tested with Vitest.

## Documentation

- [Building and installing](docs/BUILD.md)
- [Database schema](docs/DATABASE.md)
- [Release signing](docs/RELEASE_SIGNING.md)
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)

## License

No license has been chosen yet, so all rights are reserved.
