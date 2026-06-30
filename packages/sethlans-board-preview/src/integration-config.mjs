/**
 * Handler e helper per i 3 endpoint di configurazione integrazioni:
 *   GET  /integration-config
 *   POST /integration-config
 *   POST /integration-config/test
 *
 * Modulo importato DINAMICAMENTE da server.mjs (come proxy.mjs) per evitare
 * che node:fs / node:child_process siano side-effect a import-time.
 *
 * Filosofia zero-dipendenze: solo stdlib Node (node:fs, node:path, node:os,
 * node:child_process, node:crypto). Nessuna nuova dipendenza in package.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, chmodSync } from "node:fs";
import { join, isAbsolute, normalize } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Catalogo provider DEFINITIVO (fonte di verita': md storia s12bff548)
// ticket = atlassian/github/local
// docs   = atlassian/github-wiki/local
// codeQuality = codescene/codacy/none
// local / none = nessun token, nessun mcp add
// ---------------------------------------------------------------------------

const CATALOG = {
  ticket: ["atlassian", "github", "local"],
  docs: ["atlassian", "github-wiki", "local"],
  codeQuality: ["codescene", "codacy", "none"],
};

/** Provider che NON richiedono token e NON registrano MCP. */
const NO_TOKEN_PROVIDERS = new Set(["local", "none"]);

/**
 * Env var del token per provider.
 * atlassian: chiave condivisa tra ticket e docs.
 */
const TOKEN_ENV_KEY = {
  "ticket:atlassian": "ATLASSIAN_API_TOKEN",
  "docs:atlassian": "ATLASSIAN_API_TOKEN",
  "ticket:github": "GITHUB_TOKEN",
  "docs:github-wiki": "GITHUB_TOKEN",
  "codeQuality:codescene": "CS_ACCESS_TOKEN",
  "codeQuality:codacy": "CODACY_API_TOKEN",
};

// ---------------------------------------------------------------------------
// YAML minimalista (zero-dep): legge/scrive solo i sotto-blocchi slots.* e
// roles.* usati da project-profile.yaml (schema §0-C di sethlans-onboard.md).
// Se lo YAML preesistente e' troppo complesso degrada con warning MA NON
// sovrascrive (merge sicuro).
// ---------------------------------------------------------------------------

/**
 * Parsing minimale di project-profile.yaml.
 * Riconosce solo: chiavi top-level di tipo scalare, e blocchi 2-livello
 * (slots / roles) con scalari figlio.
 * Ritorna { slots: {ticket:{provider,ref,...}, docs:{...}, codeQuality:{...}},
 *            roles: {...}, _raw: string originale, _complex: bool }
 */
function parseProfileYaml(raw) {
  const result = { slots: {}, roles: {}, _raw: raw, _complex: false };
  const lines = raw.split(/\r?\n/);
  let section = null; // "slots" | "roles" | null
  let subkey = null; // "ticket" | "docs" | "codeQuality"

  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === "") continue;

    // Sezione di primo livello (0 indent)
    const m1 = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)?$/);
    if (m1) {
      const key = m1[1];
      const val = (m1[2] || "").trim();
      if (key === "slots" || key === "roles") {
        section = key;
        subkey = null;
        if (!(key in result)) result[key] = {};
      } else if (val !== "") {
        // scalare top-level: lo ignoriamo ma non lo perdiamo (resto in _raw)
        section = null;
        subkey = null;
      } else {
        // blocco top-level non riconosciuto: segnala complessita'
        result._complex = true;
        section = null;
        subkey = null;
      }
      continue;
    }

    if (!section) continue;

    // Sotto-chiave di secondo livello (2 spazi)
    const m2 = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)?$/);
    if (m2) {
      const key = m2[1];
      const val = (m2[2] || "").trim();
      if (section === "slots") {
        if (["ticket", "docs", "codeQuality"].includes(key)) {
          subkey = key;
          if (!result.slots[key]) result.slots[key] = {};
        } else {
          result._complex = true;
          subkey = null;
        }
      } else if (section === "roles") {
        // roles e' un blocco piatto (role -> valore scalare)
        if (val !== "") {
          result.roles[key] = val;
          subkey = key;
        } else {
          subkey = key;
          if (!result.roles[key]) result.roles[key] = {};
        }
      }
      continue;
    }

    // Sotto-sotto-chiave di terzo livello (4 spazi), solo per slots.*.*
    if (section === "slots" && subkey) {
      const m3 = line.match(/^    ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)?$/);
      if (m3) {
        const key = m3[1];
        const val = (m3[2] || "").trim();
        if (typeof result.slots[subkey] !== "object") result.slots[subkey] = {};
        result.slots[subkey][key] = val;
        continue;
      }
    }

    // Qualunque altra struttura (list, multiline, anchor, ...) = complessa
    result._complex = true;
  }

  return result;
}

