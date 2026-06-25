import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { MdView } from "./shared.jsx";

// Browsable panel for project knowledge:
// - the project profile (mirror of CLAUDE.md + config, managed by /sethlans-onboard);
// - the knowledge cards (per role/scope) produced by pre-training.
// Read-only: agents write via the API, here it's just for browsing.

const ROLE_LABELS = {
  general: "General",
  po: "Product Owner",
  architect: "Architect",
  ux: "UX Designer",
  tester: "Tester",
  frontend: "Frontend",
  "be-python": "BE Python",
  "be-java": "BE Java",
  fullstack: "Fullstack",
  reviewer: "Reviewer",
  devops: "DevOps",
};
const ROLE_COLOR = {
  general: "#6b7280",
  po: "#8b6fd6",
  architect: "#4a90d9",
  ux: "#d67fb0",
  tester: "#3fae5a",
};
const KIND_LABELS = { profile: "Profile", kb: "KB", learnings: "Learnings" };

function fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function Badge({ text, color }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        padding: "2px 7px",
        borderRadius: 6,
        color: "#fff",
        background: color || "var(--muted)",
      }}
    >
      {text}
    </span>
  );
}

function Card({ card }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: "1px solid var(--border, #2a2a3a)",
        borderRadius: 8,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Badge text={ROLE_LABELS[card.role] || card.role} color={ROLE_COLOR[card.role]} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{card.title}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <Badge text={KIND_LABELS[card.kind] || card.kind} color="#444" />
          {card.md_updated_at && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted)" }}>
              <Clock size={11} /> {fmtDate(card.md_updated_at)}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px 14px" }}>
          <MdView md={card.md} />
        </div>
      )}
    </div>
  );
}

export default function KnowledgePanel({ state, selectedProject }) {
  const project = (state.projects || []).find((p) => p.id === selectedProject);
  const cards = (state.knowledge || []).filter((k) => k.project_id === selectedProject);

  if (!project) {
    return <div className="empty">No project selected.</div>;
  }

  // sort: profile first, then by role
  const order = ["general", "po", "architect", "ux", "tester"];
  const sorted = [...cards].sort((a, b) => {
    const ia = order.indexOf(a.role), ib = order.indexOf(b.role);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const hasConfig = project.config && Object.keys(project.config).length > 0;

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "8px 4px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <BookOpen size={18} />
        <h2 style={{ margin: 0, fontSize: 18 }}>Knowledge — {project.name}</h2>
        {project.jira_key && <span className="project-key">{project.jira_key}</span>}
      </div>

      {/* Project profile */}
      <section style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Project profile</h3>
          {project.md_updated_at && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted)" }}>
              <Clock size={11} /> {fmtDate(project.md_updated_at)}
            </span>
          )}
        </div>
        {project.md && project.md.trim() ? (
          <MdView md={project.md} />
        ) : (
          <div className="empty">
            No profile. Run <code>/sethlans-onboard</code> to populate it from CLAUDE.md.
          </div>
        )}
        {hasConfig && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
              Per-role config (pointers)
            </summary>
            <pre
              style={{
                fontSize: 12,
                background: "var(--panel, #1b1b26)",
                padding: 12,
                borderRadius: 8,
                overflow: "auto",
              }}
            >
              {JSON.stringify(project.config, null, 2)}
            </pre>
          </details>
        )}
      </section>

      {/* Knowledge cards */}
      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>
          Knowledge cards <span style={{ color: "var(--muted)", fontWeight: 400 }}>({sorted.length})</span>
        </h3>
        {sorted.length === 0 ? (
          <div className="empty">
            No cards yet. Pre-training (<code>/sethlans-onboard</code>) creates them for PO, architect, UX, tester.
          </div>
        ) : (
          sorted.map((c) => <Card key={c.id} card={c} />)
        )}
      </section>
    </div>
  );
}
