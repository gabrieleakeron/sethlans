#!/usr/bin/env node
// Sethlans Board MCP server — wrapper sottile sopra l'API REST di Sethlans Board.
// =============================================================================
// Espone alla orchestrazione di Claude dei tool tipizzati (con enum validati a
// schema) che incapsulano le ricette del protocollo (find-or-create epica/storia,
// get-or-register agente, append sul documento MD, cascata di stato…), così i
// subagent non devono più portarsi dietro ricette PowerShell shell-specifiche.
//
// Zero dipendenze: parla JSON-RPC 2.0 su stdio e usa la `fetch` globale (Node 18+,
// quello con cui gira Claude Code). Niente `npm install`: il plugin è self-contained.
//
// Principio guida (come il resto del protocollo Sethlans Board): aggiornare la
// board è best-effort e MAI bloccante. Se il board non risponde, il tool ritorna
// un errore "soft" (isError) con un messaggio chiaro: l'agente prosegue il lavoro.
//
// Config: SETHLANS_SERVICE_API_URL (default http://localhost:9955).
//
// Se il board è dietro Cloudflare Access, impostare anche
// SETHLANS_SERVICE_CF_ACCESS_CLIENT_ID / _SECRET (Service Token Cloudflare:
// Zero Trust → Access → Service Auth → Service Tokens) per autenticare ogni
// chiamata via header CF-Access-Client-Id/-Secret, bypassando il login.
//
// Se il board ha il token condiviso opzionale attivo (vedi board-protocol.md,
// storia preview-shared-token), impostare SETHLANS_SERVICE_API_TOKEN: ogni
// chiamata aggiunge l'header X-Sethlans-Token (coesiste con CF-Access). Il
// valore deve coincidere con quello configurato sul BE/preview a monte.
// =============================================================================

const BASE = (process.env.SETHLANS_SERVICE_API_URL || "http://localhost:9955")
  .trim()
  .replace(/\/+$/, "") || "http://localhost:9955";

const CF_ACCESS_CLIENT_ID = process.env.SETHLANS_SERVICE_CF_ACCESS_CLIENT_ID || "";
const CF_ACCESS_CLIENT_SECRET = process.env.SETHLANS_SERVICE_CF_ACCESS_CLIENT_SECRET || "";
const API_TOKEN = (process.env.SETHLANS_SERVICE_API_TOKEN || "").trim();

const SERVER_INFO = { name: "sethlans-board", version: "1.0.0" };
const DEFAULT_PROTOCOL = "2024-11-05";

// --- enum applicativi (specchio di backend/models.py) ---
const STATUS_WORK = ["todo", "progress", "done"];
const STATUS_AGENT = ["active", "idle"];
const PHASE_STORY = ["analysis", "ux", "design", "dev", "done"];
const TYPE_PROJECT = ["jira", "internal"];
const MD_ENTITIES = ["project", "epic", "story", "task", "knowledge"];
const STATUS_ENTITIES = ["epic", "story", "task"];

// percorso REST per ciascun tipo di entità
const COLLECTION = {
  project: "projects",
  epic: "epics",
  story: "stories",
  task: "tasks",
  agent: "agents",
  knowledge: "knowledge",
};

// ----------------------------- client REST -----------------------------

class BoardError extends Error {
  constructor(message, { unreachable = false } = {}) {
    super(message);
    this.unreachable = unreachable;
  }
}

async function api(method, path, body) {
  const headers = body !== undefined ? { "Content-Type": "application/json" } : {};
  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = CF_ACCESS_CLIENT_SECRET;
  }
  if (API_TOKEN) {
    headers["X-Sethlans-Token"] = API_TOKEN;
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // connection refused / DNS / timeout → board non raggiungibile
    throw new BoardError(`board non raggiungibile su ${BASE}: ${err.message}`, {
      unreachable: true,
    });
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      if (j && j.detail !== undefined) {
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      }
    } catch {
      /* corpo non-JSON: si tiene lo statusText */
    }
    throw new BoardError(`${res.status} ${detail}`);
  }
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// rimuove le chiavi undefined (il PATCH ignora i null, quindi non li inviamo affatto)
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

// ----------------------------- helper di dominio -----------------------------

async function findByField(collection, field, value) {
  const list = await api("GET", `/${collection}`);
  return (list || []).find((x) => x[field] === value) || null;
}

