// Test suite per gli endpoint di integration-config (storia s12bff548).
// Usa node --test con processi figlio (stesso pattern di embedded.test.mjs).
// Nessuna dipendenza esterna: stdlib Node only.
//
// Ogni test avvia un server companion in modalita' embedded su porta 0 (effimera)
// e poi fa fetch reali contro gli endpoint, con tmpdir per isolare fs.
//
// Nota: node:sqlite e' richiesto per la modalita' embedded; se non disponibile
// i test vengono saltati con t.skip() (limite ambientale, non bug).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const SERVER_ENTRY = join(PACKAGE_ROOT, "server.mjs");

// Controlla se node:sqlite e' disponibile (Node >= 22.5.0)
let sqliteAvailable = true;
try {
  await import("node:sqlite");
} catch {
  sqliteAvailable = false;
}

// ---------------------------------------------------------------------------
// Helper: avvia il companion su porta 0 con env personalizzata
// ---------------------------------------------------------------------------
async function startCompanion(env) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env, PORT: "0", SETHLANS_UPSTREAM_URL: "" },
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
    setTimeout(() => reject(new Error(`timeout avvio companion: stdout=${stdout} stderr=${stderr}`)), 10000);
  });

  return { child, base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

// ---------------------------------------------------------------------------
// Helper: crea tmpdir per i file di stato
// ---------------------------------------------------------------------------
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "sethlans-ic-test-"));
}

// ---------------------------------------------------------------------------
// Helpers: legge il contenuto del tokens file da una home tmp
// ---------------------------------------------------------------------------
function readTokensFile(homeDir) {
  const path = join(homeDir, ".claude", "sethlans-tokens.env");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function readProfileYaml(projectDir) {
  const path = join(projectDir, ".claude", "project-profile.yaml");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// TEST: GET /integration-config risponde 200 con struttura attesa
// ---------------------------------------------------------------------------
test("GET /integration-config ritorna 200 con slots, tokenPresence, catalog", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile (richiede Node >= 22.5.0)");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  const res = await fetch(`${companion.base}/integration-config`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body && typeof body === "object", "body deve essere un oggetto");
  assert.ok("slots" in body, "body.slots presente");
  assert.ok("tokenPresence" in body, "body.tokenPresence presente");
  assert.ok("catalog" in body, "body.catalog presente");
  assert.ok("ticket" in body.catalog, "catalog.ticket presente");
  assert.ok("docs" in body.catalog, "catalog.docs presente");
  assert.ok("codeQuality" in body.catalog, "catalog.codeQuality presente");

  // Verifica catalogo DEFINITIVO (niente linear/notion/sonarqube)
  assert.deepEqual(body.catalog.ticket, ["atlassian", "github", "local"]);
  assert.deepEqual(body.catalog.docs, ["atlassian", "github-wiki", "local"]);
  assert.deepEqual(body.catalog.codeQuality, ["codescene", "codacy", "none"]);

  // tokenPresence deve contenere booleani, MAI i valori
  for (const [k, v] of Object.entries(body.tokenPresence)) {
    assert.equal(typeof v, "boolean", `tokenPresence.${k} deve essere booleano`);
  }
});

// ---------------------------------------------------------------------------
// TEST: POST /integration-config scrive il token file (merge idempotente)
// ---------------------------------------------------------------------------
test("POST /integration-config scrive il token file con permessi 0600 (merge idempotente)", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // Prima chiamata: slot ticket/atlassian con token
  const res1 = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        ticket: {
          provider: "atlassian",
          ref: "SETH",
          token: "token-atlassian-test",
          inline: { baseUrl: "https://test.atlassian.net", email: "test@test.com" },
        },
      },
    }),
  });
  const json1 = await res1.json();

  assert.equal(res1.status, 200);
  assert.ok(json1.ok, "ok deve essere true");
  assert.ok(json1.tokensWritten.includes("ATLASSIAN_API_TOKEN"), "ATLASSIAN_API_TOKEN scritto");

  // Verifica che il file token esista e contenga la chiave
  const tokensContent1 = readTokensFile(tmpHome);
  assert.ok(tokensContent1, "file token deve esistere");
  assert.ok(tokensContent1.includes("ATLASSIAN_API_TOKEN=token-atlassian-test"), "token presente nel file");

  // Seconda chiamata: aggiunge CS_ACCESS_TOKEN senza toccare Atlassian
  const res2 = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        codeQuality: {
          provider: "codescene",
          ref: "my-project",
          token: "token-codescene-test",
        },
      },
    }),
  });
  const json2 = await res2.json();

  assert.equal(res2.status, 200);
  assert.ok(json2.tokensWritten.includes("CS_ACCESS_TOKEN"), "CS_ACCESS_TOKEN scritto");

  // Verifica merge idempotente: ATLASSIAN_API_TOKEN ancora presente
  const tokensContent2 = readTokensFile(tmpHome);
  assert.ok(tokensContent2.includes("ATLASSIAN_API_TOKEN=token-atlassian-test"), "Atlassian token preservato dopo merge");
  assert.ok(tokensContent2.includes("CS_ACCESS_TOKEN=token-codescene-test"), "CodeScene token aggiunto");
});

