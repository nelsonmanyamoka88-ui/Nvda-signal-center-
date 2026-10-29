const $ = id => document.getElementById(id);
const symbols = {
  stocks: ["NVDA", "AAPL", "MSFT", "TSLA", "AMD", "QQQ", "SPY"],
  forex: ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "EUR/GBP"],
  crypto: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"]
};
let lastMarketData = null;
let busy = false;
let toastTimer;

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}
function selected() {
  return { market: $("market-select").value, symbol: $("symbol-select").value, interval: $("interval-select").value };
}
function urlFor(endpoint) {
  const s = selected();
  return `/api/${endpoint}?market=${encodeURIComponent(s.market)}&symbol=${encodeURIComponent(s.symbol)}&interval=${encodeURIComponent(s.interval)}`;
}
function fmt(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return v >= 1000 ? v.toLocaleString("en-US", {maximumFractionDigits:2}) :
    v >= 1 ? v.toLocaleString("en-US", {maximumFractionDigits:4}) :
    v.toLocaleString("en-US", {maximumFractionDigits:6});
}
function fillSymbols() {
  const market = $("market-select").value;
  $("symbol-select").innerHTML = symbols[market].map(s => `<option value="${s}">${s}</option>`).join("");
  $("symbol-select").value = market === "stocks" ? "NVDA" : market === "forex" ? "EUR/USD" : "BTC/USD";
}
function updateClock() {
  $("clock").textContent = new Intl.DateTimeFormat("en-GB", {timeZone:"Africa/Lusaka",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date());
}
async function api(url) {
  const response = await fetch(url, {headers:{"Accept":"application/json"}});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
async function loadHealth() {
  try {
    const h = await api("/api/health");
    const badge = $("data-badge");
    if (h.liveDataConfigured) {
      badge.className = "badge live"; badge.innerHTML = "<i></i> Live data configured";
      $("mode-stat").textContent = "LIVE READY"; $("mode-foot").textContent = "Provider key detected on server";
      $("side-mode").textContent = "LIVE READY";
    } else {
      badge.className = "badge demo"; badge.innerHTML = "<i></i> Demo only · no live key";
      $("mode-stat").textContent = "DEMO ONLY"; $("mode-foot").textContent = "Live candles unavailable until configured";
      $("side-mode").textContent = "DEMO ONLY";
    }
    $("engine-stat").textContent = h.aiConfigured ? "AI + Rules" : "Technical rules";
    $("engine-foot").textContent = h.aiConfigured ? "Optional AI review configured" : "No generative AI key configured";
    $("footer-status").textContent = h.liveDataConfigured ? "Live data configured · awaiting candle response" : "Add TWELVE_DATA_API_KEY on the server for live data";
    return h;
  } catch (e) {
    $("data-badge").className = "badge muted"; $("data-badge").innerHTML = "<i></i> Service unavailable";
    $("footer-status").textContent = e.message;
    return null;
  }
}
function drawChart(data) {
  const candles = data.candles;
  const wrap = $("chart-wrap");
  const width = Math.max(320, wrap.clientWidth || 600), height = 245;
  const pad = {l:8,r:8,t:12,b:24};
  const lows = candles.map(c=>c.low), highs = candles.map(c=>c.high);
  const min = Math.min(...lows), max = Math.max(...highs), range = max-min || 1;
  const x = i => pad.l + i * (width-pad.l-pad.r) / Math.max(1,candles.length-1);
  const y = p => pad.t + (max-p) * (height-pad.t-pad.b) / range;
  const closes = candles.map(c=>c.close);
  const emaCalc = period => {
    const out = []; const k=2/(period+1); let cur=closes.slice(0,period).reduce((a,b)=>a+b,0)/period;
    closes.forEach((v,i)=>{if(i===period-1)out.push(cur);else if(i>=period){cur=v*k+cur*(1-k);out.push(cur)}else out.push(null)});
    return out;
  };
  const e9=emaCalc(9), e21=emaCalc(21);
  let grid="";
  for(let i=0;i<4;i++){const yy=pad.t+i*(height-pad.t-pad.b)/3;const val=max-i*range/3;grid+=`<line x1="${pad.l}" y1="${yy}" x2="${width-pad.r}" y2="${yy}" stroke="#26314a" stroke-dasharray="3 5"/><text x="${width-pad.r-2}" y="${yy-4}" text-anchor="end" font-size="9" fill="#7788a8">${fmt(val)}</text>`}
  let sticks="";
  const candleWidth=Math.max(2,Math.min(7,(width-pad.l-pad.r)/candles.length*.58));
  candles.forEach((c,i)=>{const xx=x(i),up=c.close>=c.open,col=up?"#44d6a0":"#ff7589";sticks+=`<line x1="${xx}" y1="${y(c.high)}" x2="${xx}" y2="${y(c.low)}" stroke="${col}" stroke-width="1"/><rect x="${xx-candleWidth/2}" y="${Math.min(y(c.open),y(c.close))}" width="${candleWidth}" height="${Math.max(1,Math.abs(y(c.open)-y(c.close)))}" fill="${col}" rx=".5"/>`});
  const line = arr => arr.map((v,i)=>v===null?"":`${i===0||arr[i-1]===null?"M":"L"}${x(i)},${y(v)}`).filter(Boolean).join(" ");
  const labels=[0,Math.floor((candles.length-1)/2),candles.length-1].map(i=>`<text x="${x(i)}" y="${height-5}" font-size="9" fill="#7889a8" text-anchor="${i===0?"start":i===candles.length-1?"end":"middle"}">${String(candles[i].time).slice(11,16)||String(candles[i].time).slice(0,10)}</text>`).join("");
  wrap.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Candlestick chart with EMA overlays">${grid}${sticks}<path d="${line(e9)}" fill="none" stroke="#7aa7ff" stroke-width="1.6"/><path d="${line(e21)}" fill="none" stroke="#c1a0ff" stroke-width="1.6"/>${labels}</svg>`;
}
function renderSignal(s) {
  $("signal-word").textContent = s.direction;
  $("signal-direction").className = `signal-direction ${s.direction.toLowerCase()}`;
  $("signal-summary").textContent = s.aiReview ? s.aiReview.summary : (s.rationale || []).join(" ");
  $("entry").textContent = fmt(s.entry); $("stop").textContent = fmt(s.stopLoss); $("target").textContent = fmt(s.takeProfit);
  $("strength").textContent = `${s.strength}%`; $("strength-meter").style.width = `${s.strength}%`;
  $("signal-mode").textContent = s.dataMode === "LIVE" ? "LIVE CANDLES" : "SIMULATED";
  $("signal-mode").style.background = s.dataMode === "LIVE" ? "#10332c" : "#342817";
  $("risk-text").textContent = s.aiReview ? `AI review (${s.aiReview.provider}) is based on the technical snapshot. ${s.aiReview.risks.join(" ")}` : (s.aiMessage || s.disclaimer);
  const ai = s.aiReview;
  $("ai-value").textContent = ai ? ai.assessment : (s.aiStatus === "unavailable" ? "Unavailable" : "Not set");
  $("ai-label").textContent = ai ? `${ai.provider} · ${ai.model}` : (s.aiMessage || "Optional server key");
  $("reason-list").innerHTML = (s.rationale || []).map(t=>`<li>${escapeHtml(t)}</li>`).join("");
  if (ai) $("reason-list").innerHTML += `<li><b>AI review:</b> ${escapeHtml(ai.summary)}</li>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function scan() {
  if (busy) return;
  busy = true; $("scan-button").disabled = true; $("scan-button").textContent = "Scanning live market…";
  const s=selected();
  $("chart-title").textContent = `${s.symbol} · ${({"1min":"1 minute","5min":"5 minute","15min":"15 minute","30min":"30 minute","1h":"1 hour","4h":"4 hour","1day":"1 day"})[s.interval]}`;
  try {
    const data = await api(urlFor("market"));
    lastMarketData = data; drawChart(data);
    const closes=data.candles.map(c=>c.close), last=closes[closes.length-1], prev=closes[closes.length-2];
    $("last-price").textContent=fmt(last);
    const delta=last-prev, pct=prev ? delta/prev*100 : 0;
    $("price-change").textContent=`${delta>=0?"+":""}${fmt(delta)} (${pct>=0?"+":""}${pct.toFixed(2)}%)`;
    $("price-change").className=`change ${delta>0?"up":delta<0?"down":"neutral"}`;
    $("candle-time").textContent=`Latest candle: ${data.latestCandleAt}`;
    $("provider-label").textContent=`${data.provider} · ${data.cache==="HIT"?"cached":"fresh response"}`;
    $("rsi-value").textContent=fmt(data.indicators.rsi14);
    $("rsi-label").textContent=data.indicators.rsi14>=70?"Overbought zone":data.indicators.rsi14<=30?"Oversold zone":"Neutral range";
    $("ema9-value").textContent=fmt(data.indicators.ema9); $("ema21-value").textContent=fmt(data.indicators.ema21);
    $("ema9-label").textContent=last>data.indicators.ema9?"Price above EMA":"Price below EMA";
    $("ema21-label").textContent=data.indicators.ema9>data.indicators.ema21?"EMA trend bullish":"EMA trend bearish";
    const signal=await api(urlFor("signal"));
    renderSignal(signal);
    $("footer-status").textContent=`Last response ${new Date().toLocaleTimeString()} · ${data.provider} · ${data.candles.length} candles`;
  } catch(e) {
    $("chart-wrap").innerHTML=`<div class="chart-empty"><span>⚠ ${escapeHtml(e.message)}</span></div>`;
    $("signal-summary").textContent=e.message;
    $("signal-mode").textContent="NO DATA";
    toast(e.message);
  } finally {
    busy=false; $("scan-button").disabled=false; $("scan-button").innerHTML='Scan current market <span>→</span>';
  }
}
$("market-select").addEventListener("change",()=>{fillSymbols();scan()});
$("symbol-select").addEventListener("change",scan);
$("interval-select").addEventListener("change",scan);
$("scan-button").addEventListener("click",scan);
$("refresh").addEventListener("click",async()=>{await loadHealth();scan()});
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));btn.classList.add("active");
  const page=btn.dataset.page;
  $("page-title").textContent=page==="dashboard"?"Trading dashboard":page==="signals"?"Signal scanner":"Watchlist";
  if(page==="watchlist")toast("Choose a market and symbol from the selectors to scan it.");
  if(page==="signals")toast("Signal scanner uses the selected market, symbol and interval.");
}));
window.addEventListener("resize",()=>{if(lastMarketData)drawChart(lastMarketData)});
fillSymbols(); updateClock(); setInterval(updateClock,1000);
loadHealth().then(()=>scan());
    
