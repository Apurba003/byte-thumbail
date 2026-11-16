# Byte — changes in this round (for whoever continues)

Base: GitHub `craxyxyz/byte` main @ `ced5b11` (Byte 1.4.5.2). Everything below is a plain working-tree
change (no commit). `git diff` shows it all; `byte-1.4.6-changes.patch` applies with `git apply`.

**IMPORTANT — not compiled or run.** The workspace these edits were made in could not download Flutter/Dart,
so nothing was built, analysed or run. Every changed Dart file was syntax-checked with a Dart parser, and the
proxy's TypeScript was syntax-checked, but type errors and test results are unknown. First thing to do:

    flutter pub get
    flutter analyze && flutter test
    (cd supabase/functions/byte-proxy && BYTE_PROXY_NO_SERVE=1 deno test -A index_test.ts)

## 1. Tablet / Windows: full-screen lyrics poster (phones unchanged)
- `lib/ui/now_playing.dart`: in the wide player, when the lyrics go full screen (idle) the left column is no
  longer empty: a big HD cover (`_LyricsPoster`) with the song name + artists on a liquid-glass card under it.
  Shown only when `lyricsPosterScreen()` (Windows/Linux/macOS, or short side ≥ 600). A phone, even sideways, keeps
  lyrics-only. `lyricsPosterWidth()`: ~38 % wide, 320–560, always 440 left for the lyrics.
- `lib/ui/widgets.dart`: `Artwork(hd: true)` always asks for the 1080 picture and uses high-quality resampling.
- Tests: `test/v144_lyrics_default_test.dart` (3 new at the end).

## 2. Liquid glass everywhere
- `lib/ui/theme.dart`: `glassButtonBackground()` — Filled / Text / Outlined / Icon buttons are now glass
  (`ButtonStyle.backgroundBuilder` → `LiquidGlass`); Filled keeps the brand red as a ~90 % tint so white text stays
  readable. Chips get a see-through fill + bright edge.
- `lib/ui/glass.dart`: `LiquidGlass(material: false)` (a button's glass must not reset its label's text style);
  new `GlassDialogShell`.
- Solid surfaces turned to glass: audio-pipeline and Cast dialogs (`player_parts.dart`), "Bringing in…" dialog
  (`service_rows.dart`), two `AlertDialog`s → `GlassDialog` (`settings_screen.dart`, `music_apps.dart`),
  sync-help and re-pick sheets → `showByteSheet`, Listen-together `_Sheet` → `LiquidGlass`, report-problem
  SnackBar → glass `toast`.
- Not changed on purpose: Switch, Slider, PopupMenu (already styled), text fields.
- Check on a real device: the splash on glass buttons is drawn under the glass (press = stronger tint instead).

## 3. Bugs / hardening
- `lib/data/downloads.dart`: a failed download left its `.part` file on disk for good → now deleted; two
  downloads with the same "compatible" name could write the same `.part` → name counts as taken while a `.part`
  exists (also limit 50 → 1000 so the 50th duplicate can't overwrite).
- `supabase/functions/byte-proxy/index.ts`: rate limit keyed on the first `x-forwarded-for` entry, which a caller
  writes himself (unlimited requests by changing it) → uses `cf-connecting-ip`, else the last entry. Request
  bodies were read unbounded (memory abuse) → 2 MB cap, 413 above it. Tests added in `index_test.ts`.
  Redeploy: `supabase functions deploy byte-proxy --no-verify-jwt`.

## Noticed, not changed
- `byte_lt_update` (SQL) accepts a `p_state` of any size — add a size check if rooms get abused.
- `AppFullscreen._set` marks `active` before the window plugin confirms, so a refused call leaves it true.
