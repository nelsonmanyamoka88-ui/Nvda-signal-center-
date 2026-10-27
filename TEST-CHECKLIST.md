# Test checklist
Run `npm run check` to syntax-check the server.
After setting the API key and starting the server:
- Visit `/api/health` and confirm `configured: true`.
- Visit `/api/snapshot` and inspect all four feeds.
- Verify latest timestamps, provider status, market state, and cache hit/miss.
- During a closed market, confirm signal is NO TRADE.
- If provider state or candles fail, confirm signal remains NO TRADE.
- Do not interpret a successful response as proof of real-time entitlement.
