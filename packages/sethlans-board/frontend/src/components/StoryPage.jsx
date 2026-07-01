import { useState } from "react";
import { Trello, Cpu, FileText, ChevronRight } from "lucide-react";
import Task from "./Task.jsx";
import Agents from "./Agents.jsx";
import { PhaseBadge, MdEditor } from "./shared.jsx";
import * as api from "../api.js";

// Story detail page: Task tab + Agents tab + Document (MD) tab.
export default function StoryPage({ state, reload, storyId, drag, setDrag }) {
  const [tab, setTab] = useState("task");
  const story = state.stories.find((s) => s.id === storyId);
  const epic = story ? state.epics.find((e) => e.id === story.epic_id) : null;

  if (!story) return <div className="empty">Story not found.</div>;

  const saveMd = async (md) => {
    await api.stories.update(storyId, { md });
    reload();
  };

  const tabs = [
    { k: "task", label: "Task", icon: Trello },
    { k: "agents", label: "Agents", icon: Cpu },
    { k: "doc", label: "Document", icon: FileText },
  ];

  return (
    <div className="story-page">
      <div className="breadcrumb">
        {epic && <span className="crumb-epic">{epic.title}</span>}
        {epic && <ChevronRight size={13} style={{ color: "var(--muted)" }} />}
        <span className="crumb-story">{story.title}</span>
        <PhaseBadge phase={story.phase} />
      </div>
      <div className="sub-tabs">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`sub-tab${tab === t.k ? " active" : ""}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === "task" && (
        <Task
          state={state}
          reload={reload}
          storyId={storyId}
          drag={drag}
          setDrag={setDrag}
        />
      )}
      {tab === "agents" && <Agents state={state} reload={reload} storyId={storyId} />}
      {tab === "doc" && (
        <div style={{ padding: "4px 2px" }}>
          <MdEditor value={story.md} onSave={saveMd} />
        </div>
      )}
    </div>
  );
}
