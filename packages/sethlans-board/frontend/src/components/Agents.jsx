import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Activity, Zap } from "lucide-react";
import * as api from "../api.js";
import { READONLY } from "../config.js";

// Agent grid: status, current task, tokens consumed.
//
// Scope (story s36b99979): senza `storyId` questo componente resta il
// comportamento storico — cumulativo GLOBALE su `state.agents` (dashboard).
// Con `storyId` (montato da StoryPage.jsx dentro una storia) va scope-coerente:
// fetcha GET /stories/{id}/agent-tokens e rende SOLO gli agent che hanno
// lavorato su quella storia, con contatori e token-box calcolati sull'insieme
// per-storia (story_tokens), non sul cumulativo globale. Nessuna regressione
// sulla dashboard globale (AC7).
export default function Agents({ state, reload, storyId }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);

  const [storyData, setStoryData] = useState(null);
  const [storyError, setStoryError] = useState(null);
  const [storyLoaded, setStoryLoaded] = useState(false);

  const loadStoryTokens = () => {
    if (!storyId) return;
    setStoryError(null);
    setStoryLoaded(false);
    api.stories
      .agentTokens(storyId)
      .then((data) => {
        setStoryData(data);
        setStoryLoaded(true);
      })
      .catch((e) => {
        setStoryError(e.message);
        setStoryLoaded(true);
      });
  };

  useEffect(() => {
    loadStoryTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  const fmt = (n) => n.toLocaleString("en-US");

  if (storyId) {
    if (storyError) {
      return (
        <div className="empty-state">
          Errore nel caricamento dei token della storia: {storyError}
        </div>
      );
    }
    if (!storyLoaded) {
      return <div className="empty-state">Caricamento…</div>;
    }
    const storyAgents = storyData?.agents || [];
    const totalTokens = storyData?.total_tokens || 0;
    return (
      <StoryScopedAgents
        agents={storyAgents}
        totalTokens={totalTokens}
        fmt={fmt}
      />
    );
  }

  // ---- Comportamento globale invariato (dashboard, nessuno storyId) ----
  const agents = state.agents;
  const total = agents.reduce((s, a) => s + a.tokens, 0);
  const maxT = Math.max(...agents.map((a) => a.tokens), 1);
  const activeCount = agents.filter((a) => a.status === "active").length;

  const add = async () => {
    if (!name.trim()) return;
    await api.agents.create({
      name,
      current_task: "Idle",
      status: "idle",
      tokens: 0,
    });
    setName("");
    setAdding(false);
    reload();
  };
  const save = async (id, patch) => {
    await api.agents.update(id, patch);
    reload();
  };
  const del = async (id) => {
    await api.agents.remove(id);
    reload();
  };

  return (
    <div className="agents">
      <div className="stats">
        <Stat
          icon={Activity}
          label="Active agents"
          value={`${activeCount} / ${agents.length}`}
          accent="var(--c-prog)"
        />
        <Stat icon={Zap} label="Total tokens" value={fmt(total)} accent="var(--epic)" />
      </div>
      <div className="agent-grid">
        {agents.map((a) => (
          <div key={a.id} className="agent-card">
            {editing === a.id ? (
              <div className="add-form">
                <input
                  defaultValue={a.name}
                  onBlur={(e) => save(a.id, { name: e.target.value })}
                  className="input"
                  placeholder="Name"
                />
                <input
                  defaultValue={a.current_task}
                  onBlur={(e) => save(a.id, { current_task: e.target.value })}
                  className="input"
                  placeholder="Current task"
                />
                <input
                  type="number"
                  defaultValue={a.tokens}
                  onBlur={(e) => save(a.id, { tokens: parseInt(e.target.value) || 0 })}
                  className="input"
                  placeholder="Tokens"
                />
                <select
                  value={a.status}
                  onChange={(e) => save(a.id, { status: e.target.value })}
                  className="input"
                >
                  <option value="active">Active</option>
                  <option value="idle">Idle</option>
                </select>
                <button className="btn-primary" onClick={() => setEditing(null)}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="agent-top">
                  <div className="agent-avatar">{a.name[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div className="agent-name">{a.name}</div>
                    <div className="status-row">
                      <span
                        className="dot"
                        style={{
                          background:
                            a.status === "active" ? "var(--c-done)" : "var(--muted)",
                        }}
                      />
                      <span className="status-text">
                        {a.status === "active" ? "Active" : "Idle"}
                      </span>
                    </div>
                  </div>
                  {!READONLY && (
                    <div className="card-actions">
                      <button className="icon-btn" onClick={() => setEditing(a.id)}>
                        <Pencil size={13} />
                      </button>
                      <button className="icon-btn" onClick={() => del(a.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="task-box">
                  <span className="task-label">Currently doing</span>
                  <span className="task-val">{a.current_task}</span>
                </div>
                <div className="token-box">
                  <div className="token-head">
                    <span className="task-label">Tokens consumed</span>
                    <span className="token-val">{fmt(a.tokens)}</span>
                  </div>
                  <div className="bar-bg">
                    <div
                      className="bar-fill"
                      style={{ width: `${(a.tokens / maxT) * 100}%` }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
        {!READONLY &&
          (adding ? (
            <div className="agent-card" style={{ justifyContent: "center" }}>
              <div className="add-form">
                <input
                  autoFocus
                  placeholder="Agent name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                  className="input"
                />
                <div className="form-row">
                  <button className="btn-primary" onClick={add}>
                    Add
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setAdding(false);
                      setName("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button className="add-agent" onClick={() => setAdding(true)}>
              <Plus size={18} /> New agent
            </button>
          ))}
      </div>
    </div>
  );
}

// View per-storia (story s36b99979): sola lettura (nessun add/edit/delete —
// il ciclo di vita degli agent resta globale, gestito dalla dashboard). Rende
// solo gli agent che hanno almeno un task su questa storia, con `story_tokens`
// al posto del cumulativo globale (riusa token-box/bar-fill/stat-card).
function StoryScopedAgents({ agents, totalTokens, fmt }) {
  const activeCount = agents.filter((a) => a.status === "active").length;
  const maxT = Math.max(...agents.map((a) => a.story_tokens), 1);

  if (agents.length === 0) {
    return (
      <div className="agents">
        <div className="stats">
          <Stat icon={Activity} label="Active agents" value="0 / 0" accent="var(--c-prog)" />
          <Stat icon={Zap} label="Total tokens" value={fmt(0)} accent="var(--epic)" />
        </div>
        <div className="empty-state">No agent has worked on this story yet.</div>
      </div>
    );
  }

  return (
    <div className="agents">
      <div className="stats">
        <Stat
          icon={Activity}
          label="Active agents"
          value={`${activeCount} / ${agents.length}`}
          accent="var(--c-prog)"
        />
        <Stat icon={Zap} label="Total tokens" value={fmt(totalTokens)} accent="var(--epic)" />
      </div>
      <div className="agent-grid">
        {agents.map((a) => (
          <div key={a.agent_id} className="agent-card">
            <div className="agent-top">
              <div className="agent-avatar">{a.name[0]}</div>
              <div style={{ flex: 1 }}>
                <div className="agent-name">{a.name}</div>
                <div className="status-row">
                  <span
                    className="dot"
                    style={{
                      background: a.status === "active" ? "var(--c-done)" : "var(--muted)",
                    }}
                  />
                  <span className="status-text">
                    {a.status === "active" ? "Active" : "Idle"}
                  </span>
                </div>
              </div>
            </div>
            <div className="task-box">
              <span className="task-label">Currently doing</span>
              <span className="task-val">{a.current_task}</span>
            </div>
            <div className="token-box">
              <div className="token-head">
                <span className="task-label">Tokens (this story)</span>
                <span className="token-val">{fmt(a.story_tokens)}</span>
              </div>
              <div className="bar-bg">
                <div
                  className="bar-fill"
                  style={{ width: `${(a.story_tokens / maxT) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: accent }}>
        <Icon size={18} color="var(--ink)" />
      </div>
      <div>
        <div className="stat-val">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}
