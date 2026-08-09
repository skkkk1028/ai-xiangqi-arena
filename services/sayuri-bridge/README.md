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

The CGF2026 model is the provisional default. Its newer filename is not treated
as proof of superior strength; the paired 40-game model screen and the full
100-game engine calibration must be recorded before changing that status.