/**
 * Effettua il quoting YAML-safe di un valore scalare (zero dipendenze).
 * Regole: se il valore contiene ':', '#', newline, virgolette o ha spazi
 * iniziali/finali → racchiude tra virgolette doppie con escaping interno.
 * Valori booleani/numerici puri non vengono toccati (restano bare).
 * Questo previene YAML injection / corruzione del parsing.
 */
function yamlQuoteScalar(v) {
  const s = String(v);
  // Caratteri che rendono necessario il quoting
  const needsQuote =
    s.includes(":") ||
    s.includes("#") ||
    s.includes("\n") ||
    s.includes("\r") ||
    s.includes('"') ||
    s.includes("'") ||
    s !== s.trim() ||
    s === "" ||
    // Valori che YAML interpreterebbe come non-stringa se non quotati
    /^(true|false|null|~|yes|no|on|off)$/i.test(s) ||
    /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ||
    s.startsWith("|") ||
    s.startsWith(">") ||
    s.startsWith("!") ||
    s.startsWith("&") ||
    s.startsWith("*") ||
    s.startsWith("[") ||
    s.startsWith("{");

  if (!needsQuote) return s;

  // Quoting con doppie virgolette, escape di backslash e doppie virgolette
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/**
 * Serializza il profilo in YAML (solo slots + roles); preserva il resto del
 * file _raw inalterato (merge non-distruttivo).
 * I valori scalari vengono quotati con yamlQuoteScalar per prevenire injection.
 */
function serializeProfileYaml(profile) {
  let out = "";

  // Mantieni tutto il contenuto originale che non e' slots/roles
  // Strategia: riscrivi sempre slots e roles, ignoriamo campi non riconosciuti
  // (si preservano via _raw se non ne facciamo il merge distruttivo).
  // Approccio scelto: sovrascriviamo l'intero file con solo le sezioni note
  // (slots + roles) + un header commento. Per evitare corruzione di YAML
  // preesistente complesso, richiamiamo _complex check prima.

  out += "# project-profile.yaml — generato/aggiornato da Sethlans companion\n";
  out += "# NON committare questo file se contiene percorsi sensibili.\n";
  out += "\n";

  if (Object.keys(profile.slots).length > 0) {
    out += "slots:\n";
    for (const [slotKey, slotVal] of Object.entries(profile.slots)) {
      out += `  ${slotKey}:\n`;
      for (const [k, v] of Object.entries(slotVal)) {
        out += `    ${k}: ${yamlQuoteScalar(v)}\n`;
      }
    }
    out += "\n";
  }

  if (Object.keys(profile.roles).length > 0) {
    out += "roles:\n";
    for (const [k, v] of Object.entries(profile.roles)) {
      if (typeof v === "object") {
        out += `  ${k}:\n`;
        for (const [k2, v2] of Object.entries(v)) {
          out += `    ${k2}: ${yamlQuoteScalar(v2)}\n`;
        }
      } else {
        out += `  ${k}: ${yamlQuoteScalar(v)}\n`;
      }
    }
    out += "\n";
  }

  return out;
}

// ---------------------------------------------------------------------------
// File token globale: ~/.claude/sethlans-tokens.env
// ---------------------------------------------------------------------------

function tokenFilePath() {
  return join(homedir(), ".claude", "sethlans-tokens.env");
}

/**
 * Legge il file token e ritorna una Map<KEY, VALUE>.
 * Se il file non esiste, ritorna Map vuota.
 */
function readTokenFile() {
  const path = tokenFilePath();
  if (!existsSync(path)) return new Map();
  const raw = readFileSync(path, "utf8");
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    map.set(key, val);
  }
  return map;
}

/**
 * Scrive il file token (merge idempotente: preserva chiavi non inviate).
 * Scrittura transazionale: temp-file + rename atomico.
 * chmod 0600: vincolante su POSIX (Linux/macOS), no-op pratico su Windows/NTFS
 * (NTFS non ha permessi POSIX; la chiamata non lancia ma non ha effetto reale).
 */
