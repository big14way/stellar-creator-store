# Pitch video

The 3:45 pitch and demo video, kept as config so a re-cut is an edit plus one command. The narration, with scene start times, is in [narration.md](narration.md).

| File | What it is |
| --- | --- |
| `scenes.json` | What to record: the product scenes on the live site and the terminal replay |
| `record.js`, `term.html` | The recorder (Playwright, headed Chromium, fake cursor and click times) and the terminal page it replays logs in |
| `schedules/` | The live end-to-end run on 2202eb1 (33 of 33) and its replay timing |
| `files/` | The demo product listed on camera: six original SVG tiles, their zip and cover, and the script that makes them |
| `demo.json` | The cut: slides, narration, clip trims, captions and brand colours. Photos come from `app/public/photos` (credits in its `CREDITS.md`) |

Not in git: `clips/` (recordings), `creds/` (the test passkey wallets used on camera), `.build/` and `out/`.

## Re-cut

Needs ffmpeg, Python 3 with Pillow and edge-tts, and Node with Playwright (`npm i playwright` here, or set `PLAYWRIGHT_PATH`).

1. Record: `node record.js scenes.json` writes one clip per scene to `clips/`. The sell, buy and creator scenes sign in with the passkeys in `creds/creator.json` and `creds/buyer.json`; the first run creates them.
2. Build: run the pitch video build script on `demo.json`. It writes `out/paperstall-pitch.mp4`, caching narration in `.build/`.
3. Check the length, a contact sheet of frames, and the loudness (`ffmpeg -i out/paperstall-pitch.mp4 -af volumedetect -f null -`: mean about -17 dB, peak at or below -1.5 dB).