// find-or-register agente per nome → record agente
async function getOrRegisterAgent(name, patch = {}) {
  let agent = await findByField("agents", "name", name);
  if (!agent) {
    agent = await api("POST", "/agents", {
      name,
      status: patch.status ?? "idle",
      current_task: patch.current_task ?? "Inattivo",
      tokens: patch.tokens ?? 0,
    });
    return agent;
  }
  const body = clean({
    status: patch.status,
    current_task: patch.current_task,
    tokens: patch.tokens,
  });
  if (Object.keys(body).length) agent = await api("PATCH", `/agents/${agent.id}`, body);
  return agent;
}

// risolve l'id di progetto da project_id oppure da project_name (find-or-create)
async function resolveProjectId({ project_id, project_name, type, jira_key }) {
  if (project_id) return project_id;
  if (!project_name) {
    throw new BoardError("serve project_id oppure project_name per identificare il progetto");
  }
  const existing = await findByField("projects", "name", project_name);
  if (existing) return existing.id;
  const created = await api("POST", "/projects", {
    name: project_name,
    type: type ?? "internal",
    jira_key: jira_key ?? "",
  });
  return created.id;
}

// ----------------------------- definizione dei tool -----------------------------

const TOOLS = [
  {
    name: "sethlans_board_get_state",
    description:
      "Snapshot della board (healthcheck + lettura). Default 'summary': conteggi e " +
      "liste compatte (id/titolo/stato) per progetti, epiche, storie, task, agenti. " +
      "Con full=true ritorna l'intero JSON di GET /state.",
    inputSchema: {
      type: "object",
      properties: {
        full: { type: "boolean", description: "Ritorna l'intero stato grezzo invece del riassunto." },
      },
    },
    handler: async ({ full }) => {
      const state = await api("GET", "/state");
      if (full) return state;
      const slim = (arr, fields) =>
        (arr || []).map((x) => Object.fromEntries(fields.map((f) => [f, x[f]])));
      return {
        reachable: true,
        base: BASE,
        counts: {
          projects: (state.projects || []).length,
          epics: (state.epics || []).length,
          stories: (state.stories || []).length,
          tasks: (state.tasks || []).length,
          agents: (state.agents || []).length,
          knowledge: (state.knowledge || []).length,
        },
        projects: slim(state.projects, ["id", "name", "type", "jira_key"]),
        epics: slim(state.epics, ["id", "title", "status", "project_id"]),
        stories: slim(state.stories, ["id", "title", "status", "phase", "epic_id"]),
        tasks: slim(state.tasks, ["id", "title", "status", "story_id", "agent_id"]),
        agents: slim(state.agents, ["id", "name", "status", "current_task", "tokens"]),
      };
    },
  },

  {
    name: "sethlans_board_upsert_project",
    description:
      "Find-or-create di un progetto per nome (match esatto). Se esiste, applica le " +
      "patch fornite; altrimenti lo crea. Ritorna il progetto.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome del progetto (chiave di match)." },
        type: { type: "string", enum: TYPE_PROJECT, description: "jira | internal (default internal)." },
        jira_key: { type: "string", description: "Chiave Jira (es. 'ABC'); vuota per progetti interni." },
        md: { type: "string", description: "Profilo/documento del progetto (Markdown)." },
      },
      required: ["name"],
    },
    handler: async ({ name, type, jira_key, md }) => {
      const existing = await findByField("projects", "name", name);
      if (!existing) {
        return api("POST", "/projects", clean({ name, type, jira_key, md }));
      }
      const body = clean({ type, jira_key, md });
      if (!Object.keys(body).length) return existing;
      return api("PATCH", `/projects/${existing.id}`, body);
    },
  },

  {
    name: "sethlans_board_upsert_epic",
    description:
      "Find-or-create di un'epica per titolo all'interno di un progetto (match esatto). " +
      "Il progetto si indica con project_id oppure project_name (in tal caso viene " +
      "creato se non esiste). Se l'epica esiste, applica le patch fornite. Ritorna l'epica.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titolo dell'epica (chiave di match nel progetto)." },
        project_id: { type: "string", description: "Id del progetto (alternativo a project_name)." },
        project_name: { type: "string", description: "Nome del progetto (find-or-create se manca project_id)." },
        desc: { type: "string", description: "Descrizione." },
        status: { type: "string", enum: STATUS_WORK, description: "todo | progress | done." },
        md: { type: "string", description: "Documento dell'epica (Markdown)." },
      },
      required: ["title"],
    },
    handler: async ({ title, project_id, project_name, desc, status, md }) => {
      const pid = await resolveProjectId({ project_id, project_name });
      const list = await api("GET", `/epics?project_id=${encodeURIComponent(pid)}`);
      const existing = (list || []).find((e) => e.title === title);
      if (!existing) {
        return api("POST", "/epics", clean({ title, project_id: pid, desc, status, md }));
      }
      const body = clean({ desc, status, md });
      if (!Object.keys(body).length) return existing;
      return api("PATCH", `/epics/${existing.id}`, body);
    },
  },

  {
    name: "sethlans_board_upsert_story",
    description:
      "Find-or-create di una storia per titolo dentro un'epica (match esatto). Se " +
      "esiste, applica le patch fornite (incluse phase e status). Ritorna la storia.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titolo della storia (chiave di match nell'epica)." },
        epic_id: { type: "string", description: "Id dell'epica di appartenenza." },
        desc: { type: "string", description: "Descrizione." },
        status: { type: "string", enum: STATUS_WORK, description: "todo | progress | done." },
        phase: { type: "string", enum: PHASE_STORY, description: "Fase del flusso: analysis | ux | design | dev | done." },
        md: { type: "string", description: "Documento della storia (analisi, mockup ```mockup``` HTML…)." },
      },
      required: ["title", "epic_id"],
    },
    handler: async ({ title, epic_id, desc, status, phase, md }) => {
      const list = await api("GET", `/stories?epic_id=${encodeURIComponent(epic_id)}`);
      const existing = (list || []).find((s) => s.title === title);
      if (!existing) {
        return api("POST", "/stories", clean({ title, epic_id, desc, status, phase, md }));
      }
      const body = clean({ desc, status, phase, md });
      if (!Object.keys(body).length) return existing;
      return api("PATCH", `/stories/${existing.id}`, body);
    },
  },

  {
    name: "sethlans_board_create_task",
    description:
      "Crea un task sotto una storia. L'agente assegnatario si indica con agent_name " +
      "(find-or-register per nome canonico) oppure agent_id. Ritorna il task creato.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titolo del task." },
        story_id: { type: "string", description: "Id della storia di appartenenza." },
        agent_name: { type: "string", description: "Nome canonico dell'agente (es. 'seth-be-python'); registrato se assente." },
        agent_id: { type: "string", description: "Id agente (alternativo ad agent_name)." },
        status: { type: "string", enum: STATUS_WORK, description: "todo | progress | done (default todo)." },
        md: { type: "string", description: "Documento del task (lavoro + scelte architetturali + note)." },
      },
      required: ["title", "story_id"],
    },
    handler: async ({ title, story_id, agent_name, agent_id, status, md }) => {
      let aid = agent_id;
      if (!aid && agent_name) aid = (await getOrRegisterAgent(agent_name)).id;
      return api("POST", "/tasks", clean({ title, story_id, agent_id: aid, status, md }));
    },
  },

  {
    name: "sethlans_board_set_status",
    description:
      "Aggiorna lo stato di un'epica/storia/task (e, per le storie, anche la phase). " +
      "Comodo per il ciclo di vita del lavoro e per la cascata di stato.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", enum: STATUS_ENTITIES, description: "epic | story | task." },
        id: { type: "string", description: "Id dell'entità." },
        status: { type: "string", enum: STATUS_WORK, description: "todo | progress | done." },
        phase: { type: "string", enum: PHASE_STORY, description: "Solo per le storie: analysis | ux | design | dev | done." },
      },
      required: ["entity", "id"],
    },
    handler: async ({ entity, id, status, phase }) => {
      const body = clean({ status, phase });
      if (!Object.keys(body).length) {
        throw new BoardError("nessun campo da aggiornare: specifica status e/o phase");
      }
      return api("PATCH", `/${COLLECTION[entity]}/${id}`, body);
    },
  },

  {
    name: "sethlans_board_get_or_register_agent",
    description:
      "Find-or-register di un agente per nome canonico. Se fornisci status/current_task/" +
      "tokens, applica anche la patch. Utile a inizio/fine lavoro di un subagent. Ritorna l'agente.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome canonico (es. 'seth-frontend', 'seth-architect')." },
        status: { type: "string", enum: STATUS_AGENT, description: "active | idle." },
        current_task: { type: "string", description: "Descrizione del lavoro corrente (es. 'Form di login (s12)')." },
        tokens: { type: "integer", description: "Valore assoluto dei token (per incrementi usa sethlans_board_add_agent_tokens)." },
      },
      required: ["name"],
    },
    handler: ({ name, status, current_task, tokens }) =>
      getOrRegisterAgent(name, clean({ status, current_task, tokens })),
  },

  {
    name: "sethlans_board_add_agent_tokens",
    description:
      "Incrementa (read-modify-write) i token cumulativi di un agente identificato per " +
      "nome. Best-effort: usato dall'orchestratore alla chiusura di un subagent. Se si " +
      "passa task_id, incrementa (read-modify-write) ANCHE Task.tokens dello stesso delta " +
      "(story s36b99979, per l'aggregazione token per-storia); story_id è opzionale, solo " +
      "per telemetria/validazione, non persiste nulla da solo. Retrocompatibile: la firma " +
      "storica {name, delta} continua a funzionare invariata.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome canonico dell'agente." },
        delta: { type: "integer", description: "Quantità da sommare ai token attuali." },
        task_id: {
          type: "string",
          description:
            "Opzionale. Se presente, incrementa anche i token del task (Task.tokens) dello " +
            "stesso delta, per abilitare l'aggregazione per-storia. Best-effort: un errore su " +
            "questo passo non blocca l'incremento globale sull'agente.",
        },
        story_id: {
          type: "string",
          description:
            "Opzionale, solo telemetria/validazione: i token per-storia derivano sempre dai " +
            "task (via task_id), non da questo campo.",
        },
      },
      required: ["name", "delta"],
    },
    handler: async ({ name, delta, task_id, story_id }) => {
      const agent = await getOrRegisterAgent(name);
      const result = await api("PATCH", `/agents/${agent.id}`, { tokens: (agent.tokens || 0) + delta });
      if (task_id) {
        try {
          const task = await api("GET", `/tasks/${task_id}`);
          await api("PATCH", `/tasks/${task_id}`, { tokens: (task.tokens || 0) + delta });
        } catch (err) {
          // Best-effort (D-C): il fallimento sull'aggiornamento del task non deve invalidare
          // l'incremento globale già applicato sopra.
          result._task_tokens_warning = `task_id '${task_id}' non aggiornato: ${err.message}`;
        }
      }
      return result;
    },
  },

  {
    name: "sethlans_board_append_md",
    description:
      "Accoda testo al documento Markdown di un'entità (read-modify-write). Entity ∈ " +
      "{project, epic, story, task, knowledge}. Pratico per le note di lavoro a fine task.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", enum: MD_ENTITIES, description: "project | epic | story | task | knowledge." },
        id: { type: "string", description: "Id dell'entità." },
        text: { type: "string", description: "Testo Markdown da accodare." },
      },
      required: ["entity", "id", "text"],
    },
    handler: async ({ entity, id, text }) => {
      const current = await api("GET", `/${COLLECTION[entity]}/${id}`);
      const prev = current.md || "";
      const md = prev ? `${prev}\n\n${text}` : text;
      return api("PATCH", `/${COLLECTION[entity]}/${id}`, { md });
    },
  },

  {
    name: "sethlans_board_request",
    description:
      "Escape hatch di basso livello: chiamata REST arbitraria all'API Sethlans Board. Da usare " +
      "solo per casi non coperti dai tool tipizzati. method ∈ GET|POST|PATCH|DELETE.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PATCH", "DELETE"] },
        path: { type: "string", description: "Path con eventuale query string, es. '/tasks?story_id=s1'." },
        body: { type: "object", description: "Corpo JSON (per POST/PATCH)." },
      },
      required: ["method", "path"],
    },
    handler: ({ method, path, body }) =>
      api(method, path.startsWith("/") ? path : `/${path}`, body),
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ----------------------------- dispatch JSON-RPC -----------------------------

