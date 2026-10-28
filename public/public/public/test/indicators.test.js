const test = require("node:test");
const assert = require("node:assert/strict");
const { ema, rsi, atr, sortAndValidate, signalEngine } = require("../server");

test("EMA returns null when history is too short and a number when sufficient", () => {
  assert.equal(ema([1, 2, 3], 4), null);
  assert.ok(Number.isFinite(ema([1,2,3,4,5], 3)));
});

test("RSI returns null without enough history and 100 for uninterrupted gains", () => {
  assert.equal(rsi([1,2,3], 14), null);
  assert.equal(rsi(Array.from({length:20}, (_,i)=>i+1), 14), 100);
});

test("ATR requires enough candles", () => {
  assert.equal(atr([], 14), null);
  const candles = Array.from({length:20}, (_,i)=>({
    time: i*60000, timestamp:new Date(i*60000).toISOString(),
    open:10+i, high:12+i, low:9+i, close:11+i, volume:100, interval:"1min"
  }));
  assert.ok(Number.isFinite(atr(candles,14)));
});

test("candle validation rejects malformed and duplicate timestamps", () => {
  assert.throws(()=>sortAndValidate([{datetime:"bad",open:1,high:2,low:0,close:1,volume:2}],"1min"));
  assert.throws(()=>sortAndValidate([
    {datetime:"2026-01-01 10:00:00",open:1,high:2,low:0,close:1,volume:2},
    {datetime:"2026-01-01 10:00:00",open:1,high:2,low:0,close:1,volume:2}
  ],"1min"), /duplicate/i);
});

test("signal engine fails closed when market is closed or unverified", () => {
  const marketClosed = signalEngine({candles:[]},{candles:[]},{verified:true,isOpen:false});
  assert.equal(marketClosed.signal,"NO TRADE");
  const marketUnknown = signalEngine({candles:[]},{candles:[]},{verified:false,isOpen:null});
  assert.equal(marketUnknown.signal,"NO TRADE");
});
