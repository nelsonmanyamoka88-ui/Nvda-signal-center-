require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

const SYMBOLS = {
  stocks: new Set(["NVDA", "AAPL", "MSFT", "TSLA", "AMD", "QQQ", "SPY"]),
  forex: new Set(["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "EUR/GBP"]),
  crypto: new Set(["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"])
};
const INTERVALS = new Set(["1min", "5min", "15min", "30min", "1h", "4h", "1day"]);
const cache = new Map();
const CACHE_MS = 30_000;
const requestCounts = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const item = requestCounts.get(ip);
  if (!item || now - item.start > 60_000) requestCounts.set(ip, { start: now, count: 1 });
  else {
    item.count += 1;
    if (item.count > 60) return res.status(429).json({ error: "Too many requests. Wait one minute and try again." });
  }
  next();
}
app.use("/api", rateLimit);

function validRequest(market, symbol, interval) {
  return Boolean(SYMBOLS[market] && SYMBOLS[market].has(symbol) && INTERVALS.has(interval));
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

async function getCandles(market, symbol, interval) {
  const key = `${market}|${symbol}|${interval}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached.value, cache: "HIT" };

  if (!process.env.TWELVE_DATA_API_KEY) {
    const err = new Error("Live market data is not configured. Add TWELVE_DATA_API_KEY to your server environment.");
    err.status = 503; throw err;
  }
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", "100");
  url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    const err = new Error(`Market data provider returned HTTP ${response.status}.`);
    err.status = 502; throw err;
  }
  const raw = await response.json();
  if (raw.status === "error" || !Array.isArray(raw.values)) {
    const msg = String(raw.message || "The provider returned no candle data.");
    const err = new Error(msg.toLowerCase().includes("api key") ? "The market data provider rejected the API key. Check your server secret." : "No live candles returned. Check symbol support, API limits, or provider status.");
    err.status = 502; throw err;
  }
  const candles = raw.values.map(c => ({
    time: c.datetime, open: num(c.open), high: num(c.high), low: num(c.low),
    close: num(c.close), volume: num(c.volume)
  })).filter(c => c.close !== null && c.high !== null && c.low !== null).reverse();
  if (candles.length < 25) {
    const err = new Error("Not enough live candles to calculate the indicators reliably.");
    err.status = 502; throw err;
  }
  const result = {
    market, symbol, interval, provider: "Twelve Data", dataMode: "LIVE",
    requestedAt: new Date().toISOString(), latestCandleAt: candles[candles.length - 1].time,
    candles, cache: "MISS"
  };
  cache.set(key, { at: Date.now(), value: result });
  return result;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let current = values.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i = period; i < values.length; i++) current = values[i] * k + current * (1-k);
  return current;
}
function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i-1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i-1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
function analyze(data) {
  const candles = data.candles;
  const closes = candles.map(c => c.close);
  const last = closes[closes.length - 1];
  const fast = ema(closes, 9), slow = ema(closes, 21), r = rsi(closes);
  const recent = candles.slice(-20);
  const atr = recent.reduce((sum,c) => sum + (c.high - c.low), 0) / recent.length;
  let score = 0;
  if (fast > slow) score += 1;
  if (fast < slow) score -= 1;
  if (last > fast) score += 1;
  if (last < fast) score -= 1;
  if (r >= 52 && r <= 68) score += 1;
  if (r <= 48 && r >= 32) score -= 1;
  const direction = score >= 2 ? "BUY" : score <= -2 ? "SELL" : "WAIT";
  const strength = Math.min(95, Math.max(25, Math.round(50 + Math.abs(score) * 12)));
  const stop = direction === "BUY" ? last - 1.5 * atr : direction === "SELL" ? last + 1.5 * atr : null;
  const target = direction === "BUY" ? last + 2.25 * atr : direction === "SELL" ? last - 2.25 * atr : null;
  return {
    symbol: data.symbol, market: data.market, interval: data.interval,
    direction, strength, entry: last, stopLoss: stop, takeProfit: target,
    indicators: { ema9: fast, ema21: slow, rsi14: r, averageRange: atr },
    rationale: [
      `EMA 9 is ${fast > slow ? "above" : "below"} EMA 21.`,
      `Last close is ${last > fast ? "above" : "below"} EMA 9.`,
      `RSI(14) is ${r.toFixed(1)}.`,
      direction === "WAIT" ? "The combined conditions do not show a strong directional edge." : "The technical score meets the directional threshold."
    ],
    engine: "TECHNICAL_RULES",
    disclaimer: "This is a rules-based technical estimate, not a guarantee or personalized financial advice."
  };
}

async function getAiReview(signal, data) {
  if (!process.env.OPENAI_API_KEY) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const snapshot = {
    symbol: signal.symbol, market: signal.market, interval: signal.interval,
    direction: signal.direction, strength: signal.strength, entry: signal.entry,
    stopLoss: signal.stopLoss, takeProfit: signal.takeProfit,
    indicators: signal.indicators, rationale: signal.rationale,
    candleCount: data.candles.length, latestCandleAt: data.latestCandleAt
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: "You are a cautious market-analysis assistant. Review the supplied factual technical snapshot only. Do not invent prices, events, or data. Do not change numeric levels. Return concise JSON with keys: assessment (one of BUY, SELL, WAIT), summary (max 45 words), risks (array of up to 3 short strings). If evidence is mixed, assessment must be WAIT. This is educational analysis, not financial advice.",
      input: JSON.stringify(snapshot),
      max_output_tokens: 220
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("AI review provider is unavailable. The technical signal is still available.");
  const body = await response.json();
  const output = (body.output || []).flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join("\n");
  if (!output) throw new Error("AI review returned no text.");
  let parsed;
  try {
    const cleaned = output.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch { throw new Error("AI review returned an unexpected format."); }
  if (!["BUY", "SELL", "WAIT"].includes(parsed.assessment) || typeof parsed.summary !== "string") {
    throw new Error("AI review returned invalid fields.");
  }
  return { provider: "OpenAI", model, assessment: parsed.assessment, summary: parsed.summary.slice(0, 500), risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0,3).map(String) : [] };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true, service: "Trading Signal Center",
    liveDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    liveDataProvider: "Twelve Data",
    mode: process.env.TWELVE_DATA_API_KEY ? "LIVE_DATA_READY" : "DEMO_ONLY",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/market", async (req, res) => {
  const market = String(req.query.market || "");
  const symbol = String(req.query.symbol || "");
  const interval = String(req.query.interval || "5min");
  if (!validRequest(market, symbol, interval)) return res.status(400).json({ error: "Unsupported market, symbol, or interval." });
  try {
    const data = await getCandles(market, symbol, interval);
    res.json({
      ...data,
      indicators: (() => {
        const closes = data.candles.map(c => c.close);
        return { ema9: ema(closes, 9), ema21: ema(closes, 21), rsi14: rsi(closes) };
      })()
    });
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "Market data request failed." }); }
});

app.get("/api/signal", async (req, res) => {
  const market = String(req.query.market || "");
  const symbol = String(req.query.symbol || "");
  const interval = String(req.query.interval || "5min");
  if (!validRequest(market, symbol, interval)) return res.status(400).json({ error: "Unsupported market, symbol, or interval." });
  try {
    const data = await getCandles(market, symbol, interval);
    const signal = analyze(data);
    if (process.env.OPENAI_API_KEY) {
      try {
        const ai = await getAiReview(signal, data);
        if (ai) {
          signal.technicalDirection = signal.direction;
          signal.aiReview = ai;
          signal.direction = ai.assessment;
          const entry = signal.entry;
          const atr = signal.indicators.averageRange;
          signal.stopLoss = signal.direction === "BUY" ? entry - 1.5 * atr : signal.direction === "SELL" ? entry + 1.5 * atr : null;
          signal.takeProfit = signal.direction === "BUY" ? entry + 2.25 * atr : signal.direction === "SELL" ? entry - 2.25 * atr : null;
          signal.engine = "AI_REVIEW_PLUS_TECHNICAL_RULES";
        }
      } catch (e) { signal.aiStatus = "unavailable"; signal.aiMessage = e.message; }
    } else {
      signal.aiStatus = "not_configured";
      signal.aiMessage = "Optional AI review is not configured. This signal was generated by transparent technical rules, not a generative AI model.";
    }
    res.json({
      ...signal, dataMode: "LIVE", provider: data.provider,
      latestCandleAt: data.latestCandleAt, requestedAt: data.requestedAt,
      cache: data.cache
    });
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "Signal request failed." }); }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`Trading Signal Center listening on port ${PORT}`));
