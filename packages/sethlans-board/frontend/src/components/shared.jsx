import { useState } from "react";
import { READONLY } from "../config.js";

export const COLS = [
  { key: "todo", label: "To Do" },
  { key: "progress", label: "In Progress" },
  { key: "done", label: "Done" },
];

export const colAccent = {
  todo: "var(--c-todo)",
  progress: "var(--c-prog)",
  done: "var(--c-done)",
};

export function ColHeader({ col, count }) {
  return (
    <div className="col-header">
      <span className="col-dot" style={{ background: colAccent[col.key] }} />
      <span className="col-title">{col.label}</span>
      <span className="col-count">{count}</span>
    </div>
  );
}

// Inline form to edit title + description (epics and stories)
export function EditBox({ item, onSave, onCancel }) {
  const [title, setTitle] = useState(item.title);
  const [desc, setDesc] = useState(item.desc || "");
  return (
    <div className="add-form" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="input"
        placeholder="Title"
      />
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        className="input"
        placeholder="Description"
      />
      <div className="form-row">
        <button className="btn-primary" onClick={() => onSave({ title, desc })}>
          Save
        </button>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---- Story phases (phase) ----
export const PHASE_LABELS = {
  analysis: "Analysis",
  ux: "UX",
  design: "Design",
  dev: "Dev",
  done: "Done",
};
const PHASE_COLORS = {
  analysis: "#8957e5",
  ux: "#db61a2",
  design: "#2f81f7",
  dev: "#d29922",
  done: "#3fb950",
};

export function PhaseBadge({ phase }) {
  if (!phase) return null;
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
        background: PHASE_COLORS[phase] || "var(--muted)",
      }}
    >
      {PHASE_LABELS[phase] || phase}
    </span>
  );
}

// ---- Mini Markdown renderer (dependency-free) ----
// Escaped input -> safe HTML output (only tags generated here). HTML mockups
// do NOT go through this: they are isolated in a sandboxed iframe (see MdView).
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inlineMd(s) {
  // s is already escaped
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}
function renderMarkdown(md) {
  const lines = esc(md).split(/\r?\n/);
  let html = "";
  let inList = false;
  let inCode = false;
  let code = "";
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) {
        html += "<pre><code>" + code + "</code></pre>";
        code = "";
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code += line + "\n";
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      html += `<h${lvl}>` + inlineMd(h[2]) + `</h${lvl}>`;
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += "<li>" + inlineMd(li[1]) + "</li>";
      continue;
    }
    if (line.trim() === "") {
      closeList();
      continue;
    }
    closeList();
    html += "<p>" + inlineMd(line) + "</p>";
  }
  if (inCode) html += "<pre><code>" + code + "</code></pre>";
  closeList();
  return html;
}

// ---- Render of the MD document (markdown + HTML mockups in sandboxed iframe) ----
// Parser line-based dei blocchi ```mockup``` — deve rispecchiare `iter_mockup_blocks`
// in backend/models.py per restare coerente (conteggio + estrazione). NON usare una
// regex single-pass: una regex non-greedy rischia falsi positivi quando la stringa
// letterale "```mockup" compare nel CONTENUTO di un blocco già aperto (es. copy di
// empty-state), aprendo blocchi fantasma. Semantica (identica BE/FE):
//   - apertura = una riga che, dopo trim(), inizia con "```mockup" (info-string dopo
//     "mockup" ammessa e ignorata); niente apertura se già dentro un blocco.
//   - chiusura = la PRIMA riga successiva che, dopo trim(), è esattamente "```".
//   - il contenuto tra le due righe è opaco: occorrenze inline dentro una riga non
//     aprono/chiudono nulla, solo righe-fence intere.
//   - fence non chiusa a fine documento: il blocco viene chiuso a EOF.
function splitMockups(md) {
  const lines = md.split(/(?<=\n)/); // mantiene i terminatori di riga, come splitlines(keepends=True)
  const parts = [];
  let mdBuffer = "";
  let mockupBuffer = "";
  let inBlock = false;

  for (const line of lines) {
    const stripped = line.trim();
    if (!inBlock) {
      if (stripped.startsWith("```mockup")) {
        if (mdBuffer) parts.push({ type: "md", content: mdBuffer });
        mdBuffer = "";
        mockupBuffer = "";
        inBlock = true;
      } else {
        mdBuffer += line;
      }
    } else {
      if (stripped === "```") {
        parts.push({ type: "mockup", content: mockupBuffer });
        mockupBuffer = "";
        inBlock = false;
      } else {
        mockupBuffer += line;
      }
    }
  }
  if (inBlock) {
    // Fence non chiusa a fine documento: si chiude a EOF per non perdere il contenuto.
    parts.push({ type: "mockup", content: mockupBuffer });
  } else if (mdBuffer) {
    parts.push({ type: "md", content: mdBuffer });
  }
  return parts;
}

export function MdView({ md }) {
  if (!md || !md.trim())
    return <div className="empty">No document associated.</div>;
  const parts = splitMockups(md);
  return (
    <div className="md-view" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {parts.map((p, i) =>
        p.type === "mockup" ? (
          <iframe
            key={i}
            title={`mockup-${i}`}
            sandbox=""
            srcDoc={p.content}
            style={{
              width: "100%",
              minHeight: 360,
              border: "1px solid var(--border, #2a2a3a)",
              borderRadius: 8,
              background: "#fff",
            }}
          />
        ) : (
          <div
            key={i}
            className="md-prose"
            style={{ lineHeight: 1.5, fontSize: 14 }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(p.content || "") }}
          />
        )
      )}
    </div>
  );
}

// MD editor: textarea + save
export function MdEditor({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");
  // Read-only mode does not allow editing the document: only the view is shown.
  if (READONLY) return <MdView md={value} />;
  if (!editing) {
    return (
      <div>
        <button className="btn-ghost" onClick={() => { setText(value || ""); setEditing(true); }}>
          ✎ Edit document
        </button>
        <MdView md={value} />
      </div>
    );
  }
  return (
    <div className="add-form">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="input"
        style={{ minHeight: 220, fontFamily: "monospace", fontSize: 13 }}
        placeholder="Markdown document (supports ```mockup``` HTML blocks)…"
      />
      <div className="form-row">
        <button className="btn-primary" onClick={() => { onSave(text); setEditing(false); }}>
          Save
        </button>
        <button className="btn-ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
