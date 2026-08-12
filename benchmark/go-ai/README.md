# Go AI calibration

This harness uses the production `GoGameEngine` for legality, positional
superko, pass handling, and Chinese area scoring. It does not count engine
crashes, illegal moves, or timeouts as losses.

## 1. Sayuri stability screen

Keep KataGo resident, then run:

```powershell
npm run benchmark:sayuri
```

The script tests `(threads,batch)` = `(8,4)`, `(12,6)`, `(16,8)`, `(24,12)`
at the configured `SAYURI_PLAYOUTS` value (repository default: 250). Override
the screen without editing `.env` with `--playouts=500,250`. Sayuri GTP does
not expose the exact completed-playout count for `genmove`, so the report
records normal-return completion, latency, crash/OOM classification, and
concurrent KataGo residency without inventing a completed-playout confidence
claim. This 20-move screen selects a resource configuration; it is not a
strength or Elo result.

## 2. Two-model screen

Run two Sayuri bridges with the same 1,000 playout, thread, and batch settings,
one using each downloaded model. Then execute 20 fixed openings with colors
swapped (40 games):

```powershell
$env:GO_CALIBRATION_ENGINE_A='sayuri'
$env:GO_CALIBRATION_ENGINE_B='sayuri'
$env:GO_CALIBRATION_ENGINE_A_URL='http://127.0.0.1:8790/api/go/sayuri'
$env:GO_CALIBRATION_ENGINE_B_URL='http://127.0.0.1:8791/api/go/sayuri'
$env:GO_CALIBRATION_ENGINE_A_LABEL='CGF2026'
$env:GO_CALIBRATION_ENGINE_B_LABEL='rated-s4056000'
$env:GO_CALIBRATION_ENGINE_A_SHA256='864c7e51cf76ebe62f4c3f638ac829bd510acef47b69f08c15b5233fd0d0a973'
$env:GO_CALIBRATION_ENGINE_B_SHA256='3d6e592b08662e4e90fdfbab3dd3fd3ac0b2c91aa9cfc42163057b9a825fe206'
$env:GO_CALIBRATION_OPENINGS='20'
npm run calibrate:go-ai
```

Choose the model with more wins; at a difference of at most two games, keep the
newer CGF2026 model. A newer filename alone is not strength evidence.

## 3. KataGo coarse search and formal acceptance

Set `KATAGO_BATTLE_MATCHED_VISITS` in the ignored KataGo `.env`, restart only
the bridge, and use 10 openings (20 games) for each coarse candidate. The
candidate order is `2000,1000,500,250,125,64,32,16,8,4,2,1`; after first
entering 35%–65%, test the logarithmic midpoint of adjacent values.

For the final candidate, clear the engine override variables and run all 50
openings:

```powershell
Remove-Item Env:GO_CALIBRATION_ENGINE_A -ErrorAction SilentlyContinue
Remove-Item Env:GO_CALIBRATION_ENGINE_B -ErrorAction SilentlyContinue
$env:GO_CALIBRATION_OPENINGS='50'
npm run calibrate:go-ai
```

The default pairing is Sayuri as engine A and KataGo as engine B. A full run
creates 100 games and reports completion, wall time, timeout/crash/OOM/illegal
move counts, total/color win rates, and a game-level Wilson 95% interval. A
checkpoint is overwritten after every completed game. Acceptance requires all
100 games without a technical failure and the entire descriptive Wilson
interval to fall inside the predeclared 40%–60% practical-equivalence band.

These are 50 color-swapped positions derived from 13 base opening families by
rotation. The 100 game outcomes therefore are not independent. The Wilson
interval is supplied as a descriptive diagnostic and does not model the paired
or shared-family structure; neither partial reports nor the completed report
is an Elo estimate. A color-rate gap above 15 percentage points is flagged for
opening-set review. Reports are written under `reports/go-ai-calibration/`;
partial or technical-failure reports remain provisional and cannot justify a
matched-strength label or a battle-budget change.

## 4. 2026-08-11 local calibration result

Host: NVIDIA GeForce RTX 4050 Laptop GPU (6 GiB). Sayuri v0.10.0 used the
pinned CGF2026 B12 model at 250 playouts, 16 threads, and batch size 8. The
resource screen kept KataGo resident: all four settings completed 20/20 moves
without a crash or OOM; 16/8 had the lowest observed mean latency (299 ms).

KataGo coarse screens at 250 and 16 visits scored Sayuri 0/20 and 2/20. One
visit was technically unusable because KataGo returned no candidate. The
lowest usable value, 2 visits, scored Sayuri 5/20 in the coarse screen and was
therefore used only as the closest formal test candidate.

The formal 50-opening, color-swapped run at Sayuri 250 playouts versus KataGo
2 visits completed 100/100 games in 6,131,211 ms (1:42:11): Sayuri 29 wins,
KataGo 71, no draws, and zero timeout/crash/OOM/illegal/session failures.
Sayuri scored 32% as black and 26% as white; the descriptive game-level Wilson
95% interval was 21.0%–38.5%. Status: `not-matched`. The full local JSON report
is `reports/go-ai-calibration/calibration-2026-08-11T03-15-22-534Z-26308.json`
(SHA-256 `38a98fb8ba8d2fa225ef1ec70df4a953701f899ee7b853f4bd667de8f25922a7`).

This rejects a matched-strength label even at the lowest usable KataGo budget;
it is not an Elo result. The checked-in and local runtime defaults therefore
remain the explicitly conservative 250/250 values rather than presenting 2
visits as a proven match.
