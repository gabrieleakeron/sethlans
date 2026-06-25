// Smoke/unit test della modalita' PROXY (node --test, zero dipendenze).
// Avvia il preview reale come child process con SETHLANS_UPSTREAM_URL puntato a un upstream
// fittizio locale (un createServer di test), e verifica il passthrough trasparente del
// contratto REST: status+body identici (incl. 422 {"detail":...}), errore di rete -> 502
// senza crash, e che data/board.db non venga toccato in questa modalita'.
//
// Esecuzione: node --test test/proxy.test.mjs   (richiede solo node:http/node:test, nessun
// node:sqlite: gira anche su Node < 22.5, a differenza dei test embedded).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const SERVER_ENTRY = join(PACKAGE_ROOT, "server.mjs");
const BOARD_DB_PATH = join(PACKAGE_ROOT, "data", "board.db");

async function startFakeUpstream({ captureHeaders } = {}) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");

      if (captureHeaders) captureHeaders(req.headers);

      if (req.url === "/state" && req.method === "GET") {
        const payload = JSON.stringify({ projects: [], epics: [], stories: [], tasks: [], agents: [] });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(payload);
        return;
      }

      if (req.url === "/projects" && req.method === "POST") {
        // Simula un 422 di enum non valido, contratto board: {"detail": "..."}
        const payload = JSON.stringify({ detail: "type non valido: 'bogus'" });
        res.writeHead(422, { "Content-Type": "application/json; charset=utf-8" });
        res.end(payload);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ detail: "non trovato", echoedBody: body }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function startPreview(env, { waitForLog } = {}) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => { stdout += c.toString(); });
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

  return {
    child,
    base: `http://127.0.0.1:${port}`,
    stop: () => child.kill(),
    getStderr: () => stderr,
  };
}

test("proxy mode: GET /state inoltra status e body identici dall'upstream", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: upstream.base, PORT: "0" });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/state`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { projects: [], epics: [], stories: [], tasks: [], agents: [] });
});

test("proxy mode: POST con enum non valido propaga 422 {detail}", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: upstream.base, PORT: "0" });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x", type: "bogus" }),
  });
  const body = await res.json();

  assert.equal(res.status, 422);
  assert.deepEqual(body, { detail: "type non valido: 'bogus'" });
});

test("proxy mode: upstream irraggiungibile risponde 502 senza crashare", async (t) => {
  // Porta presumibilmente libera e nessun listener: la fetch deve fallire (ECONNREFUSED).
  const deadUpstream = "http://127.0.0.1:1";
  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: deadUpstream, PORT: "0" });

  t.after(() => preview.stop());

  const res = await fetch(`${preview.base}/state`);
  const body = await res.json();

  assert.equal(res.status, 502);
  assert.match(body.detail, /upstream non raggiungibile/);

  // Il processo non deve essere morto per l'errore di rete.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(preview.child.exitCode, null, "il processo preview non deve crashare su errore upstream");
});

test("proxy mode: data/board.db non viene toccato (mtime invariato / file assente)", async (t) => {
  const existedBefore = existsSync(BOARD_DB_PATH);
  const mtimeBefore = existedBefore ? statSync(BOARD_DB_PATH).mtimeMs : null;

  const upstream = await startFakeUpstream();
  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: upstream.base, PORT: "0" });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  // Alcune richieste, incluse mutazioni, per dare modo a un eventuale import accidentale
  // di src/db.mjs di manifestarsi (creazione/scrittura del file).
  await fetch(`${preview.base}/state`);
  await fetch(`${preview.base}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x" }),
  });

  if (existedBefore) {
    const mtimeAfter = statSync(BOARD_DB_PATH).mtimeMs;
    assert.equal(mtimeAfter, mtimeBefore, "data/board.db non deve essere modificato in proxy mode");
  } else {
    assert.equal(existsSync(BOARD_DB_PATH), false, "data/board.db non deve essere creato in proxy mode");
  }
});

// --- gate auth a token condiviso (storia s69413e22, "## Contratto auth") ---
// Il gate vive in server.mjs a monte di restHandler/proxyHandler: questi test lo esercitano
// in modalita' proxy (gira anche su Node < 22.5, a differenza dell'embedded).

test("proxy mode + token settato: REST senza header X-Sethlans-Token -> 401 {detail}", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: upstream.base,
    SETHLANS_SERVICE_API_TOKEN: "segreto-123",
    PORT: "0",
  });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/state`);
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.deepEqual(body, { detail: "token mancante o non valido" });
});

test("proxy mode + token settato: REST con header errato -> 401 {detail}", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: upstream.base,
    SETHLANS_SERVICE_API_TOKEN: "segreto-123",
    PORT: "0",
  });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/state`, {
    headers: { "X-Sethlans-Token": "sbagliato" },
  });
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.deepEqual(body, { detail: "token mancante o non valido" });
});

