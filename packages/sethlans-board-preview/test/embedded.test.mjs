// Smoke test della modalita' EMBEDDED (invariata) — node --test.
// Richiede node:sqlite (Node >= 22.5.0, vedi package.json "engines" ed il vincolo del task).
// Se l'ambiente locale ha una versione di Node piu' vecchia, i test si auto-saltano con
// t.skip() invece di fallire rumorosamente: e' un limite ambientale, non un difetto del codice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const SERVER_ENTRY = join(PACKAGE_ROOT, "server.mjs");

let sqliteAvailable = true;
try {
  await import("node:sqlite");
} catch {
  sqliteAvailable = false;
}

async function startPreview(env) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });

  const port = await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/in ascolto su http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) {
        child.stdout.off("data", onData);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null) reject(new Error(`preview uscito prematuramente (code=${code}): ${stderr}`));
    });
    setTimeout(() => reject(new Error(`timeout avvio preview: stdout=${stdout} stderr=${stderr}`)), 8000);
  });

  return { child, base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

test("embedded mode: senza SETHLANS_UPSTREAM_URL, GET /state risponde 200 dal SQLite locale", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: "", PORT: "0" });
  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/state`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body && typeof body === "object");
  assert.ok(Array.isArray(body.projects), "lo snapshot embedded deve contenere projects[]");
});

// --- gate auth a token condiviso (storia s69413e22, "## Contratto auth") in modalita' embedded ---

test("embedded mode + token settato: REST senza header -> 401 {detail}", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: "",
    SETHLANS_SERVICE_API_TOKEN: "segreto-embedded",
    PORT: "0",
  });
  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/state`);
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.deepEqual(body, { detail: "token mancante o non valido" });
});

test("embedded mode + token settato: REST con header errato -> 401 {detail}", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: "",
    SETHLANS_SERVICE_API_TOKEN: "segreto-embedded",
    PORT: "0",
  });
  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/state`, {
    headers: { "X-Sethlans-Token": "sbagliato" },
  });
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.deepEqual(body, { detail: "token mancante o non valido" });
});

test("embedded mode + token settato: REST con header corretto -> 200", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: "",
    SETHLANS_SERVICE_API_TOKEN: "segreto-embedded",
    PORT: "0",
  });
  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/state`, {
    headers: { "X-Sethlans-Token": "segreto-embedded" },
  });

  assert.equal(res.status, 200);
});

test("embedded mode + token settato: OPTIONS passa senza header (204)", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: "",
    SETHLANS_SERVICE_API_TOKEN: "segreto-embedded",
    PORT: "0",
  });
  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/state`, { method: "OPTIONS" });

  assert.equal(res.status, 204);
});

// --- GET /config (storia s50550dcb) in modalita' embedded ---

test("embedded mode: GET /config con SETHLANS_BOARD_WEB_URL settata -> {board_web_url: <valore>}", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: "",
    SETHLANS_BOARD_WEB_URL: "http://localhost:5173",
    PORT: "0",
  });
  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/config`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { board_web_url: "http://localhost:5173" });
});

test("embedded mode: GET /config senza SETHLANS_BOARD_WEB_URL -> {board_web_url: null}", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: "", PORT: "0" });
  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/config`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { board_web_url: null });
});

test("embedded mode: GET /config passa anche con SETHLANS_SERVICE_API_TOKEN settato (non gated)", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: "",
    SETHLANS_BOARD_WEB_URL: "http://localhost:5173",
    SETHLANS_SERVICE_API_TOKEN: "segreto-config-embedded",
    PORT: "0",
  });
  t.after(() => preview.stop());

  // Nessun header X-Sethlans-Token: se /config fosse gated risponderebbe 401.
  const res = await fetch(`${preview.base}/config`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { board_web_url: "http://localhost:5173" });
});

test("embedded mode senza token settato: REST passa senza header (nessun 401, comportamento invariato)", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile su questa versione di Node (richiede >= 22.5.0) — limite ambientale, non testato qui");
    return;
  }

  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: "", PORT: "0" });
  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/state`);

  assert.equal(res.status, 200);
});