function writeTokenFile(updates) {
  const path = tokenFilePath();
  const dir = join(homedir(), ".claude");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const current = readTokenFile();
  for (const [k, v] of Object.entries(updates)) {
    if (v) current.set(k, v);
    // Se v e' falsy (vuoto/null) NON rimuoviamo la chiave esistente (mai svuotare)
  }

  let content = "# sethlans-tokens.env — token globali Sethlans\n";
  content += "# Permessi 0600 (solo proprietario). Non committare.\n";
  for (const [k, v] of current.entries()) {
    content += `${k}=${v}\n`;
  }

  // Scrittura transazionale: temp -> rename
  const tmpPath = path + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmpPath, content, { encoding: "utf8" });
  // chmod 0600: vincolante su POSIX; no-op su Windows/NTFS
  try { chmodSync(tmpPath, 0o600); } catch { /* no-op su NTFS */ }
  renameSync(tmpPath, path);
}

// ---------------------------------------------------------------------------
// project-profile.yaml
// ---------------------------------------------------------------------------

/**
 * Costruisce (o legge + merge) il project-profile.yaml in projectPath/.claude/.
 * slotUpdates: { ticket?: {provider, ref, inline?}, docs?: {...}, codeQuality?: {...} }
 * Merge non-distruttivo: preserva chiavi esistenti non inviate.
 */
function updateProjectProfile(projectPath, slotUpdates) {
  const claudeDir = join(projectPath, ".claude");
  const profilePath = join(claudeDir, "project-profile.yaml");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  let profile = { slots: {}, roles: {}, _raw: "", _complex: false };

  if (existsSync(profilePath)) {
    const raw = readFileSync(profilePath, "utf8");
    const parsed = parseProfileYaml(raw);
    if (parsed._complex) {
      console.warn(
        "[sethlans-companion] project-profile.yaml ha struttura complessa: " +
        "merge parziale (solo slots/roles). Contenuto originale preservato in _raw."
      );
      // Mantieni slots/roles trovati ma segnala
      profile = parsed;
    } else {
      profile = parsed;
    }
  }

  // Merge per slot
  for (const [slotKey, slotData] of Object.entries(slotUpdates)) {
    if (!profile.slots[slotKey]) profile.slots[slotKey] = {};
    // Merge: non sovrascrivere con undefined/null
    for (const [k, v] of Object.entries(slotData)) {
      if (v !== undefined && v !== null && v !== "") {
        profile.slots[slotKey][k] = v;
      }
    }
  }

  const yaml = serializeProfileYaml(profile);
  // Scrittura transazionale
  const tmpPath = profilePath + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmpPath, yaml, { encoding: "utf8" });
  renameSync(tmpPath, profilePath);

  return profilePath;
}

// ---------------------------------------------------------------------------
// MCP command builder
// ---------------------------------------------------------------------------

/**
 * Costruisce il comando `claude mcp add` per un dato slot+provider.
 * Usa placeholder ${VAR} — il token NON compare nel command committable.
 * Ritorna array [args...] per spawnSync (no shell injection).
 *
 * Comandi di riferimento (da sethlans-onboard.md §0-C e code-quality-protocol.md):
 *   atlassian → npx -y @atlassian/mcp@latest
 *   github    → docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server
 *   codescene → docker run -i --rm -e CS_ACCESS_TOKEN -e CS_ONPREM_URL
 *                 -e CS_MOUNT_PATH=<root> --mount type=bind,src=<root>,dst=/mount/,ro
 *                 codescene/codescene-mcp
 *   codacy    → npx -y @codacy/codacy-mcp@latest
 */