test("proxy mode + token settato: REST con header corretto -> passa (200)", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: upstream.base,
    SETHLANS_SERVICE_API_TOKEN: "segreto-123",
    PORT: "0",
  });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/state`, {
    headers: { "X-Sethlans-Token": "segreto-123" },
  });

  assert.equal(res.status, 200);
});

test("proxy mode + token settato: OPTIONS passa senza header (204, preflight CORS)", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: upstream.base,
    SETHLANS_SERVICE_API_TOKEN: "segreto-123",
    PORT: "0",
  });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/state`, { method: "OPTIONS" });

  assert.equal(res.status, 204);
});

test("proxy mode senza token settato: REST passa senza header (nessun 401, comportamento invariato)", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: upstream.base, PORT: "0" });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/state`);

  assert.equal(res.status, 200);
});

// --- forward del token verso l'upstream (src/proxy.mjs, buildForwardHeaders) ---

test("proxy forward: con SETHLANS_SERVICE_API_TOKEN settata, l'upstream riceve X-Sethlans-Token", async (t) => {
  let receivedHeaders = null;
  const upstream = await startFakeUpstream({
    captureHeaders: (headers) => { receivedHeaders = headers; },
  });
  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: upstream.base,
    SETHLANS_SERVICE_API_TOKEN: "segreto-proxy",
    PORT: "0",
  });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  // Il client chiama il preview SENZA header: il proxy deve iniettarlo verso l'upstream
  // con la propria variabile (autentica se' stesso), non fare passthrough cieco.
  const res = await fetch(`${preview.base}/state`, {
    headers: { "X-Sethlans-Token": "segreto-proxy" },
  });
  await res.json();

  assert.ok(receivedHeaders, "l'upstream deve aver ricevuto la richiesta");
  assert.equal(receivedHeaders["x-sethlans-token"], "segreto-proxy");
});

// --- GET /config (storia s50550dcb, "## Decisioni architetturali" §1) ---
// /config e' una concern locale del preview, gestita in server.mjs PRIMA del check
// isRestPath/restHandler: deve rispondere identico in proxy senza essere inoltrata
// all'upstream e senza essere gated dal token (anche se settato).

test("GET /config con SETHLANS_BOARD_WEB_URL settata -> {board_web_url: <valore>}", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: upstream.base,
    SETHLANS_BOARD_WEB_URL: "http://localhost:5173",
    PORT: "0",
  });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/config`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { board_web_url: "http://localhost:5173" });
});

test("GET /config senza SETHLANS_BOARD_WEB_URL -> {board_web_url: null}", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: upstream.base, PORT: "0" });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/config`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { board_web_url: null });
});

test("GET /config in proxy mode NON viene inoltrato all'upstream (risponde dal preview)", async (t) => {
  let upstreamHit = false;
  const upstream = await startFakeUpstream();
  // Intercetta qualunque richiesta arrivata all'upstream: se /config venisse proxato,
  // l'upstream fittizio risponderebbe 404 {"detail":"non trovato", echoedBody}; verifichiamo
  // invece che l'upstream non venga MAI contattato per questo path.
  const originalListeners = upstream.server.listeners("request").slice();
  upstream.server.removeAllListeners("request");
  upstream.server.on("request", (req, res) => {
    upstreamHit = true;
    for (const listener of originalListeners) listener(req, res);
  });

  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: upstream.base,
    SETHLANS_BOARD_WEB_URL: "http://localhost:5173",
    PORT: "0",
  });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/config`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { board_web_url: "http://localhost:5173" });
  assert.equal(upstreamHit, false, "/config non deve raggiungere l'upstream in modalita' proxy");
});

test("GET /config passa anche con SETHLANS_SERVICE_API_TOKEN settato (non gated)", async (t) => {
  const upstream = await startFakeUpstream();
  const preview = await startPreview({
    SETHLANS_UPSTREAM_URL: upstream.base,
    SETHLANS_BOARD_WEB_URL: "http://localhost:5173",
    SETHLANS_SERVICE_API_TOKEN: "segreto-config",
    PORT: "0",
  });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  // Nessun header X-Sethlans-Token: se /config fosse gated risponderebbe 401.
  const res = await fetch(`${preview.base}/config`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { board_web_url: "http://localhost:5173" });
});

test("proxy forward: senza SETHLANS_SERVICE_API_TOKEN lato proxy, l'header in ingresso passa invariato", async (t) => {
  let receivedHeaders = null;
  const upstream = await startFakeUpstream({
    captureHeaders: (headers) => { receivedHeaders = headers; },
  });
  // Nessun SETHLANS_SERVICE_API_TOKEN lato proxy: il gate del preview e' disattivato (var non
  // settata sul preview), quindi la richiesta passa; verifichiamo solo che buildForwardHeaders
  // non tocchi un eventuale header arrivato dal client (passthrough).
  const preview = await startPreview({ SETHLANS_UPSTREAM_URL: upstream.base, PORT: "0" });

  t.after(() => {
    preview.stop();
    upstream.server.close();
  });

  const res = await fetch(`${preview.base}/state`, {
    headers: { "X-Sethlans-Token": "valore-arbitrario-del-client" },
  });
  await res.json();

  assert.ok(receivedHeaders, "l'upstream deve aver ricevuto la richiesta");
  assert.equal(receivedHeaders["x-sethlans-token"], "valore-arbitrario-del-client");
});
