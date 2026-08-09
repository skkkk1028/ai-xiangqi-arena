# Native Leela Zero bridge

This local-only service adapts the official Leela Zero 0.17 Windows OpenCL
binary and the final official 40x256 network to the Go module's provider-neutral
`AIEngine` contract. It binds to `127.0.0.1:8789`; it is not a hosted or paid
inference service.

## Setup

From the repository root on Windows:

```powershell
pnpm setup:leela-zero
```

The setup script downloads directly from the official GitHub release and
`zero.sjeng.org`, verifies fixed SHA-256 values, extracts into the ignored
`runtime/` directory, and writes the ignored `.env` file. The double-click
preview script runs this setup automatically when `.env` is absent.

Pinned artifacts:

- `leela-zero-0.17-win64.zip`, SHA-256
  `4c47471be2f2a16cba65766943e87d4cca9d41e09a05a2108b34d42cecaaab3d`
- final network `0e9ea880fd3c4444695e8ff4b8a36310d2c03f7c858cadd37af3b76df1d1d15f.gz`,
  compressed-file SHA-256
  `6937f00970b368c3a7f686f7152d3c0fc491a1ad580258c257de4d2bc58ac00d`

The hash in the network filename identifies the uncompressed network content;
it is intentionally different from the gzip file's SHA-256.

## Match budget and limitations

- Leela Zero: 3200 playouts, 180-second hard timeout, 8 search threads.
- KataGo in the new AI battle mode only: existing `fast` profile, 2000 visits.
- Existing KataGo self-play remains selectable at 2000/20000 visits and is not
  routed through this service.
- Leela Zero 0.17 provides no score estimate through the command path used here,
  so the UI does not invent or display a Leela Zero win rate.
- Engine output is always validated by the existing Go rules engine before a
  move is applied.

These budgets are an engineering starting point, not a measured Elo equality.
A defensible strength comparison requires a color-swapped multi-game match on
the target hardware.
