import { useState } from "react";
import { Layers, Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { COLS, colAccent, ColHeader, EditBox, PhaseBadge } from "./shared.jsx";
import MockupViewer, { MockupButton } from "./MockupViewer.jsx";
import * as api from "../api.js";
import { READONLY } from "../config.js";

// Home: epics on the left (vertical sections), stories of the selected epic on the right.
export default function Agenda({
  state,
  reload,
  selectedProject,
  selectedEpic,
  setSelectedEpic,
  openStory,
  drag,
  setDrag,
}) {
  return (
    <div className="agenda-layout">
      <EpicPanel
        state={state}
        reload={reload}
        selectedProject={selectedProject}
        selectedEpic={selectedEpic}
        setSelectedEpic={setSelectedEpic}
        drag={drag}
        setDrag={setDrag}
      />
      <StoryPanel
        state={state}
        reload={reload}
        selectedEpic={selectedEpic}
        openStory={openStory}
        drag={drag}
        setDrag={setDrag}
      />
    </div>
  );
}

// ---- Left: epics in three vertical sections ----
function EpicPanel({ state, reload, selectedProject, selectedEpic, setSelectedEpic, drag, setDrag }) {
  const [adding, setAdding] = useState(null);
  const [form, setForm] = useState({ title: "", desc: "" });
  const [editing, setEditing] = useState(null);
  const [mockupEpic, setMockupEpic] = useState(null); // { id, title } per F1

  const add = async (status) => {
    if (!form.title.trim() || !selectedProject) return;
    await api.epics.create({
      title: form.title,
      desc: form.desc,
      status,
      project_id: selectedProject,
    });
    setForm({ title: "", desc: "" });
    setAdding(null);
    reload();
  };
  const save = async (id, patch) => {
    await api.epics.update(id, patch);
    setEditing(null);
    reload();
  };
  const del = async (id) => {
    await api.epics.remove(id);
    reload();
  };
  const onDrop = async (status) => {
    if (!drag || drag.kind !== "epic") return;
    await api.epics.update(drag.id, { status });
    setDrag(null);
    reload();
  };

  if (!selectedProject)
    return (
      <div className="epic-panel">
        <div className="panel-title">
          <Layers size={15} /> Epics
        </div>
        <div className="empty">
          No project selected. Create one from the header.
        </div>
      </div>
    );

  return (
    <div className="epic-panel">
      <div className="panel-title">
        <Layers size={15} /> Epics
      </div>
      <div className="epic-sections">
        {COLS.map((col) => {
          const items = state.epics.filter(
            (e) => e.status === col.key && e.project_id === selectedProject
          );
          return (
            <div
              key={col.key}
              className="epic-section"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(col.key)}
            >
              <div className="section-header">
                <span className="col-dot" style={{ background: colAccent[col.key] }} />
                <span className="section-title">{col.label}</span>
                <span className="col-count">{items.length}</span>
              </div>
              <div className="epic-list">
                {items.map((e) => (
                  <div
                    key={e.id}
                    draggable={!READONLY}
                    onDragStart={() => !READONLY && setDrag({ kind: "epic", id: e.id })}
                    onDragEnd={() => setDrag(null)}
                    onClick={() => setSelectedEpic(e.id)}
                    className={`epic-card${selectedEpic === e.id ? " selected" : ""}`}
                    style={{ borderLeft: `3px solid ${colAccent[col.key]}` }}
                  >
                    {editing === e.id ? (
                      <EditBox
                        item={e}
                        onSave={(p) => save(e.id, p)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <>
                        <div className="card-top">
                          <div className="epic-title">{e.title}</div>
                          {!READONLY && (
                            <div className="card-actions">
                              <button
                                className="icon-btn"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setEditing(e.id);
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                className="icon-btn"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  del(e.id);
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                        {e.desc && <div className="card-desc">{e.desc}</div>}
                        <div className="epic-meta">
                          {state.stories.filter((s) => s.epic_id === e.id).length} stories
                        </div>
                        <MockupButton
                          count={e.mockup_descendant_count}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setMockupEpic({ id: e.id, title: e.title });
                          }}
                        />
                      </>
                    )}
                  </div>
                ))}
                {!READONLY &&
                  (adding === col.key ? (
                    <div className="add-form">
                      <input
                        autoFocus
                        placeholder="Epic title"
                        value={form.title}
                        onChange={(ev) => setForm((f) => ({ ...f, title: ev.target.value }))}
                        onKeyDown={(ev) => ev.key === "Enter" && add(col.key)}
                        className="input"
                      />
                      <input
                        placeholder="Description"
                        value={form.desc}
                        onChange={(ev) => setForm((f) => ({ ...f, desc: ev.target.value }))}
                        className="input"
                      />
                      <div className="form-row">
                        <button className="btn-primary" onClick={() => add(col.key)}>
                          Add
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => {
                            setAdding(null);
                            setForm({ title: "", desc: "" });
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="add-btn-sm" onClick={() => setAdding(col.key)}>
                      <Plus size={13} /> Epic
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      {mockupEpic && (
        <MockupViewer
          level="epic"
          id={mockupEpic.id}
          title={mockupEpic.title}
          onClose={() => setMockupEpic(null)}
        />
      )}
    </div>
  );
}

// ---- Right: stories of the selected epic (Kanban) ----
function StoryPanel({ state, reload, selectedEpic, openStory, drag, setDrag }) {
  const [adding, setAdding] = useState(null);
  const [form, setForm] = useState({ title: "", desc: "" });
  const [editing, setEditing] = useState(null);
  const [mockupStory, setMockupStory] = useState(null); // { id, title } per F2
  const epic = state.epics.find((e) => e.id === selectedEpic);

  const add = async (status) => {
    if (!form.title.trim() || !epic) return;
    await api.stories.create({
      title: form.title,
      desc: form.desc,
      status,
      epic_id: epic.id,
    });
    setForm({ title: "", desc: "" });
    setAdding(null);
    reload();
  };
  const save = async (id, patch) => {
    await api.stories.update(id, patch);
    setEditing(null);
    reload();
  };
  const del = async (id) => {
    await api.stories.remove(id);
    reload();
  };
  const onDrop = async (status) => {
    if (!drag || drag.kind !== "story") return;
    await api.stories.update(drag.id, { status });
    setDrag(null);
    reload();
  };

  if (!epic)
    return (
      <div className="story-panel">
        <div className="empty">Select an epic on the left.</div>
      </div>
    );

  return (
    <div className="story-panel">
      <div className="panel-title">
        <span className="badge" style={{ background: "var(--epic)" }}>
          EPIC
        </span>
        <span className="panel-epic-name">{epic.title}</span>
      </div>
      <div className="board">
        {COLS.map((col) => {
          const items = state.stories.filter(
            (s) => s.epic_id === epic.id && s.status === col.key
          );
          return (
            <div
              key={col.key}
              className="col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(col.key)}
            >
              <ColHeader col={col} count={items.length} />
              <div className="col-body">
                {items.map((it) => (
                  <div
                    key={it.id}
                    draggable={!READONLY}
                    onDragStart={() => !READONLY && setDrag({ kind: "story", id: it.id })}
                    onDragEnd={() => setDrag(null)}
                    className="card"
                    style={{ borderLeft: `3px solid ${colAccent[col.key]}` }}
                  >
                    {editing === it.id ? (
                      <EditBox
                        item={it}
                        onSave={(p) => save(it.id, p)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <>
                        <div className="card-top">
                          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span className="badge" style={{ background: "var(--story)" }}>
                              STORY
                            </span>
                            <PhaseBadge phase={it.phase} />
                          </span>
                          {!READONLY && (
                            <div className="card-actions">
                              <button className="icon-btn" onClick={() => setEditing(it.id)}>
                                <Pencil size={13} />
                              </button>
                              <button className="icon-btn" onClick={() => del(it.id)}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="card-title">{it.title}</div>
                        {it.desc && <div className="card-desc">{it.desc}</div>}
                        <MockupButton
                          count={it.mockup_descendant_count}
                          onClick={() => setMockupStory({ id: it.id, title: it.title })}
                        />
                        <button className="open-btn" onClick={() => openStory(it.id)}>
                          Open <ChevronRight size={13} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {!READONLY &&
                  (adding === col.key ? (
                    <div className="add-form">
                      <input
                        autoFocus
                        placeholder="Story title"
                        value={form.title}
                        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && add(col.key)}
                        className="input"
                      />
                      <input
                        placeholder="Description"
                        value={form.desc}
                        onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
                        className="input"
                      />
                      <div className="form-row">
                        <button className="btn-primary" onClick={() => add(col.key)}>
                          Add
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => {
                            setAdding(null);
                            setForm({ title: "", desc: "" });
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="add-btn" onClick={() => setAdding(col.key)}>
                      <Plus size={15} /> Add
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      {mockupStory && (
        <MockupViewer
          level="story"
          id={mockupStory.id}
          title={mockupStory.title}
          onClose={() => setMockupStory(null)}
        />
      )}
    </div>
  );
}