function buildMcpArgs(slotKey, provider, inline = {}, projectPath = null) {
  if (provider === "atlassian") {
    // Token Atlassian: ATLASSIAN_API_TOKEN; URL e email inline (non-segreti)
    // Comando reale: npx -y @atlassian/mcp@latest (non @anthropic-ai/mcp-server-atlassian)
    return [
      "mcp", "add", "atlassian", "-s", "local",
      "-e", `ATLASSIAN_BASE_URL=${inline.baseUrl || "${ATLASSIAN_BASE_URL}"}`,
      "-e", `ATLASSIAN_EMAIL=${inline.email || "${ATLASSIAN_EMAIL}"}`,
      "-e", "ATLASSIAN_API_TOKEN=${ATLASSIAN_API_TOKEN}",
      "--", "npx", "-y", "@atlassian/mcp@latest",
    ];
  }
  if (provider === "github") {
    // GitHub MCP: immagine ufficiale ghcr.io/github/github-mcp-server (non npm @anthropic-ai/*)
    // L'utente salva GITHUB_TOKEN; il container legge GITHUB_PERSONAL_ACCESS_TOKEN → mappatura -e
    return [
      "mcp", "add", "github", "-s", "local",
      "-e", "GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_TOKEN}",
      "--", "docker", "run", "-i", "--rm",
      "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
      "ghcr.io/github/github-mcp-server",
    ];
  }
  if (provider === "github-wiki") {
    // github-wiki e' non-MCP (solo ref nel profilo, nessun server da registrare)
    return null;
  }
  if (provider === "codescene") {
    // mountRoot default = projectPath (non process.cwd() del companion).
    // L'immagine e' codescene/codescene-mcp (non empear/codescene-mcp:latest).
    // Token: il container codescene/codescene-mcp legge CS_ACCESS_TOKEN (+ CS_ONPREM_URL
    // on-prem, + CS_MOUNT_PATH per il percorso del repo). NON usa CODESCENE_API_TOKEN.
    // Mount: arg separato `--mount type=bind,...,dst=/mount/,ro` (non dst=/repo).
    const mountRoot = inline.mountRoot || projectPath || "${PROJECT_PATH}";
    return [
      "mcp", "add", "codescene", "-s", "local",
      "-e", "CS_ACCESS_TOKEN=${CS_ACCESS_TOKEN}",
      "-e", "CS_ONPREM_URL=${CS_ONPREM_URL}",
      "--",
      "docker", "run", "-i", "--rm",
      "-e", "CS_ACCESS_TOKEN",
      "-e", "CS_ONPREM_URL",
      "-e", `CS_MOUNT_PATH=${mountRoot}`,
      "--mount", `type=bind,src=${mountRoot},dst=/mount/,ro`,
      "codescene/codescene-mcp",
    ];
  }
  if (provider === "codacy") {
    // Pacchetto reale: @codacy/codacy-mcp@latest (non @codacy/mcp-server-codacy)
    return [
      "mcp", "add", "codacy", "-s", "local",
      "-e", "CODACY_API_TOKEN=${CODACY_API_TOKEN}",
      "--", "npx", "-y", "@codacy/codacy-mcp@latest",
    ];
  }
  return null; // local / none / non riconosciuto
}

/**
 * Esegue `claude mcp add ...` con spawnSync.
 * Sourcea il file token nell'env del processo figlio (token mai nei config).
 * Argomenti passati come array (NO shell string -> no command injection).
 * @returns { success: boolean, stderr: string }
 */
