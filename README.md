# NVDA Signal Center

A mobile-friendly Node.js dashboard using Twelve Data from the server only. It shows NVDA and QQQ 1-minute/5-minute feeds, market state, cache status, timestamps, technical indicators, and conservative LONG/SHORT/NO TRADE rules. It does not place trades.

## Requirements
- Node.js 18+
- A Twelve Data API key
- A host that supports a Node.js server and environment variables

## Run locally
1. Install Node.js 18 or newer.
2. In this folder, set `TWELVE_DATA_API_KEY` as an environment variable (do not paste it into `public/` files).
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Deploy from Android (suggested free-first route)
1. Create a private repository on GitHub.
2. Upload the files in this ZIP, keeping the `public` folder and its three files.
3. Create a Node web service at a hosting provider that supports Node apps (for example, Render; free availability and sleep limits can change).
4. Set build command to `npm install` (there are no third-party dependencies) and start command to `npm start`.
5. Add `TWELVE_DATA_API_KEY` as a server-side environment variable in the host dashboard.
6. Deploy, open the site, and check `/api/health` returns `ok: true` and `configured: true`.

## Tests
Run `npm test` to execute unit tests for indicator primitives, malformed/duplicate candle validation, and fail-closed market-state behavior. These tests do not validate live provider entitlement or guarantee profitability.

## API
- `GET /api/health`: reports whether the secret is configured, never returns the key.
- `GET /api/snapshot`: four feeds, provider status, app-cache status, market state, and signal summary.

## Important limitations
- Provider plan and delivery delay remain UNVERIFIED. HTTP 200 is not proof of real-time access.
- Market-state parsing is fail-closed: if Twelve Data's response cannot be understood, signal output is NO TRADE.
- Market-state endpoints and provider schemas can change; verify with your account's current Twelve Data documentation.
- The code uses a simple weekday/time regular-session guard in addition to the provider market-state response. It does not contain a complete exchange holiday/early-close calendar. A verified closed state disables signals; an unknown state disables signals.
- Signals are rule-based analytical suggestions, not predictions or financial advice. Backtest before considering real-money use.
- No automatic orders are placed.
- The app rate-limits to 20 requests per minute per client and caches successful API responses for 30 seconds.
