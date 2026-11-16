# Byte for Android tablets: get the APK

The phone app and the tablet app are the same app. On a tablet (or any screen at least 820 dp wide) the tablet layout turns on by itself: the big HD cover with the song name next to the full-screen lyrics. Phones keep their layout.

## 1. Put this code on GitHub

Unzip the file, open a terminal in the `byte-main` folder, then:

    git remote add origin https://github.com/craxyxyz/byte-thumbail.git
    git push -u origin main

(If GitHub asks you to log in, use your own account or a personal access token.)

## 2. Download the APK

1. Open the repo on GitHub → **Actions** → **Android tablet build**.
2. Wait for the run to finish (about 15 to 25 minutes the first time).
3. Open the run → **Artifacts** → `byte-android-tablet` → download the zip.
4. Inside: `app-arm64-v8a-release.apk` (most tablets). Use `app-armeabi-v7a-release.apk` only for old 32-bit tablets.

## 3. Install on the tablet

Copy the APK to the tablet, open it, and allow "install unknown apps" for your file manager when asked.

## Signing (for updates)

The APK is signed with the debug key unless you add these secrets (Settings → Secrets and variables → Actions):

- `BYTE_KEYSTORE_B64`: your release keystore, encoded. On Linux or macOS: `base64 -w0 release.jks`. On Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.jks"))`
- `BYTE_STORE_PASSWORD`, `BYTE_KEY_PASSWORD`
- `BYTE_KEY_ALIAS` (only if it is not `apex`)

With the same key as before, the new APK updates the app you already have. Without it, the app installs as a new one and cannot update the old one. Never commit the keystore or `key.properties` to the repo (they are in `.gitignore`).

## If the build fails

Open the failed run, download the `byte-android-tablet` artifact (it includes `analyze.log` and `test.log`), and send those logs back. The analyze step stops the build on errors; the tests are reported but do not stop it yet.

## About the other workflow

`desktop.yml` also runs on every push and builds Windows, Linux, macOS and iPhone files. `handoff.yml` and `.github/scripts/handoff.sh` are a hand-off step: they upload encrypted build files to a third-party temporary host, and they do nothing unless a `DIST_KEY` secret is set. If you do not want that, delete both files.