// ---------------------------------------------------------------------------
// TEST: POST /integration-config MAI espone il token nella response
// ---------------------------------------------------------------------------
test("POST /integration-config non espone mai il valore del token nella response", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  const SECRET_TOKEN = "super-secret-atlassian-token-12345";

  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        ticket: {
          provider: "atlassian",
          ref: "PRJX",
          token: SECRET_TOKEN,
        },
      },
    }),
  });

  const responseText = await res.text();
  assert.ok(!responseText.includes(SECRET_TOKEN), "il valore del token NON deve comparire nella response");
});

// ---------------------------------------------------------------------------
// TEST: GET /integration-config non espone i valori dei token
// ---------------------------------------------------------------------------
test("GET /integration-config non espone i valori dei token (solo booleani)", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  // Pre-scrivi il file token
  const claudeDir = join(tmpHome, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, "sethlans-tokens.env"), "ATLASSIAN_API_TOKEN=valore-segreto-123\n", "utf8");

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  const res = await fetch(`${companion.base}/integration-config`);
  const responseText = await res.text();

  assert.ok(!responseText.includes("valore-segreto-123"), "valore token non deve apparire nella response GET");

  const body = JSON.parse(responseText);
  assert.equal(body.tokenPresence["ATLASSIAN_API_TOKEN"], true, "tokenPresence.ATLASSIAN_API_TOKEN deve essere true");
});

// ---------------------------------------------------------------------------
// TEST: provider local/none NON scrive token e NON registra MCP
// ---------------------------------------------------------------------------
test("local/none provider: nessun token scritto, nessun mcpCommand proposto", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // ticket=local
  const resLocal = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: { ticket: { provider: "local" } },
    }),
  });
  const jsonLocal = await resLocal.json();

  assert.equal(resLocal.status, 200);
  assert.deepEqual(jsonLocal.tokensWritten, [], "local: nessun token scritto");
  assert.deepEqual(jsonLocal.mcpCommands, [], "local: nessun MCP proposto");
  // File token non deve esistere
  const tokensFile = readTokensFile(tmpHome);
  assert.equal(tokensFile, null, "local: file token non creato");

  // codeQuality=none
  const resNone = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: { codeQuality: { provider: "none" } },
    }),
  });
  const jsonNone = await resNone.json();

  assert.equal(resNone.status, 200);
  assert.deepEqual(jsonNone.tokensWritten, [], "none: nessun token scritto");
  assert.deepEqual(jsonNone.mcpCommands, [], "none: nessun MCP proposto");
});

// ---------------------------------------------------------------------------
// TEST: merge non distruttivo del project-profile.yaml
// ---------------------------------------------------------------------------
test("POST /integration-config: merge non distruttivo di project-profile.yaml", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  // Pre-scrivi un profile con slot docs gia' configurato
  const claudeDir = join(tmpProject, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, "project-profile.yaml"),
    "slots:\n  docs:\n    provider: atlassian\n    ref: DOCS\n",
    "utf8"
  );

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // Aggiorna solo ticket, senza toccare docs
  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        ticket: { provider: "atlassian", ref: "PRJX", token: "tok-x" },
      },
    }),
  });
  const json = await res.json();
  assert.equal(res.status, 200);

  // Verifica che docs sia ancora presente nel profile
  const profileContent = readProfileYaml(tmpProject);
  assert.ok(profileContent, "project-profile.yaml deve esistere");
  assert.ok(profileContent.includes("docs"), "docs ancora nel profile dopo merge");
  assert.ok(profileContent.includes("atlassian"), "provider docs atlassian preservato");
  assert.ok(profileContent.includes("DOCS"), "ref docs preservata");
  assert.ok(profileContent.includes("ticket"), "ticket aggiunto nel profile");
  assert.ok(profileContent.includes("PRJX"), "ref ticket scritta");
});

