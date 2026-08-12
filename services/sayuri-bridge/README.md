# Sayuri Bridge

This local-only service adapts the official GPLv3 Sayuri v0.10.0 GTP engine to
the Go UI's common AI contract. It never bundles the executable or weights.

Run `npm run setup:sayuri` once to download the official CUDA 12 Windows archive
and two official model candidates, verify pinned SHA-256 hashes, and write the
ignored `.env`. The bridge listens only on `127.0.0.1:8790` and loads the model
only when Sayuri is first selected.

The v0.10.0 executable's `--help` confirms `-t/--threads`, `-p/--playouts`, and
`-b/--batch-size`. It does not expose an Elo-producing benchmark command.
Thread/batch selection therefore uses measured completion, latency, crash/OOM
behavior, and concurrent KataGo residency rather than a claimed benchmark Elo.

The repository uses a conservative 250-playout match default with 16 threads
and batch size 8. On the calibration host, the 2026-08-11 stability screen kept
KataGo resident and completed 20/20 moves for every tested resource setting;
16/8 had the lowest observed mean latency (299 ms) without a crash or OOM.
That short screen supports the resource choice only. It does not prove that
Sayuri 250 playouts matches KataGo 250 visits.

The CGF2026 model is the provisional default. Its newer filename is not treated
as proof of superior strength; the paired 40-game model screen and the full
100-game engine calibration must be recorded before changing that status. The
formal harness records checkpoints and explicitly treats its color-swapped,
rotation-related games as correlated samples, not an Elo experiment.

The 2026-08-11 formal local run did not establish a match. Even against the
lowest usable KataGo budget (2 visits; 1 visit returned no candidates), Sayuri
won 29/100 with a descriptive Wilson 95% interval of 21.0%–38.5%. All 100
games completed without timeout, crash, OOM, illegal move, or session failure.
The UI and repository therefore retain conservative values and do not claim
equal strength or an Elo relationship.
