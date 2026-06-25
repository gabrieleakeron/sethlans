const root = document.getElementById("root");
const connStatus = document.getElementById("conn-status");

const state = {
  data: { projects: [], epics: [], stories: [], tasks: [], agents: [] },
  expanded: new Set(),
  // URL della board React completa (null = nessun link "Apri nella board", comportamento
  // invariato). Popolato una volta all'avvio da GET /config (storia s50550dcb).
  boardWebUrl: null,
};

const nodesByEpic = new Map();
const nodesByStory = new Map();
const nodesByTask = new Map();

function badgeClass(status) {
  return status === "progress" ? "badge-progress" : status === "done" ? "badge-done" : "badge-todo";
}

function agentName(agentId) {
  if (!agentId) return null;
  const agent = state.data.agents.find((a) => a.id === agentId);
  return agent ? agent.name : null;
}

// Aggiorna/rimuove il link "Apri nella board" dentro `summaryEl` (un <summary>), in modo
// idempotente rispetto al re-render del poll (riusa il nodo se gia' presente, lo crea o lo
// rimuove senza duplicarlo). Visibile solo se state.boardWebUrl e' settato E l'entita' ha
// mockup (criterio §2 della storia s50550dcb). Il link vive dentro la <summary>: lo stop
// della propagazione sul click impedisce che apra/chiuda l'accordion.
function updateBoardLink(summaryEl, hasMockup) {
  let link = summaryEl.querySelector(".board-link");
  const show = Boolean(state.boardWebUrl) && hasMockup;
  if (!show) {
    if (link) link.remove();
    return;
  }
  if (!link) {
    link = document.createElement("a");
    link.className = "board-link";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Apri nella board ↗";
    link.addEventListener("click", (e) => e.stopPropagation());
    summaryEl.appendChild(link);
  }
  link.href = state.boardWebUrl;
}

function makeTaskNode(task) {
  const el = document.createElement("details");
  el.className = "acc-task";
  el.dataset.id = task.id;
  el.innerHTML = `
    <summary>
      <span class="title-text"></span>
      <span class="badge"></span>
    </summary>
  `;
  el.addEventListener("toggle", () => {
    if (el.open) state.expanded.add(`t:${task.id}`);
    else state.expanded.delete(`t:${task.id}`);
  });
  return el;
}

function updateTaskNode(el, task) {
  el.open = state.expanded.has(`t:${task.id}`);
  const title = el.querySelector(".title-text");
  const agent = agentName(task.agent_id);
  title.textContent = agent ? `${task.title}  —  ${agent}` : task.title;
  const badge = el.querySelector(".badge");
  badge.textContent = task.status;
  badge.className = `badge ${badgeClass(task.status)}`;
  updateBoardLink(el.querySelector("summary"), task.mockup_count > 0);
}

function makeStoryNode(story) {
  const el = document.createElement("details");
  el.className = "acc-story";
  el.dataset.id = story.id;
  el.innerHTML = `
    <summary>
      <span class="title-text"></span>
      <span class="badge-phase badge"></span>
      <span class="badge"></span>
      <span class="mockup-count"></span>
    </summary>
    <div class="acc-children" data-children="tasks"></div>
  `;
  el.addEventListener("toggle", () => {
    if (el.open) state.expanded.add(`s:${story.id}`);
    else state.expanded.delete(`s:${story.id}`);
  });
  return el;
}

function updateStoryNode(el, story) {
  el.open = state.expanded.has(`s:${story.id}`);
  el.querySelector(".title-text").textContent = story.title;
  el.querySelector(".badge-phase").textContent = story.phase;
  const statusBadge = el.querySelectorAll(".badge")[1];
  statusBadge.textContent = story.status;
  statusBadge.className = `badge ${badgeClass(story.status)}`;
  const mockupEl = el.querySelector(".mockup-count");
  mockupEl.textContent = story.mockup_descendant_count > 0 ? `🖼 ${story.mockup_descendant_count}` : "";
  updateBoardLink(el.querySelector("summary"), story.mockup_descendant_count > 0);

  const tasks = state.data.tasks.filter((t) => t.story_id === story.id);
  const container = el.querySelector('[data-children="tasks"]');
  syncChildren(container, tasks, nodesByTask, makeTaskNode, updateTaskNode);
}

function makeEpicNode(epic) {
  const el = document.createElement("details");
  el.className = "acc-epic";
  el.dataset.id = epic.id;
  el.innerHTML = `
    <summary>
      <span class="title-text"></span>
      <span class="badge"></span>
      <span class="mockup-count"></span>
    </summary>
    <div class="acc-children" data-children="stories"></div>
  `;
  el.addEventListener("toggle", () => {
    if (el.open) state.expanded.add(`e:${epic.id}`);
    else state.expanded.delete(`e:${epic.id}`);
  });
  return el;
}

function updateEpicNode(el, epic) {
  el.open = state.expanded.has(`e:${epic.id}`);
  el.querySelector(".title-text").textContent = epic.title;
  const badge = el.querySelector(".badge");
  badge.textContent = epic.status;
  badge.className = `badge ${badgeClass(epic.status)}`;
  const mockupEl = el.querySelector(".mockup-count");
  mockupEl.textContent = epic.mockup_descendant_count > 0 ? `🖼 ${epic.mockup_descendant_count}` : "";
  updateBoardLink(el.querySelector("summary"), epic.mockup_descendant_count > 0);

  const stories = state.data.stories.filter((s) => s.epic_id === epic.id);
  const container = el.querySelector('[data-children="stories"]');
  syncChildren(container, stories, nodesByStory, makeStoryNode, updateStoryNode);
}

function syncChildren(container, items, nodeMap, makeNode, updateNode) {
  const seen = new Set();
  for (const item of items) {
    seen.add(item.id);
    let node = nodeMap.get(item.id);
    if (!node) {
      node = makeNode(item);
      nodeMap.set(item.id, node);
      container.appendChild(node);
    }
    updateNode(node, item);
  }
  for (const [id, node] of [...nodeMap.entries()]) {
    if (!seen.has(id) && node.parentElement === container) {
      nodeMap.delete(id);
      node.remove();
    }
  }
}

function render() {
  if (state.data.epics.length === 0) {
    if (!root.querySelector(".empty-hint")) {
      root.innerHTML = '<p class="empty-hint">Nessuna epica ancora. Usa il plugin Sethlans per popolare la board.</p>';
    }
    return;
  }
  const hint = root.querySelector(".empty-hint");
  if (hint) hint.remove();
  syncChildren(root, state.data.epics, nodesByEpic, makeEpicNode, updateEpicNode);
}

// Letta una sola volta all'avvio (non e' soggetta a poll: il valore non cambia a runtime,
// e' fissato dalla env del processo server). Errore/fetch fallita -> fallback prudente a null
// (nessun link, viewer invariato), non deve bloccare l'avvio del viewer.
async function fetchConfig() {
  try {
    const res = await fetch("/config");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.boardWebUrl = data.board_web_url || null;
  } catch (err) {
    state.boardWebUrl = null;
    console.error("fetch /config failed", err);
  }
}

async function poll() {
  try {
    const res = await fetch("/state");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    connStatus.classList.remove("offline");
    render();
  } catch (err) {
    connStatus.classList.add("offline");
    console.error("poll failed", err);
  }
}

fetchConfig().then(poll);
setInterval(poll, 4000);
