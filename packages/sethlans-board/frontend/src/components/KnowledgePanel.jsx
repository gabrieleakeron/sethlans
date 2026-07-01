import { BookOpen, Clock } from "lucide-react";
import { MdView } from "./shared.jsx";

// Browsable panel for the project profile:
// - the project profile (mirror of CLAUDE.md + config, managed by /sethlans-onboard).
// The per-role/agent knowledge cards (kb/learnings/standards) have moved to the
// dedicated Cards view (see CardsPanel.jsx, story s5cadd1fc) — this panel no
// longer lists them, to avoid duplicating the same data in two places.
// Read-only: agents write via the API, here it's just for browsing.

function fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function KnowledgePanel({ state, selectedProject }) {
  const project = (state.projects || []).find((p) => p.id === selectedProject);

  if (!project) {
    return <div className="empty">No project selected.</div>;
  }

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
    </div>
  );
}
