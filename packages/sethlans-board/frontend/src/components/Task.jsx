import { useState } from "react";
import { Plus, Pencil, Trash2, Cpu, FileText } from "lucide-react";
import { COLS, colAccent, ColHeader, MdEditor } from "./shared.jsx";
import MockupViewer, { MockupButton } from "./MockupViewer.jsx";
import * as api from "../api.js";
import { READONLY } from "../config.js";

// Task board for a story (Trello-style). Each task has an MD document
// (work description + architectural choices + work notes).
export default function Task({ state, reload, storyId, drag, setDrag }) {
  const [adding, setAdding] = useState(null);
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState(null);
  const [mdOpen, setMdOpen] = useState(null);
  const [mockupTask, setMockupTask] = useState(null); // { id, title } per F3

  const add = async (status) => {
    if (!title.trim()) return;
    await api.tasks.create({ title, status, story_id: storyId, agent_id: null });
    setTitle("");
    setAdding(null);
    reload();
  };
  const save = async (id, patch) => {
    await api.tasks.update(id, patch);
    reload();
  };
  const del = async (id) => {
    await api.tasks.remove(id);
    reload();
  };
  const onDrop = async (status) => {
    if (!drag || drag.kind !== "task") return;
    await api.tasks.update(drag.id, { status });
    setDrag(null);
    reload();
  };
  const agentName = (id) => state.agents.find((a) => a.id === id)?.name;

  return (
    <div className="board">
      {COLS.map((col) => {
        const items = state.tasks.filter(
          (t) => t.story_id === storyId && t.status === col.key
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
                  onDragStart={() => !READONLY && setDrag({ kind: "task", id: it.id })}
                  onDragEnd={() => setDrag(null)}
                  className="card"
                  style={{ borderLeft: `3px solid ${colAccent[col.key]}` }}
                >
                  {editing === it.id ? (
                    <div className="add-form">
                      <input
                        autoFocus
                        defaultValue={it.title}
                        onBlur={(e) => save(it.id, { title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            save(it.id, { title: e.target.value });
                            setEditing(null);
                          }
                        }}
                        className="input"
                      />
                      <select
                        value={it.agent_id || ""}
                        onChange={(e) =>
                          save(it.id, { agent_id: e.target.value || null })
                        }
                        className="input"
                      >
                        <option value="">— No agent —</option>
                        {state.agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <button className="btn-primary" onClick={() => setEditing(null)}>
                        Done
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="card-top">
                        <div className="card-title">{it.title}</div>
                        <div className="card-actions">
                          <MockupButton
                            compact
                            count={it.mockup_count}
                            onClick={() => setMockupTask({ id: it.id, title: it.title })}
                          />
                          <button
                            className="icon-btn"
                            title="Document"
                            onClick={() => setMdOpen(mdOpen === it.id ? null : it.id)}
                          >
                            <FileText size={13} />
                          </button>
                          {!READONLY && (
                            <>
                              <button className="icon-btn" onClick={() => setEditing(it.id)}>
                                <Pencil size={13} />
                              </button>
                              <button className="icon-btn" onClick={() => del(it.id)}>
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {it.agent_id && (
                        <span className="agent-tag">
                          <Cpu size={11} /> {agentName(it.agent_id)}
                        </span>
                      )}
                      {mdOpen === it.id && (
                        <div style={{ marginTop: 8 }}>
                          <MdEditor
                            value={it.md}
                            onSave={(md) => save(it.id, { md })}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              {!READONLY &&
                (adding === col.key ? (
                  <div className="add-form">
                    <input
                      autoFocus
                      placeholder="Task title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && add(col.key)}
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
                          setTitle("");
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
      {mockupTask && (
        <MockupViewer
          level="task"
          id={mockupTask.id}
          title={mockupTask.title}
          onClose={() => setMockupTask(null)}
        />
      )}
    </div>
  );
}
