import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Runs a built app and probes real HTTP handlers in one process tree. No user
// provider credentials or database writes are used by this smoke check.
const port = 4319;
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  KMA_SERVICE_KEY: "",
  KOREA_DATA_API_KEY: "",
  AIRKOREA_SERVICE_KEY: "",
  KAKAO_REST_API_KEY: "",
  AIRKOREA_STATIONS: "{}",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SILSIGAN_STORE_DRIVER: "demo",
  LOCAL_LIVE_COMMUNITY_ENABLED: "false",
  SILSIGAN_ENABLE_LEGACY_DEMO_WRITES: "false",
};
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
let spawnError;
child.on("error", (error) => { spawnError = error; });
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk).slice(-16_000); });
const exited = new Promise((resolve) => child.on("exit", resolve));
let scenarios = 0;

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`App exited during startup:\n${logs}`);
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Wait for the local server's readiness. */ }
    await delay(200);
  }
  assert.ok(ready, `App did not become ready:\n${logs}`);
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /우리 동네의 지금/);
  scenarios++;

  const response = await fetch(`${base}/api/local-live?region=ulsan`);
  const snapshot = await response.json();
  assert.equal(response.status, 200);
  assert.equal(snapshot.data.region.id, "ulsan");
  for (const name of ["weather", "forecast", "airQuality", "places", "reports"]) {
    assert.equal(snapshot.data[name].status, "not_configured");
    assert.equal(snapshot.data[name].data, null);
  }
  assert.equal(snapshot.data.guidePlaces[0].name, "태화강 국가정원");
  assert.match(response.headers.get("cache-control"), /no-store/);
  scenarios++;

  for (const path of ["/api/local-live?region=unknown", "/api/local-live?region=ulsan&latitude=35.1", "/api/local-live?category=unverified"]) {
    assert.equal((await fetch(base + path)).status, 400, path);
    scenarios++;
  }
  for (const path of ["/api/posts", "/api/post-flags", "/api/reports", "/api/questions", "/api/moderation-flags"]) {
    const response = await fetch(base + path, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).error.code, "LEGACY_WRITE_DISABLED");
    scenarios++;
  }
  for (const path of ["/api/posts?includeHidden=true", "/api/reports", "/api/questions", "/api/my-questions"]) {
    const result = await (await fetch(base + path)).json();
    assert.deepEqual(result.data, [], path);
    assert.equal(result.meta.live, false, path);
    scenarios++;
  }
  assert.equal((await fetch(`${base}/share/post/post_seed_gwangalli_parking`)).status, 404);
  scenarios++;
  const search = await (await fetch(`${base}/api/local-live?region=ulsan&q=${encodeURIComponent("태화강")}`)).json();
  assert.equal(search.data.guidePlaces[0].id, "ulsan-taehwagang");
  scenarios++;
  const busan = await (await fetch(`${base}/api/local-live?region=busan`)).json();
  assert.equal(busan.data.region.id, "busan");
  assert.equal(busan.data.guidePlaces[0].id, "busan-gwangalli");
  scenarios++;
  const seoul = await (await fetch(`${base}/api/local-live?region=seoul`)).json();
  assert.equal(seoul.data.region.id, "seoul");
  assert.deepEqual(seoul.data.guidePlaces, []);
  scenarios++;
  console.log(`PASS: ${scenarios} production HTTP scenarios; no fabricated live data or production legacy writes.`);
} finally {
  child.kill("SIGTERM");
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
