const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.TWELVE_DATA_API_KEY;
const PUBLIC_DIR = path.join(__dirname, "public");
const HOST = "https://api.twelvedata.com";
const CACHE_MS = 30_000;
const FRESHNESS = { "1min": 180_000, "5min": 600_000 };
const cache = new Map();
const rateBuckets = new Map();

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
function jsonError(res, status, message) {
  send(res, status, { error: message });
}
function rateLimit(req, res) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter(t => now - t < 60_000);
  if (recent.length >= 20) { jsonError(res, 429, "App request limit reached. Wait a minute before refreshing."); return false; }
  recent.push(now); rateBuckets.set(ip, recent);
  return true;
}
async function provider(pathname, params) {
  if (!API_KEY) throw new Error("TWELVE_DATA_API_KEY is not configured on the server.");
  const url = new URL(HOST + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", API_KEY);
  const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(12_000) });
  const body = await response.json().catch(() => ({}));
  return { httpStatus: response.status, body };
}
function providerFailure(result) {
  const b = result.body || {};
  if (result.httpStatus < 200 || result.httpStatus >= 300) return `Twelve Data HTTP ${result.httpStatus}`;
  if (b.status === "error" || b.code || b.message && !b.values && !b.is_market_open && !Array.isArray(b)) {
    const msg = String(b.message || b.code || "Provider returned an error").slice(0, 220);
    return `Twelve Data: ${msg}`;
  }
  return null;
}
async function cached(key, loader) {
  const now = Date.now();
  const found = cache.get(key);
  if (found && now - found.fetchedAt < CACHE_MS) return { ...found.data, cache: { hit: true, fetchedAt: new Date(found.fetchedAt).toISOString() } };
  const data = await loader();
  cache.set(key, { fetchedAt: Date.now(), data });
  return { ...data, cache: { hit: false, fetchedAt: new Date().toISOString() } };
}
function parseCandle(v, interval) {
  const date = new Date(String(v.datetime || "").replace(" ", "T") + (String(v.datetime || "").endsWith("Z") ? "" : "Z"));
  const open = Number(v.open), high = Number(v.high), low = Number(v.low), close = Number(v.close), volume = Number(v.volume);
  if (!Number.isFinite(date.getTime()) || ![open, high, low, close, volume].every(Number.isFinite) || volume < 0 || high < low) return null;
  return { timestamp: date.toISOString(), time: date.getTime(), open, high, low, close, volume, interval };
}
function sortAndValidate(values, interval) {
  if (!Array.isArray(values)) throw new Error("Provider did not return candle values.");
  const candles = values.map(v => parseCandle(v, interval));
  if (candles.some(v => !v)) throw new Error("Provider returned malformed candle data.");
  candles.sort((a,b) => a.time - b.time);
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time === candles[i-1].time) throw new Error("Provider returned duplicate candle timestamps.");
  }
  return candles;
}
async function getMarketState() {
  const result = await provider("/market_state", { exchange: "NASDAQ" });
  const failure = providerFailure(result);
  if (failure) return { verified: false, isOpen: null, error: failure, httpStatus: result.httpStatus };
  let body = result.body;
  if (Array.isArray(body)) body = body.find(x => String(x.exchange || x.code || "").toUpperCase().includes("NASDAQ") || String(x.code || "").toUpperCase() === "XNGS") || body[0];
  const value = body && (body.is_market_open ?? body.isMarketOpen);
  if (typeof value !== "boolean") return { verified: false, isOpen: null, error: "Market-state response did not contain a recognizable open/closed flag.", httpStatus: result.httpStatus };
  return { verified: true, isOpen: value, exchange: body.exchange || body.code || "NASDAQ", httpStatus: result.httpStatus, retrievedAt: new Date().toISOString() };
}
async function getFeed(symbol, interval) {
  const outputsize = interval === "1min" ? "500" : "100";
  return cached(`feed:${symbol}:${interval}`, async () => {
    const result = await provider("/time_series", { symbol, interval, outputsize, format: "JSON", timezone: "UTC", order: "ASC", prepost: "false" });
    const failure = providerFailure(result);
    if (failure) return { symbol, interval, error: failure, provider: { httpStatus: result.httpStatus, status: result.body && result.body.status || null, code: result.body && result.body.code || null, message: result.body && result.body.message || null }, candles: [], latestCandle: null };
    let candles;
    try { candles = sortAndValidate(result.body.values, interval); }
    catch (e) { return { symbol, interval, error: e.message, provider: { httpStatus: result.httpStatus, status: result.body.status || null }, candles: [], latestCandle: null }; }
    const now = Date.now();
    const duration = interval === "1min" ? 60_000 : 300_000;
    const completed = candles.filter(c => c.time + duration <= now);
    return {
      symbol, interval, error: null,
      provider: { httpStatus: result.httpStatus, status: result.body.status || "ok", code: result.body.code || null, message: result.body.message || null, count: candles.length },
      candles: completed,
      latestCandle: completed.length ? completed[completed.length - 1].timestamp : null,
      latestReturnedCandle: candles.length ? candles[candles.length - 1].timestamp : null,
      incompleteCandleExcluded: candles.length > completed.length
    };
  });
}
function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let result = values.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < values.length; i++) result = values[i] * k + result * (1-k);
  return result;
}
function rsi(values, period=14) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i=1; i<=period; i++) {
    const d = values[i] - values[i-1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains/period, avgLoss = losses/period;
  for (let i=period+1; i<values.length; i++) {
    const d = values[i]-values[i-1];
    avgGain = (avgGain*(period-1) + Math.max(0,d))/period;
    avgLoss = (avgLoss*(period-1) + Math.max(0,-d))/period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100/(1+avgGain/avgLoss);
}
function atr(candles, period=14) {
  if (candles.length < period+1) return null;
  const trs = [];
  for (let i=1; i<candles.length; i++) {
    const c=candles[i], prev=candles[i-1];
    trs.push(Math.max(c.high-c.low, Math.abs(c.high-prev.close), Math.abs(c.low-prev.close)));
  }
  return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function sessionDateNY(timestamp) {
  return new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(timestamp));
}
function vwapForLatestSession(candles) {
  if (!candles.length) return null;
  const latestDate = sessionDateNY(candles[candles.length-1].time);
  const bars = candles.filter(c => sessionDateNY(c.time) === latestDate);
  let pv=0, vol=0;
  for (const c of bars) {
    const ny = new Date(c.time).toLocaleString("en-US", {timeZone:"America/New_York", hour12:false, hour:"2-digit", minute:"2-digit"});
    const hm = ny.split(":").map(Number);
    const minutes = hm[0]*60 + hm[1];
    if (minutes < 570 || minutes >= 960) continue;
    const typical = (c.high+c.low+c.close)/3;
    pv += typical*c.volume; vol += c.volume;
  }
  return vol > 0 ? pv/vol : null;
}
function nyMinuteNow() {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hour12:false, weekday:"short"}).formatToParts(new Date());
  const o = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return { weekday:o.weekday, minutes:Number(o.hour)*60+Number(o.minute) };
}
function sessionOpenNow() {
  const n=nyMinuteNow();
  return ["Mon","Tue","Wed","Thu","Fri"].includes(n.weekday) && n.minutes >= 570 && n.minutes < 960;
}
function indicatorSet(candles) {
  const closes=candles.map(c=>c.close);
  const latest=candles[candles.length-1];
  return { close: latest.close, ema9:ema(closes,9), ema21:ema(closes,21), rsi14:rsi(closes,14), vwap:vwapForLatestSession(candles), atr14:atr(candles,14), latestCandle:latest.timestamp };
}
function signalEngine(one, five, market) {
  const base={ signal:"NO TRADE", reason:"Conditions not yet confirmed.", calculatedAt:new Date().toISOString(), disclaimer:"Analytical suggestion only. Not financial advice. No trades are placed." };
  if (!market.verified) return {...base, reason:"Market state could not be verified; signals are disabled.", marketState:market};
  if (!market.isOpen || !sessionOpenNow()) return {...base, reason:"Regular NASDAQ session is closed; signals are disabled.", marketState:market};
  if (one.error || five.error || one.candles.length<30 || five.candles.length<30) return {...base, reason:"Missing, invalid, or insufficient provider candles.", marketState:market};
  const now=Date.now();
  const c1=one.candles[one.candles.length-1], c5=five.candles[five.candles.length-1];
  if (now-c1.time > FRESHNESS["1min"] || now-c5.time > FRESHNESS["5min"]) return {...base, reason:"Latest completed candles are stale for an open market.", marketState:market};
  const i1=indicatorSet(one.candles), i5=indicatorSet(five.candles);
  if ([i1.ema9,i1.ema21,i1.rsi14,i1.vwap,i1.atr14,i5.ema9,i5.ema21].some(v=>v===null || !Number.isFinite(v))) return {...base, reason:"Indicators could not be calculated from the available history.", marketState:market};
  const bullish5=i5.ema9>i5.ema21, bearish5=i5.ema9<i5.ema21;
  const bullish1=i1.ema9>i1.ema21, bearish1=i1.ema9<i1.ema21;
  let direction=null;
  if (bullish5 && bullish1 && i1.close>i1.vwap && i1.rsi14>=50 && i1.rsi14<=70) direction="LONG";
  else if (bearish5 && bearish1 && i1.close<i1.vwap && i1.rsi14>=30 && i1.rsi14<=50) direction="SHORT";
  if (!direction) return {...base, reason:"Timeframes, VWAP, and RSI do not all agree.", indicators:{oneMinute:i1,fiveMinute:i5}, marketState:market};
  const recent=one.candles.slice(-6);
  const structureLow=Math.min(...recent.map(c=>c.low)), structureHigh=Math.max(...recent.map(c=>c.high));
  const entry=i1.close;
  let stop=direction==="LONG" ? structureLow : structureHigh;
  if (direction==="LONG" && stop>=entry || direction==="SHORT" && stop<=entry) stop=direction==="LONG" ? entry-1.5*i1.atr14 : entry+1.5*i1.atr14;
  const risk=Math.abs(entry-stop);
  if (!Number.isFinite(risk) || risk<=0) return {...base, reason:"Could not calculate a valid stop-loss distance.", indicators:{oneMinute:i1,fiveMinute:i5}, marketState:market};
  const target=direction==="LONG" ? entry+2*risk : entry-2*risk;
  return { ...base, signal:direction, reason:"All configured trend, VWAP, and RSI conditions agree.", indicators:{oneMinute:i1,fiveMinute:i5}, plan:{entry,stopLoss:stop,takeProfit:target,riskReward:"2:1",riskPerShare:risk}, marketState:market };
}
async function getSnapshot() {
  const [market, nvda1, nvda5, qqq1, qqq5] = await Promise.all([
    cached("market:NDAQ", getMarketState),
    getFeed("NVDA","1min"), getFeed("NVDA","5min"), getFeed("QQQ","1min"), getFeed("QQQ","5min")
  ]);
  const feeds=[nvda1,nvda5,qqq1,qqq5].map(f=>{
    const age=f.latestCandle ? Date.now()-new Date(f.latestCandle).getTime() : null;
    let status="DATA ERROR";
    if (!f.error) {
      if (market.verified && !market.isOpen) status="MARKET CLOSED";
      else if (age !== null && age <= FRESHNESS[f.interval]) status="FRESH";
      else status="STALE";
    }
    return {...f, ageMs:age, freshnessStatus:status};
  });
  const byKey=Object.fromEntries(feeds.map(f=>[`${f.symbol}:${f.interval}`,f]));
  const signal=signalEngine(byKey["NVDA:1min"],byKey["NVDA:5min"],market);
  return { generatedAt:new Date().toISOString(), market, feeds, signal, providerPlanStatus:"UNVERIFIED", providerDelayStatus:"UNVERIFIED" };
}
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml" };
const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if (!rateLimit(req,res)) return;
  if (url.pathname==="/api/health") return send(res,200,{ok:true,configured:Boolean(API_KEY),time:new Date().toISOString()});
  if (url.pathname==="/api/snapshot" && req.method==="GET") {
    try { const result=await getSnapshot(); return send(res,200,result); }
    catch(e) { return send(res,502,{error:"Market data request failed safely.", detail:String(e.message||e).slice(0,220), providerPlanStatus:"UNVERIFIED"}); }
  }
  let requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const full=path.normalize(path.join(PUBLIC_DIR,requestPath));
  if (!full.startsWith(PUBLIC_DIR)) return jsonError(res,403,"Forbidden");
  fs.readFile(full,(err,buf)=>{
    if(err) return jsonError(res,404,"Not found");
    send(res,200,buf,mime[path.extname(full)]||"application/octet-stream");
  });
});
if (require.main === module) {
  server.listen(PORT,"0.0.0.0",()=>console.log(`NVDA Signal Center listening on ${PORT}`));
}

module.exports = { ema, rsi, atr, sortAndValidate, signalEngine, indicatorSet, vwapForLatestSession };
