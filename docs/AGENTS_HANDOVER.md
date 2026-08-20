# Agent Handover

State of the work as of **2026-08-20**, branch `minimalstic_code`.

The other docs describe the system as it is designed. This one describes it as it is
*right now*: what is half-finished, what is untested against hardware, and which
mistakes have already been made here so you don't repeat them. Rewrite it when you hand
off; it is meant to rot and be replaced, not to accumulate.

## Read in this order

1. [CLAUDE.md](../CLAUDE.md) — the invariant and the traps. Non-negotiable.
2. This file — where the work actually stands.
3. [ARCHITECTURE.md](../ARCHITECTURE.md) — every file and function. Reference, not a read-through.
4. [measuring_pipeline.md](../measuring_pipeline.md) / [calibration_pipeline.md](../calibration_pipeline.md) — only when you touch the math.

Do not read the whole tree first. `sensor-dashboard.tsx` plus the hook you care about is
almost always the entire blast radius of a frontend change.

## Where the code lives

`minimalstic_code` is the working branch and the one that ships. `main` is six commits
behind it and should be treated as stale, not as truth. The other branches
(`balgrist`, `full_calibration`, `website_imrpovements`, `calibration_saving`) are
finished experiments kept for reference — don't branch from them, don't merge them.

## Uncommitted work in the tree

There is a **recordings-management feature sitting unstaged**. It is complete and
`npm run build` passes, but it has never run against live hardware. Either finish
verifying it or commit it — do not start unrelated work on top of it.

| File | What changed |
|---|---|
| `backend/app.py` | `?limit=` on the listing endpoint, `?from=&to=` row window on `/data`, new `/download` (verbatim CSV) and `PUT`/`DELETE` on `/api/recordings/<id>`. Derived metadata is now written back to a sidecar. |
| `backend/test_recordings.py` | Assertion self-check for `_slice_and_downsample`. New. |
| `utils/recordingApi.ts` | Clients for the above, plus `recordingDownloadUrl`. |
| `hooks/useRecentRecordings.ts` | `loadWindow`, `removeRecording`, `relabelRecording`; one shared `loadData` path. |
| `RecordingsBrowserModal.tsx` | Full archive with search, rename, two-step delete. New. |
| `RecentRecordingsTab.tsx` | Zoom range slider, "Browse All", export is now a link to the file. |
| `ui/slider.tsx` | Renders one thumb per value, so the same component does single and range. |

Two decisions in there that look like bugs until you see why:

**Export is an `<a href>`, not a re-serialisation of `selectedData`.** The chart data is
downsampled to ~1000 points and narrowed further while zoomed. Exporting it would hand a
researcher a thinned file labelled as their recording. If you "simplify" this back to
`exportToCsv`, you have reintroduced silent data loss.

**The zoom window is row positions, not sample numbers.** Sample numbers are absolute and
survive buffer trimming, so they don't index the file. The slider commits on release
(`onValueCommit`), not on drag, because every fetch re-reads the whole CSV.

## What is verified and what is not

`npm run build` is clean, and `python test_recordings.py` (run from `backend/`, it imports
`app`) passes. Neither touches hardware.

Unverified: the new endpoints against a real capture session, and delete/rename while a
recording is loaded in a compare slot. The `Messung_*` and `test_test_*` files in
`backend/saved_recordings/` are throwaway captures from testing this feature.

`backend/saved_recordings/` is now ignored except for three reference captures kept
deliberately: `just_hanging_*` (a clean hang), `reference_left_board_*` (single-board
baseline), and `alok_topRight_10kg_bottomRight_*` (a known 10 kg load — the one to check
calibration against). Your own captures land in the same directory and stay untracked.

The twelve other recordings were removed from the tip, but they are **still in history** —
about 40 MB of CSV that a clone still pays for. Only a history rewrite removes that, which
nobody has done because it breaks every existing clone. Live with it or plan it properly.

## Rules of engagement

**Never rotate on ingestion.** Read the invariant in CLAUDE.md. This has been broken once
and produced jump heights that were wrong by a factor nobody noticed for a while.

**There is no test runner and you should not add one.** `npm run build` (strict TS,
`noUnusedLocals`) is the gate. Non-trivial logic leaves behind one `assert`-based
`demo()` in the file's own module — `test_recordings.py` and `wallDeclineSelfCheck()` are
the two examples to copy. Extend those rather than starting a framework.

**Hardware config is data, not code.** Boards swapped in the GUI means reordering
`bridgeSerials` in `phidget_config.json`. Sensor readings off by a constant factor means
recalibrating. Reaching for a code change first is the wrong instinct here.

**Docs carry no line numbers**, and migration history ("this used to run on a Pi") belongs
in git rather than in a comment. Comments explain why: a physical ceiling, a threshold
that came from a real measurement, a trap.

## Things that will waste your afternoon

`docs/` was gitignored until this branch and is now tracked — sources only. The `.tex`,
the `.sty`, the screenshots under `docs/images/`, and the `.drawio` diagram source ship
with a clone (~4 MB). The built PDFs in `docs/GUIDES/` and the `.png`/`.svg` exports in
`docs/diagrams/` are ignored: rebuild them, don't commit them. If a guide won't compile
from a fresh clone, that is the bug to look for.

`backend/calibration_profiles.json` is also gitignored, so a fresh clone has no profiles
and the profiles modal looks broken when it isn't.

The bridges are single-open. If no board attaches while the logs look fine, something else
holds them: the Phidget Control Panel, or a second `app.py`. Flask runs with
`use_reloader=False` for exactly this reason — don't turn it back on.

Mock mode bypasses `parseSerialLine`, so "Zero Sensors" is greyed out without hardware.
Working as intended.

The bottom-right board has a history of misbehaving (see commit `8664fb0`).
`board_diagnostic.py` exists to answer whether a suspect board is a calibration problem
or a mechanical one before you spend a day recalibrating something that is physically
broken.
