// Board API client.
// The base URL is read from VITE_API_URL, but can be overridden at runtime
// (field in the app header) and is remembered in localStorage.

const DEFAULT_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:9955";

let base = (() => {
  try {
    return localStorage.getItem("board-api-url") || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
})();

export function getBaseUrl() {
  return base;
}
export function setBaseUrl(url) {
  base = url.replace(/\/+$/, "");
  try {
    localStorage.setItem("board-api-url", base);
  } catch {}
}

async function request(method, path, body) {
  // credentials: "include" → invia il cookie CF_Authorization di Cloudflare
  // Access al backend, che vive su un (sotto)dominio diverso dal frontend.
  const opts = { method, headers: {}, credentials: "include" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {}
    throw new Error(`${res.status} ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Full snapshot
export const getState = () => request("GET", "/state");

// CRUD generator for a resource
function resource(name) {
  return {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null && v !== "")
      ).toString();
      return request("GET", `/${name}${qs ? `?${qs}` : ""}`);
    },
    get: (id) => request("GET", `/${name}/${id}`),
    create: (data) => request("POST", `/${name}`, data),
    update: (id, patch) => request("PATCH", `/${name}/${id}`, patch),
    remove: (id) => request("DELETE", `/${name}/${id}`),
  };
}

export const projects = resource("projects");
export const epics = resource("epics");
export const stories = {
  ...resource("stories"),
  // Token per-storia aggregati per agent (story s36b99979): alimenta il tab
  // Agents quando aperto nel contesto di una storia (vedi components/Agents.jsx).
  agentTokens: (storyId) => request("GET", `/stories/${storyId}/agent-tokens`),
};
export const tasks = resource("tasks");
export const agents = resource("agents");
export const knowledge = resource("knowledge");

// Design System: entità 1:1 con project (story s2340fc3b). `list` filtra per
// project_id e torna al massimo un elemento (list-shaped per uniformità con
// le altre risorse, vedi nota nel md del task BE t2aa29598).
export const designSystems = resource("design-systems");

// Mockups: entità di prima classe (story s443652b6). `list` resta retrocompat
// con l'aggregazione legacy (epic_id/story_id/task_id) e supporta anche il nuovo
// stile owner_type+owner_id. CRUD pieno per la gestione indipendente dei mockup.
export const mockups = {
  list: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== "")
    ).toString();
    return request("GET", `/mockups${qs ? `?${qs}` : ""}`);
  },
  get: (id) => request("GET", `/mockups/${id}`),
  create: (data) => request("POST", "/mockups", data),
  update: (id, patch) => request("PATCH", `/mockups/${id}`, patch),
  remove: (id) => request("DELETE", `/mockups/${id}`),
};

// Export/Import dati progetto (story s09f34f1a): portabilità del "sapere" di
// un progetto (profilo + knowledge + design-system) tra istanze della Board.
// `exportProject` non passa dal wrapper `request` generico: il chiamante deve
// poter innescare un download del blob, non solo leggere JSON.
export const projectData = {
  exportProject: async (projectId) => {
    const res = await fetch(`${base}/projects/${projectId}/export`, { credentials: "include" });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.detail || detail;
      } catch {}
      throw new Error(`${res.status} ${detail}`);
    }
    return res.json();
  },
  importPreview: (data, targetProjectId, mode) =>
    request("POST", "/projects/import/preview", { data, target_project_id: targetProjectId, mode }),
  importApply: (data, targetProjectId, mode) =>
    request("POST", "/projects/import", { data, target_project_id: targetProjectId, mode }),
};

// Mockup comments: target polimorfico (story|task) + mockup_index.
// Il composer è sempre abilitato (eccezione a VITE_READONLY, vedi config.js).
export const mockupComments = {
  list: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== "")
    ).toString();
    return request("GET", `/mockup-comments${qs ? `?${qs}` : ""}`);
  },
  create: (data) => request("POST", "/mockup-comments", data),
  remove: (id) => request("DELETE", `/mockup-comments/${id}`),
};