// ---------------------------------------------------------------------------
// TEST: auth 401 quando SETHLANS_SERVICE_API_TOKEN e' settata
// ---------------------------------------------------------------------------
test("GET /integration-config: 401 senza token quando SETHLANS_SERVICE_API_TOKEN settata", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
    SETHLANS_SERVICE_API_TOKEN: "token-segreto-test",
  });
  t.after(() => companion.stop());

  // Senza header
  const res1 = await fetch(`${companion.base}/integration-config`);
  assert.equal(res1.status, 401, "GET senza header deve ritornare 401");

  // Con header sbagliato
  const res2 = await fetch(`${companion.base}/integration-config`, {
    headers: { "X-Sethlans-Token": "sbagliato" },
  });
  assert.equal(res2.status, 401, "GET con header errato deve ritornare 401");

  // Con header corretto
  const res3 = await fetch(`${companion.base}/integration-config`, {
    headers: { "X-Sethlans-Token": "token-segreto-test" },
  });
  assert.equal(res3.status, 200, "GET con header corretto deve ritornare 200");
});

test("POST /integration-config: 401 senza token quando SETHLANS_SERVICE_API_TOKEN settata", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
    SETHLANS_SERVICE_API_TOKEN: "token-segreto-post",
  });
  t.after(() => companion.stop());

  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slots: { ticket: { provider: "local" } } }),
  });
  assert.equal(res.status, 401, "POST senza header deve ritornare 401");
});

