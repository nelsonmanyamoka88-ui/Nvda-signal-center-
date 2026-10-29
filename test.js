const test = require("node:test");
const assert = require("node:assert/strict");

// Lightweight static safety checks; no API key or network required.
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
test("server keeps provider credentials server-side", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const client = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(server, /process\.env\.TWELVE_DATA_API_KEY/);
  assert.match(server, /process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(client, /sk-[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(client, /apikey=[A-Za-z0-9_-]{12,}/i);
});
test("API input allowlists and rate limiter are present", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /const SYMBOLS/);
  assert.match(server, /const INTERVALS/);
  assert.match(server, /Too many requests/);
});
test("UI labels live data and AI configuration honestly", () => {
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(html, /DATA MODE/);
  assert.match(js, /DEMO ONLY/);
  assert.match(js, /No generative AI key configured/);
});
