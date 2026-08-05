# KataGo Bridge

This service runs the official native KataGo analysis engine behind the Go web UI. It does not bundle a KataGo executable or neural-network model.

1. Download a compatible official Linux GPU KataGo build and a KataGo network.
2. Put them at `runtime/katago` and `runtime/model.bin.gz`.
   Ensure the Linux KataGo binary is executable (`chmod +x runtime/katago`).
3. Compute SHA-256 values and copy `.env.example` to `.env`.
4. Run `docker compose up --build`.

The container refuses to start the engine when either artifact checksum is missing or incorrect. The public site should reach this service only through the same-origin worker proxy. Direct public exposure is not supported.

For local UI development, set `KATAGO_PROXY_SECRET` in Vite and run the bridge with `NODE_ENV=development`; the browser still calls `/api/go/katago/*`.