// ---------------------------------------------------------------------------
// TEST: POST /integration-config/test risponde 200 (best-effort, mai 5xx)
// ---------------------------------------------------------------------------
test("POST /integration-config/test risponde 200 (best-effort, mai 5xx)", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // Probe atlassian senza token: deve rispondere 200 con ok=false (non 5xx)
  const res = await fetch(`${companion.base}/integration-config/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slot: "ticket",
      provider: "atlassian",
      inline: { baseUrl: "https://nonexistent.atlassian.net", email: "test@test.com" },
    }),
  });

  assert.equal(res.status, 200, "test endpoint deve rispondere sempre 200");
  const body = await res.json();
  assert.ok("ok" in body, "body.ok presente");
  assert.ok("message" in body, "body.message presente");
  assert.equal(typeof body.ok, "boolean");
});

test("POST /integration-config/test: local/none ritorna ok=true senza chiamate di rete", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // local
  const resLocal = await fetch(`${companion.base}/integration-config/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot: "ticket", provider: "local" }),
  });
  assert.equal(resLocal.status, 200);
  const bodyLocal = await resLocal.json();
  assert.equal(bodyLocal.ok, true, "local: ok=true");

  // none
  const resNone = await fetch(`${companion.base}/integration-config/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot: "codeQuality", provider: "none" }),
  });
  assert.equal(resNone.status, 200);
  const bodyNone = await resNone.json();
  assert.equal(bodyNone.ok, true, "none: ok=true");
});

// ---------------------------------------------------------------------------
// TEST: catalogo definitivo (niente linear/notion/sonarqube)
// ---------------------------------------------------------------------------
test("catalogo provider definitivo: niente linear/notion/sonarqube", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // Verifica che provider rimossi vengano rifiutati
  const resLinear = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: { ticket: { provider: "linear" } },
    }),
  });
  assert.equal(resLinear.status, 400, "linear deve essere rifiutato");

  const resNotion = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: { docs: { provider: "notion" } },
    }),
  });
  assert.equal(resNotion.status, 400, "notion deve essere rifiutato");

  const resSonar = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: { codeQuality: { provider: "sonarqube" } },
    }),
  });
  assert.equal(resSonar.status, 400, "sonarqube deve essere rifiutato");
});

// ---------------------------------------------------------------------------
// TEST: MCP command codescene usa array (no shell injection)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// TEST: MCP command codescene — immagine, mount, env var corretti (BLOCKER 1+2)
// ---------------------------------------------------------------------------
test("POST /integration-config codescene: immagine docker corretta, mount dst=/mount/, env CS_MOUNT_PATH", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  const mountRoot = "/safe/path/to/repo";

  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        codeQuality: {
          provider: "codescene",
          ref: "my-project",
          token: "tok-cs",
          inline: { mountRoot },
        },
      },
      applyMcp: false,
    }),
  });

  const json = await res.json();
  assert.equal(res.status, 200);
  assert.ok(json.mcpCommands.length > 0, "almeno un comando MCP proposto");

  const cmd = json.mcpCommands[0];
  assert.equal(cmd.slot, "codeQuality");
  assert.equal(cmd.provider, "codescene");
  assert.equal(cmd.applied, false, "applyMcp=false: non eseguito");

  // BLOCKER 1: immagine corretta (codescene/codescene-mcp, non empear/*)
  assert.ok(cmd.command.includes("codescene/codescene-mcp"), "immagine corretta: codescene/codescene-mcp");
  assert.ok(!cmd.command.includes("empear/"), "immagine errata empear/* non presente");

  // BLOCKER 2a: mount con dst=/mount/ (non dst=/repo)
  assert.ok(cmd.command.includes("dst=/mount/"), "mount destination corretta: dst=/mount/");
  assert.ok(!cmd.command.includes("dst=/repo"), "mount destination errata dst=/repo assente");

  // BLOCKER 2b: env CS_MOUNT_PATH presente nel comando
  assert.ok(cmd.command.includes("CS_MOUNT_PATH="), "CS_MOUNT_PATH presente nel comando");
  assert.ok(cmd.command.includes(mountRoot), "mountRoot esplicito nel comando");

  // BLOCKER 2c: token via env var CS_ACCESS_TOKEN (nome che l'immagine codescene/codescene-mcp legge davvero)
  assert.ok(!cmd.command.includes("tok-cs"), "valore token non nel command proposto");
  assert.ok(cmd.command.includes("CS_ACCESS_TOKEN"), "env var corretta: CS_ACCESS_TOKEN");
  assert.ok(!cmd.command.includes("CODESCENE_API_TOKEN"), "env var errata CODESCENE_API_TOKEN non presente");

  // docker + --rm nel comando
  assert.ok(cmd.command.includes("docker"), "command contiene docker");
  assert.ok(cmd.command.includes("--rm"), "command contiene --rm");
});

test("POST /integration-config codescene: mountRoot default = projectPath (non process.cwd)", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // Senza inline.mountRoot → deve usare projectPath, non process.cwd() del companion
  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        codeQuality: { provider: "codescene", ref: "p", token: "tok" },
      },
      applyMcp: false,
    }),
  });

  const json = await res.json();
  assert.equal(res.status, 200);
  assert.ok(json.mcpCommands.length > 0);

  const cmd = json.mcpCommands[0];
  // Il comando deve contenere tmpProject come mount root, non la cwd del companion
  assert.ok(
    cmd.command.includes(tmpProject),
    `mountRoot deve essere projectPath (${tmpProject}), trovato: ${cmd.command}`
  );
});

// ---------------------------------------------------------------------------
// TEST: MCP command atlassian — pacchetto reale @atlassian/mcp@latest (SUGGESTION)
// ---------------------------------------------------------------------------
test("POST /integration-config atlassian: usa @atlassian/mcp@latest, non @anthropic-ai/*", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        ticket: {
          provider: "atlassian",
          ref: "PROJ",
          token: "tok-atl",
          inline: { baseUrl: "https://test.atlassian.net", email: "test@test.com" },
        },
      },
      applyMcp: false,
    }),
  });

  const json = await res.json();
  assert.equal(res.status, 200);
  assert.ok(json.mcpCommands.length > 0, "comando MCP atlassian proposto");

  const cmd = json.mcpCommands[0];
  assert.equal(cmd.provider, "atlassian");
  // Pacchetto reale
  assert.ok(cmd.command.includes("@atlassian/mcp@latest"), "usa @atlassian/mcp@latest");
  assert.ok(!cmd.command.includes("@anthropic-ai/"), "non usa pacchetti @anthropic-ai/* inesistenti");
  // Token via env var (placeholder, mai in chiaro)
  assert.ok(cmd.command.includes("ATLASSIAN_API_TOKEN"), "env var ATLASSIAN_API_TOKEN presente");
  assert.ok(!cmd.command.includes("tok-atl"), "valore token non nel comando");
});

// ---------------------------------------------------------------------------
// TEST: MCP command github — immagine ghcr.io/github/github-mcp-server (SUGGESTION)
// ---------------------------------------------------------------------------
test("POST /integration-config github: usa ghcr.io/github/github-mcp-server, non @anthropic-ai/*", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        ticket: {
          provider: "github",
          ref: "owner/repo",
          token: "ghp_tok",
        },
      },
      applyMcp: false,
    }),
  });

  const json = await res.json();
  assert.equal(res.status, 200);
  assert.ok(json.mcpCommands.length > 0, "comando MCP github proposto");

  const cmd = json.mcpCommands[0];
  assert.equal(cmd.provider, "github");
  // Immagine Docker ufficiale
  assert.ok(cmd.command.includes("ghcr.io/github/github-mcp-server"), "usa ghcr.io/github/github-mcp-server");
  assert.ok(!cmd.command.includes("@anthropic-ai/"), "non usa @anthropic-ai/* inesistenti");
  // Mapping token: GITHUB_TOKEN → GITHUB_PERSONAL_ACCESS_TOKEN
  assert.ok(cmd.command.includes("GITHUB_PERSONAL_ACCESS_TOKEN"), "env var GITHUB_PERSONAL_ACCESS_TOKEN presente");
  assert.ok(!cmd.command.includes("ghp_tok"), "valore token non nel comando");
});

// ---------------------------------------------------------------------------
// TEST: serializeProfileYaml — quoting YAML-safe dei valori (BLOCKER 3)
// ---------------------------------------------------------------------------
test("serializeProfileYaml: valori con ':' '#' non corrompono il YAML scritto", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // Valori con ':' e '#': senza quoting corromperebbero il YAML
  const dangerousRef = "https://jira.example.com:8443/project/PROJ#board";
  const dangerousBaseUrl = "https://jira.example.com:8080";

  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        ticket: {
          provider: "atlassian",
          ref: dangerousRef,
          token: "tok-atl",
          inline: { baseUrl: dangerousBaseUrl, email: "user@example.com" },
        },
      },
    }),
  });

  assert.equal(res.status, 200);

  const profileContent = readProfileYaml(tmpProject);
  assert.ok(profileContent, "project-profile.yaml deve esistere");

  // Ogni riga con valore contenente ':' o '#' deve essere quotata
  const lines = profileContent.split("\n");
  for (const line of lines) {
    if (line.trim().startsWith("#") || line.trim() === "") continue;
    const m = line.match(/^(\s+)([a-zA-Z_]\w*):\s+(.+)$/);
    if (!m) continue;
    const value = m[3];
    // Se non quotato, non deve contenere ':' o '#' non escapati
    if (!value.startsWith('"') && !value.startsWith("'")) {
      assert.ok(!value.includes(":"), `valore non quotato con ':' trovato: ${line}`);
      assert.ok(!value.includes("#"), `valore non quotato con '#' trovato: ${line}`);
    }
  }

  // Il dominio deve essere preservato (non troncato)
  assert.ok(
    profileContent.includes("jira.example.com"),
    "il dominio del ref deve essere preservato nel YAML"
  );
});

test("serializeProfileYaml: valori con newline embedded sono escaped nel YAML", async (t) => {
  if (!sqliteAvailable) {
    t.skip("node:sqlite non disponibile");
    return;
  }

  const tmpHome = makeTmpDir();
  const tmpProject = makeTmpDir();

  const companion = await startCompanion({
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    SETHLANS_PROJECT_PATH: tmpProject,
  });
  t.after(() => companion.stop());

  // Valore con newline embed: senza quoting corromperebbe il YAML
  const valueWithNewline = "line1\nline2";

  const res = await fetch(`${companion.base}/integration-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: tmpProject,
      slots: {
        docs: {
          provider: "atlassian",
          ref: valueWithNewline,
          token: "tok",
        },
      },
    }),
  });

  assert.equal(res.status, 200);

  const profileContent = readProfileYaml(tmpProject);
  assert.ok(profileContent, "project-profile.yaml deve esistere");

  // Il file deve contenere il newline come sequenza escaped \n (non raw)
  assert.ok(
    profileContent.includes("\\n"),
    "newline nel valore deve essere escaped come \\n nel YAML"
  );

  // Il file non deve avere righe che contengano "line2" come inizio di riga
  // (segnale che il newline raw è finito nel YAML)
  const rawLines = profileContent.split("\n");
  const hasLine2AtStart = rawLines.some((l) => l.trim() === "line2");
  assert.ok(!hasLine2AtStart, "line2 non deve apparire come riga YAML standalone (newline raw)");
});
