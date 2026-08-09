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
at 20,000 playouts. It falls back to 10,000 and then 5,000 only when no
configuration completes all 20 requested moves within 180 seconds. Sayuri GTP
does not expose the exact completed-playout count for `genmove`, so the report
records that the 95% completion number is not directly observable instead of
inventing it.

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
creates 100 games, reports total/color win rates and a Wilson 95% interval, and
fails acceptance unless Sayuri is within 40%–60%. A color-rate gap above 15
percentage points is flagged for opening-set review. Reports are written under
`reports/go-ai-calibration/`; partial or technical-failure reports remain
provisional and cannot be used to update the battle-matched value.