async function handleToolCall(name, args) {
  const tool = TOOL_BY_NAME[name];
  if (!tool) {
    return { content: [{ type: "text", text: `Tool sconosciuto: ${name}` }], isError: true };
  }
  try {
    const result = await tool.handler(args || {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const hint = err instanceof BoardError && err.unreachable
      ? " (aggiornamento best-effort: il board è osservabilità, prosegui col lavoro reale)"
      : "";
    return {
      content: [{ type: "text", text: `Errore Sethlans Board: ${err.message}${hint}` }],
      isError: true,
    };
  }
}

async function dispatch(msg) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      };
    case "tools/call":
      return handleToolCall(msg.params?.name, msg.params?.arguments);
    default:
      throw { code: -32601, message: `Metodo non supportato: ${msg.method}` };
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function onMessage(msg) {
  // notifiche: nessun id → nessuna risposta
  if (msg.id === undefined || msg.id === null) return;
  try {
    const result = await dispatch(msg);
    send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (err) {
    const error =
      err && typeof err.code === "number"
        ? { code: err.code, message: err.message }
        : { code: -32603, message: err?.message || String(err) };
    send({ jsonrpc: "2.0", id: msg.id, error });
  }
}

// stdio transport: messaggi JSON-RPC delimitati da newline
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // riga non-JSON: ignora
    }
    onMessage(msg);
  }
});
// Niente exit forzato su 'end': si lascia drenare il loop così le chiamate
// asincrone in volo completano e svuotano lo stdout prima dell'uscita naturale.