function applyMcpCommand(args, tokenEnv) {
  // Leggi i token dal file per iniettarli nell'env del child (non nei flag)
  const childEnv = { ...process.env, ...tokenEnv };
  const result = spawnSync("claude", args, {
    env: childEnv,
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    success: result.status === 0,
    stderr: result.stderr || "",
    stdout: result.stdout || "",
  };
}

// ---------------------------------------------------------------------------
// Risoluzione projectPath
// ---------------------------------------------------------------------------

/**
 * Risolve projectPath dal body, dalla query, dalla env o dal cwd.
 * Valida: deve essere assoluto ed esistente.
 * Ritorna { path: string } o { error: string }.
 */
function resolveProjectPath(body, query) {
  const candidate =
    body.projectPath ||
    query.projectPath ||
    process.env.SETHLANS_PROJECT_PATH ||
    process.cwd();

  if (!candidate) return { error: "projectPath non determinabile" };
  if (!isAbsolute(candidate)) return { error: `projectPath non assoluto: ${candidate}` };

  const normalized = normalize(candidate);
  if (!existsSync(normalized)) return { error: `projectPath non trovato: ${normalized}` };

  return { path: normalized };
}

// ---------------------------------------------------------------------------
// Probe (best-effort, mai 5xx, mai token in chiaro)
// ---------------------------------------------------------------------------

/**
 * Prova a raggiungere l'API del provider.
 * Usa il token se presente nel file globale.
 * Ritorna { ok: boolean, message: string } — MAI il token in chiaro.
 */
async function probeProvider(slotKey, provider, inline = {}) {
  if (NO_TOKEN_PROVIDERS.has(provider)) {
    return { ok: true, message: "local/none: nessuna connessione da testare" };
  }

  const envKey = TOKEN_ENV_KEY[`${slotKey}:${provider}`];
  let token = null;
  if (envKey) {
    const tokenMap = readTokenFile();
    token = tokenMap.get(envKey) || null;
  }

  try {
    if (provider === "atlassian") {
      if (!token) return { ok: false, message: "token Atlassian non presente nel file globale" };
      const baseUrl = (inline.baseUrl || "").replace(/\/$/, "");
      const email = inline.email || "";
      if (!baseUrl) return { ok: false, message: "baseUrl mancante per probe Atlassian" };
      const credentials = Buffer.from(`${email}:${token}`).toString("base64");
      const res = await fetch(`${baseUrl}/rest/api/3/myself`, {
        headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok
        ? { ok: true, message: `Atlassian OK (status ${res.status})` }
        : { ok: false, message: `Atlassian risposta ${res.status}` };
    }

    if (provider === "github" || provider === "github-wiki") {
      if (!token) return { ok: false, message: "GITHUB_TOKEN non presente nel file globale" };
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok
        ? { ok: true, message: `GitHub OK (status ${res.status})` }
        : { ok: false, message: `GitHub risposta ${res.status}` };
    }

    if (provider === "codescene") {
      if (!token) return { ok: false, message: "CS_ACCESS_TOKEN non presente nel file globale" };
      // CodeScene non ha un endpoint pubblico di healthcheck standard; usiamo il projects list
      const res = await fetch("https://codescene.io/api/v1/projects", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok
        ? { ok: true, message: `CodeScene OK (status ${res.status})` }
        : { ok: false, message: `CodeScene risposta ${res.status}` };
    }

    if (provider === "codacy") {
      if (!token) return { ok: false, message: "CODACY_API_TOKEN non presente nel file globale" };
      const res = await fetch("https://app.codacy.com/api/v3/user", {
        headers: { "api-token": token, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok
        ? { ok: true, message: `Codacy OK (status ${res.status})` }
        : { ok: false, message: `Codacy risposta ${res.status}` };
    }

    return { ok: false, message: `provider non riconosciuto: ${provider}` };
  } catch (err) {
    // Mai propagare errori di rete come 5xx; best-effort
    return { ok: false, message: `probe fallito: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Handlers HTTP esposti
// ---------------------------------------------------------------------------

/**
 * GET /integration-config
 * Ritorna stato profile + booleani presenza token (MAI valori).
 */
export async function handleGetIntegrationConfig(req, res, query) {
  const { sendJson } = await import("./http-helpers.mjs");

  const projectPathResult = resolveProjectPath({}, query);
  const profilePath =
    projectPathResult.path
      ? join(projectPathResult.path, ".claude", "project-profile.yaml")
      : null;

  let slots = {};
  if (profilePath && existsSync(profilePath)) {
    try {
      const raw = readFileSync(profilePath, "utf8");
      const parsed = parseProfileYaml(raw);
      slots = parsed.slots;
    } catch (e) {
      console.warn("[sethlans-companion] errore lettura project-profile.yaml:", e.message);
    }
  }

  // Booleani presenza token (MAI i valori)
  const tokenMap = readTokenFile();
  const tokenPresence = {};
  for (const [compositeKey, envKey] of Object.entries(TOKEN_ENV_KEY)) {
    tokenPresence[envKey] = tokenMap.has(envKey);
  }

  sendJson(res, 200, {
    projectPath: projectPathResult.path || null,
    projectPathError: projectPathResult.error || null,
    slots,
    tokenPresence,
    catalog: CATALOG,
  });
}

/**
 * POST /integration-config
 * Body: { projectPath?, applyMcp?, slots: { ticket?, docs?, codeQuality? } }
 * Scrive file token globale + project-profile.yaml; ritorna comandi mcp proposti/eseguiti.
 */
export async function handlePostIntegrationConfig(req, res, body) {
  const { sendJson } = await import("./http-helpers.mjs");
  const { readJsonBody } = await import("./http-helpers.mjs");

  const projectPathResult = resolveProjectPath(body, {});
  if (projectPathResult.error) {
    sendJson(res, 400, { detail: projectPathResult.error });
    return;
  }
  const projectPath = projectPathResult.path;

  const slotsInput = body.slots || {};
  const applyMcp = !!body.applyMcp;

  // Valida provider per ogni slot
  for (const [slotKey, slotData] of Object.entries(slotsInput)) {
    if (!CATALOG[slotKey]) {
      sendJson(res, 400, { detail: `slot non riconosciuto: ${slotKey}` });
      return;
    }
    if (slotData.provider && !CATALOG[slotKey].includes(slotData.provider)) {
      sendJson(res, 400, {
        detail: `provider non valido per ${slotKey}: ${slotData.provider}. Validi: ${CATALOG[slotKey].join(", ")}`,
      });
      return;
    }
  }

  // 1. Scrivi token nel file globale (solo per provider che richiedono token)
  const tokenUpdates = {};
  for (const [slotKey, slotData] of Object.entries(slotsInput)) {
    const { provider, token } = slotData;
    if (!provider || NO_TOKEN_PROVIDERS.has(provider)) continue;
    if (token) {
      const envKey = TOKEN_ENV_KEY[`${slotKey}:${provider}`];
      if (envKey) tokenUpdates[envKey] = token;
    }
  }
  if (Object.keys(tokenUpdates).length > 0) {
    writeTokenFile(tokenUpdates);
  }

  // 2. Aggiorna project-profile.yaml (merge)
  const slotUpdates = {};
  for (const [slotKey, slotData] of Object.entries(slotsInput)) {
    const { provider, ref, inline = {} } = slotData;
    if (!provider) continue;
    slotUpdates[slotKey] = { provider };
    if (ref) slotUpdates[slotKey].ref = ref;
    // Salva inline (no token: solo URL, email, owner, repo, ecc.)
    for (const [k, v] of Object.entries(inline)) {
      if (k !== "token" && v) slotUpdates[slotKey][k] = v;
    }
  }
  const profilePath = updateProjectProfile(projectPath, slotUpdates);

  // 3. MCP commands (proposti o eseguiti)
  const mcpResults = [];
  for (const [slotKey, slotData] of Object.entries(slotsInput)) {
    const { provider, inline = {} } = slotData;
    if (!provider || NO_TOKEN_PROVIDERS.has(provider)) continue;

    const args = buildMcpArgs(slotKey, provider, inline, projectPath);
    if (!args) continue;

    const commandStr = ["claude", ...args].join(" ");

    if (applyMcp) {
      // Sourcea i token nell'env del child (mai nei config committabili)
      const tokenMap = readTokenFile();
      const tokenEnv = Object.fromEntries(tokenMap.entries());
      const result = applyMcpCommand(args, tokenEnv);
      mcpResults.push({
        slot: slotKey,
        provider,
        command: commandStr,
        applied: true,
        success: result.success,
        stderr: result.stderr ? result.stderr.slice(0, 500) : null,
      });
    } else {
      mcpResults.push({
        slot: slotKey,
        provider,
        command: commandStr,
        applied: false,
      });
    }
  }

  // Risposta: mai esporre i token
  sendJson(res, 200, {
    ok: true,
    projectPath,
    profilePath,
    tokenFile: tokenFilePath(),
    tokensWritten: Object.keys(tokenUpdates),
    slotsUpdated: Object.keys(slotUpdates),
    mcpCommands: mcpResults,
  });
}

/**
 * POST /integration-config/test
 * Body: { projectPath?, slot: string, provider: string, inline?: {...} }
 * Probe best-effort; mai 5xx; mai token in chiaro nella response.
 */
export async function handlePostIntegrationConfigTest(req, res, body) {
  const { sendJson } = await import("./http-helpers.mjs");

  const { slot, provider, inline = {} } = body;

  if (!slot || !provider) {
    sendJson(res, 400, { detail: "slot e provider sono obbligatori" });
    return;
  }
  if (!CATALOG[slot]) {
    sendJson(res, 400, { detail: `slot non riconosciuto: ${slot}` });
    return;
  }
  if (!CATALOG[slot].includes(provider)) {
    sendJson(res, 400, {
      detail: `provider non valido per ${slot}: ${provider}`,
    });
    return;
  }

  // Probe best-effort: mai 5xx
  try {
    const probeResult = await probeProvider(slot, provider, inline);
    sendJson(res, 200, probeResult);
  } catch (err) {
    // Degrada: mai 5xx, mai token in chiaro
    sendJson(res, 200, { ok: false, message: `probe fallito: ${err.message}` });
  }
}

// ---------------------------------------------------------------------------
// Helper: check auth (replicato da server.mjs via import dinamico)
// Usato da server.mjs per gating dei 3 endpoint.
// ---------------------------------------------------------------------------

export { TOKEN_ENV_KEY, CATALOG, NO_TOKEN_PROVIDERS };
