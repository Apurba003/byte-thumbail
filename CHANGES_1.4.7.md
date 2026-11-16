# Byte 1.4.7 (tablet / Windows) — fixes and what was checked

Base: `byte-main-1_4_6-fixed.zip`. The 1.4.6 tablet lyrics poster and liquid
glass work is kept as it was. This round fixes bugs and security issues found
by reading the code and by running the server parts.

## IMPORTANT: what was and was not verified

- **Not compiled.** The build environment could not download the Flutter or
  Dart SDK (blocked), so `flutter analyze` and `flutter test` were NOT run.
  All 289 Dart files were checked for syntax with a Dart parser (0 errors).
  Type errors are still possible. Run this first:
      flutter pub get && flutter analyze && flutter test
- **Proxy (TypeScript):** `deno check` passes. `index_test.ts` has 17 tests
  (10 existing, 7 new); all 17 pass when run with a local stand-in for
  `jsr:@std/assert` (jsr.io was blocked). On your machine run:
      cd supabase/functions/byte-proxy && BYTE_PROXY_NO_SERVE=1 deno test -A index_test.ts
- **Database (SQL):** run on PostgreSQL 16 with the project's own
  `check/shim.sql` and `check/checks.sql`: fresh install passes; re-running the
  new setup on a database that already has the 1.4.6 setup passes; anon can no
  longer read `byte_listen_rooms` directly.

## Security and bug fixes

1. **Anyone could list every live party (SQL + app).** `byte_listen_rooms` was
   readable by anonymous users, so anyone could see every party code, host name
   and what was playing. Now the table is closed to clients and a guest reads one
   room with `byte_lt_get(code)`. `lib/data/party_net.dart` `readRoom` calls it.
2. **Request body was buffered before the size check (proxy).** A chunked upload
   with no Content-Length was read whole into memory first. Test: a 50 MB stream
   was fully read by the old code; the new `readBodyCapped` stops at about 2 MB
   and returns 413.
3. **307/308 redirects dropped the POST body (proxy).** The body is now kept for
   307/308. 301/302/303 still become a GET with no body. A redirect that leaves the
   allowlist is still not followed.
4. **Bad `BYTE_PROXY_RPM` blocked everything (proxy).** A blank or non-numeric value
   became a limit of 0. It now falls back to 300.
5. **Full-screen state stuck on (`AppFullscreen._set`).** When the platform refused,
   `active` stayed `true` and the resume listener kept re-asking. It now resets.
6. **Cast accepted any certificate from any host (`cast_session.dart`).** The
   self-signed certificate is now accepted only for private, loopback, link-local
   or `.local` addresses. Cast devices are on the home network, so they still work.
7. **Party state size.** `byte_lt_open` and `byte_lt_update` now refuse state over
   30 KB with a clear error (code 54000). The 1.4.6 note said the size was not
   limited; that was wrong, the table already had a CHECK constraint, but the error
   is now clear.
8. **Older app versions after the SQL change.** A permission error (42501) is now
   treated like "server setup missing": the party runs on the live channel instead
   of failing to join. Old 1.4.5 phones can still join; they just do not get the
   saved late-join state.

## Deploy steps

1. Supabase → SQL Editor → run `supabase/Byte-v1.3.1-setup.sql` again (safe to re-run).
2. Redeploy the proxy: `supabase functions deploy byte-proxy --no-verify-jwt`
3. Build: `flutter build windows --release` (or the GitHub workflow), and the
   Android APK as before.

## Known and deliberately not changed

- `android:usesCleartextTraffic="true"` stays on. WebDAV / NAS servers on plain
  http and the Kugou lyrics host (`http://mobilecdn.kugou.com`) need it. Moving to a
  network security config with per-domain rules is the proper fix, but it needs
  device testing.
- `⋯` popup menus get a translucent glass tint, not a blur. Flutter's native popup
  menu cannot be blurred from the theme alone.
- The lyrics poster appears only in the wide layout, which starts at 820 dp. A tablet
  in portrait narrower than 820 dp uses the phone layout and shows no poster.
- The proxy's rate limit is per function instance. Supabase may run several
  instances, so the real limit can be higher than 300 per minute.
- Anonymous users can still create many party rooms and device rows (`byte_lt_open`,
  `byte_ping`). Adding a cap needs a decision on the limit first.

## Not verified here (check on a device)

- The 1.4.6 lyrics poster and liquid glass: layout, look and speed on a real tablet
  and on Windows.
- Whether the whole project compiles (see the top of this file).
