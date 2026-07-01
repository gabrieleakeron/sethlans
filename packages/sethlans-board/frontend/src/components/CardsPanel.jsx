import { useState } from "react";
import { LayoutGrid, Clock, X } from "lucide-react";
import { MdView, roleLabel, roleColor } from "./shared.jsx";

// Cards view (story s5cadd1fc, task tcf9f64d6): every Knowledge card for the
// project EXCEPT the project profile (kind=profile lives in KnowledgePanel)
// grouped into one tile per role — "Hypothesis A" from mockup mkd2cc6328.
// One tile = the whole knowledge of the agent for that role (kb + learnings
// rolled up, standards called out separately). Reuses .agent-grid/.agent-card
// (Agents.jsx/styles.css) for visual homogeneity with the agents/tokens grid.
//
// Role order: mirrors the historical KnowledgePanel sort (general/po/ux first,
// then the seth-* dev roles alphabetically) so the grid reads consistently
// across reloads.
const ROLE_ORDER = [
  "general",
  "po",
  "ux",
  "seth-architect",
  "seth-frontend",
  "seth-be-python",
  "seth-be-java",
  "seth-fullstack",
  "seth-tester",
  "seth-reviewer",
  "seth-devops",
];

function fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Groups the project's non-profile cards by role. Returns tiles sorted per
// ROLE_ORDER (unknown roles fall back to the end, alphabetically).
function groupByRole(cards) {
  const byRole = new Map();
  for (const c of cards) {
    if (c.kind === "profile") continue; // belongs to the Knowledge base panel
    if (!byRole.has(c.role)) byRole.set(c.role, []);
    byRole.get(c.role).push(c);
  }
  const roles = [...byRole.keys()].sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a), ib = ROLE_ORDER.indexOf(b);
    if (ia < 0 && ib < 0) return a.localeCompare(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return roles.map((role) => {
    const roleCards = byRole.get(role);
    const standards = roleCards.find((c) => c.kind === "standards") || null;
    const general = roleCards
      .filter((c) => c.kind !== "standards")
      .sort((a, b) => (b.md_updated_at || "").localeCompare(a.md_updated_at || ""));
    const latest = [...roleCards].sort((a, b) =>
      (b.md_updated_at || "").localeCompare(a.md_updated_at || "")
    )[0];
    return { role, general, standards, latest, count: roleCards.length };
  });
}

export default function CardsPanel({ state, selectedProject }) {
  const [openRole, setOpenRole] = useState(null);

  const project = (state.projects || []).find((p) => p.id === selectedProject);
  if (!project) {
    return <div className="empty">No project selected.</div>;
  }

  const cards = (state.knowledge || []).filter((k) => k.project_id === selectedProject);
  const tiles = groupByRole(cards);
  const selectedTile = tiles.find((t) => t.role === openRole) || null;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 4px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <LayoutGrid size={18} />
        <h2 style={{ margin: 0, fontSize: 18 }}>Cards — {project.name}</h2>
        {project.jira_key && <span className="project-key">{project.jira_key}</span>}
      </div>

      {tiles.length === 0 ? (
        <div className="agent-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="add-agent" style={{ cursor: "default" }}>
            No cards yet. Pre-training (<code>/sethlans-onboard</code>) creates them for PO,
            architect, UX, tester.
          </div>
        </div>
      ) : (
        <div className="agent-grid">
          {tiles.map((tile) => (
            <RoleTile key={tile.role} tile={tile} onOpen={() => setOpenRole(tile.role)} />
          ))}
        </div>
      )}

      {selectedTile && (
        <RoleDetailOverlay tile={selectedTile} onClose={() => setOpenRole(null)} />
      )}
    </div>
  );
}

function RoleTile({ tile, onOpen }) {
  const label = roleLabel(tile.role);
  return (
    <div className="agent-card" onClick={onOpen} role="button" tabIndex={0}>
      <div className="agent-top">
        <div className="agent-avatar" style={{ background: roleColor(tile.role) }}>
          {label[0]}
        </div>
        <div style={{ flex: 1 }}>
          <div className="agent-name">{label}</div>
          <div className="status-row">
            <span className="status-text">
              {tile.count} {tile.count === 1 ? "card" : "cards"}
            </span>
          </div>
        </div>
      </div>
      <div className="task-box">
        <span className="task-label">Latest card</span>
        <span className="task-val">{tile.latest?.title || "—"}</span>
      </div>
      <div className="badge-row">
        <span className="badge" style={{ background: "#444" }}>
          KB &times;{tile.general.length}
        </span>
        <span
          className="badge"
          style={{
            background: tile.standards ? "var(--c-done)" : "var(--muted)",
            color: tile.standards ? "#06210e" : "#fff",
          }}
        >
          {tile.standards ? "Standards ✓" : "Standards —"}
        </span>
      </div>
    </div>
  );
}

function RoleDetailOverlay({ tile, onClose }) {
  const label = roleLabel(tile.role);
  return (
    <div className="mockup-overlay-backdrop" onClick={onClose}>
      <div className="mockup-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="preview-overlay">
          <div className="preview-head">
            <div className="preview-title">
              <span className="badge" style={{ background: roleColor(tile.role) }}>
                {label}
              </span>
              {label} — knowledge
            </div>
            <button className="close-x" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="section-title">
            General knowledge{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400, textTransform: "none" }}>
              ({tile.general.length})
            </span>
          </div>
          {tile.general.length === 0 ? (
            <div className="empty-state">
              No general knowledge card for this role yet.
            </div>
          ) : (
            tile.general.map((c) => (
              <div key={c.id} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 13.5 }}>{c.title}</strong>
                  {c.md_updated_at && (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        color: "var(--muted)",
                      }}
                    >
                      <Clock size={11} /> {fmtDate(c.md_updated_at)}
                    </span>
                  )}
                </div>
                <MdView md={c.md} />
              </div>
            ))
          )}

          <div className="section-title">
            Standards{" "}
            {tile.standards ? (
              <span style={{ color: "var(--c-done)", fontWeight: 700, textTransform: "none" }}>
                &#10003; present
              </span>
            ) : (
              <span style={{ color: "var(--muted)", fontWeight: 400, textTransform: "none" }}>
                &mdash; absent
              </span>
            )}
          </div>
          {tile.standards ? (
            <div className="standards-box">
              <MdView md={tile.standards.md} />
            </div>
          ) : (
            <div className="empty-state">
              No Standards card for this role yet. A <code>kind=standards</code> Knowledge card
              would appear here (the role&apos;s Definition of Done).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
