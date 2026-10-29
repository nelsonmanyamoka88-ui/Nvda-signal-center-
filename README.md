# Trading Signal Center

A mobile-friendly signal dashboard for **stocks, forex, and crypto**. It uses Twelve Data for live candles and an optional OpenAI API key for an AI review of a transparent technical snapshot.

## Important: what this app does (and doesn't do)

- **Live candles:** only when `TWELVE_DATA_API_KEY` is configured and the provider returns valid candles.
- **Signal engine:** a deterministic EMA(9)/EMA(21)/RSI(14) technical scoring system calculates BUY / SELL / WAIT, entry, and ATR-style stop/target estimates.
- **Optional AI review:** if `OPENAI_API_KEY` is configured, an OpenAI model reviews the calculated snapshot and returns a separate assessment. Without it, the app explicitly says AI review is not configured. The base signal is rules-based, not generative AI.
- It does not execute trades, guarantee performance, or know news/fundamentals unless you add those sources.
- Market data coverage, delays, rate limits, and supported symbols depend on the provider and your account plan. Validate the feed before risking money.

## Run locally

Requires Node.js 18 or newer.

1. Extract the ZIP.
2. In this folder run `npm install`.
3. Copy `.env.example` to `.env`.
4. Add your provider keys to `.env` (see below).
5. Run `npm start`.
6. Open `http://localhost:3000`.

## API keys

### Twelve Data
Create an API key with Twelve Data and set `TWELVE_DATA_API_KEY` in the server environment. The browser never receives this key.

### Optional AI review
Set `OPENAI_API_KEY` in the server environment to enable a generative AI review. API usage may cost money depending on your account and model. `OPENAI_MODEL` defaults to `gpt-4.1-mini`.

**Never** paste API keys into `public/app.js`, HTML, GitHub commits, screenshots, or chat messages. For deployment, use your host's environment variables / Secrets panel. Do not upload `.env`.

## Deploy on Replit or another Node host

1. Upload/extract the project files into the project root.
2. Set the run/start command to `npm start`.
3. Add `TWELVE_DATA_API_KEY` in the host's Secrets / Environment Variables panel.
4. Optionally add `OPENAI_API_KEY` and `OPENAI_MODEL`.
5. Deploy, then open `/api/health`. It reports whether server-side keys are configured, but never returns the key values.
6. Test a symbol, e.g. `/api/market?market=stocks&symbol=NVDA&interval=5min`.

For GitHub, commit the project files but **not** `.env` or real keys. If the key was ever committed publicly, revoke it and create a new one.

## Supported symbols and intervals

- Stocks: `NVDA`, `AAPL`, `MSFT`, `TSLA`, `AMD`, `QQQ`, `SPY`
- Forex: `EUR/USD`, `GBP/USD`, `USD/JPY`, `AUD/USD`, `USD/CAD`, `EUR/GBP`
- Crypto: `BTC/USD`, `ETH/USD`, `SOL/USD`, `XRP/USD`
- Intervals: `1min`, `5min`, `15min`, `30min`, `1h`, `4h`, `1day`

Provider support may vary. Unsupported combinations return an error rather than a fake live price.

## API endpoints

- `GET /api/health` — service and key-configuration status (does not expose secrets)
- `GET /api/market?market=stocks&symbol=NVDA&interval=5min` — candles and indicators
- `GET /api/signal?market=stocks&symbol=NVDA&interval=5min` — technical signal plus optional AI review

## Safety and limitations

- Per-IP rate limit: 60 API requests/minute.
- In-memory 30-second cache to reduce provider calls.
- Input allowlists for markets, symbols, and intervals.
- Request timeouts and sanitized provider errors.
- No brokerage connection, order placement, user accounts, or persistent signal history.
- The initial implementation is a starter project. It has not been deployed or verified against your live provider key from this generated package.
