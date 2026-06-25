import { useState, useEffect, useRef } from "react";
import { FolderKanban, Plus, ChevronDown, Check } from "lucide-react";
import * as api from "../api.js";
import { READONLY } from "../config.js";

// Project switcher in the header: dropdown to choose the active project
// + form to create a new one (Jira or internal).
export default function ProjectSwitcher({ projects, selectedProject, onSelect, reload }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", type: "jira", jira_key: "" });
  const ref = useRef(null);

  // closes the panel on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = projects.find((p) => p.id === selectedProject);

  const create = async () => {
    if (!form.name.trim()) return;
    const created = await api.projects.create({
      name: form.name.trim(),
      type: form.type,
      jira_key: form.type === "jira" ? form.jira_key.trim() : "",
    });
    setForm({ name: "", type: "jira", jira_key: "" });
    setAdding(false);
    setOpen(false);
    await reload();
    onSelect(created.id);
  };

  return (
    <div className="project-switcher" ref={ref}>
      <button className="project-trigger" onClick={() => setOpen((o) => !o)}>
        <FolderKanban size={15} />
        <span className="project-current">
          {current ? current.name : "No project"}
        </span>
        {current?.jira_key && <span className="project-key">{current.jira_key}</span>}
        <ChevronDown size={14} style={{ color: "var(--muted)" }} />
      </button>

      {open && (
        <div className="project-menu">
          <div className="project-list">
            {projects.length === 0 && (
              <div className="project-empty">No projects. Create one.</div>
            )}
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-item${p.id === selectedProject ? " active" : ""}`}
                onClick={() => {
                  onSelect(p.id);
                  setOpen(false);
                }}
              >
                <span className="project-item-name">{p.name}</span>
                {p.jira_key && <span className="project-key">{p.jira_key}</span>}
                {p.id === selectedProject && (
                  <Check size={14} style={{ marginLeft: "auto", color: "var(--c-done)" }} />
                )}
              </button>
            ))}
          </div>

          {!READONLY &&
            (adding ? (
              <div className="add-form" style={{ margin: "8px" }}>
                <input
                  autoFocus
                  className="input"
                  placeholder="Project name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                />
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                >
                  <option value="jira">Jira project</option>
                  <option value="internal">Internal project</option>
                </select>
                {form.type === "jira" && (
                  <input
                    className="input"
                    placeholder="Jira key (e.g. ABC)"
                    value={form.jira_key}
                    onChange={(e) => setForm((f) => ({ ...f, jira_key: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && create()}
                  />
                )}
                <div className="form-row">
                  <button className="btn-primary" onClick={create}>
                    Create
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setAdding(false);
                      setForm({ name: "", type: "jira", jira_key: "" });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="project-add" onClick={() => setAdding(true)}>
                <Plus size={14} /> New project
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
