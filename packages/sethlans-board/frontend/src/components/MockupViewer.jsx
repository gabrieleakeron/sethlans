import { useEffect, useState } from "react";
import {
  Eye,
  X,
  ArrowLeft,
  MessageSquare,
  Paperclip,
  Plus,
  Pencil,
  Trash2,
  ZoomIn,
  ZoomOut,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Link as LinkIcon,
  Code,
  Squircle,
} from "lucide-react";
import * as api from "../api.js";
import { READONLY } from "../config.js";

// ---------------------------------------------------------------------------
// MockupViewer — overlay condiviso per la gestione CRUD mockup (PreviewBoard)
// e il rendering multi-provider (MockupRendering), con pannello commenti
// sempre presente sotto il rendering.
//
// Story s443652b6: i mockup sono ora un'entità di prima classe (`/mockups`),
// non più blocchi nel `md`. `GET /mockups` resta retrocompatibile: per gli
// owner senza righe persistite ritorna ancora gli item legacy derivati dal
// `md` (forma diversa: niente `id`/`type`, ha `mockup_index`/`name`). La UI
// gestisce entrambe le forme — solo gli item "nuovi" (con `id`) sono
// editabili/cancellabili e supportano type diversi da html.
//
// Props:
//   level: "epic" | "story" | "task" — livello di apertura (determina se
//          mostrare la preview board intermedia: epic/story sì, task no).
//   id: id dell'entità di livello `level`.
//   title: titolo da mostrare nell'header dell'overlay.
//   onClose: callback di chiusura.
// ---------------------------------------------------------------------------

const ORIGIN_LABEL = { epic: "EPIC", story: "STORY", task: "TASK" };

// Lookup robusto: un target_type non ancora mappato non deve far crashare la UI
// (nessun error boundary lo intercetta) — fallback sull'uppercase del valore grezzo.
function originLabel(type) {
  return ORIGIN_LABEL[type] || (type ? String(type).toUpperCase() : "?");
}

const TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "html", label: "HTML" },
  { key: "image", label: "Image" },
  { key: "figma", label: "Figma" },
  { key: "claude_canvas", label: "Claude Canvas" },
  { key: "link", label: "Link" },
];

const TYPE_LABEL = {
  html: "HTML",
  image: "IMAGE",
  figma: "FIGMA",
  claude_canvas: "CLAUDE CANVAS",
  link: "LINK",
};

// Item "nuovo" (entità Mockup): ha un id stabile (mk########).
// Item legacy (derivato a runtime dal md): niente id, ha mockup_index.
function isEntityItem(item) {
  return !!item.id;
}
function itemType(item) {
  return isEntityItem(item) ? item.type : "html";
}
function itemOwnerType(item) {
  return isEntityItem(item) ? item.owner_type : item.target_type;
}
function itemOwnerId(item) {
  return isEntityItem(item) ? item.owner_id : item.target_id;
}
function itemTitle(item) {
  return isEntityItem(item) ? item.title : item.name;
}
function itemKey(item) {
  return isEntityItem(item)
    ? `mk-${item.id}`
    : `legacy-${item.target_type}-${item.target_id}-${item.mockup_index}`;
}

export default function MockupViewer({ level, id, title, onClose }) {
  const [mockupList, setMockupList] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // mockup item selezionato

  const showBoard = level === "epic" || level === "story";

  const reload = () => {
    setError(null);
    const params =
      level === "epic" ? { epic_id: id } : level === "story" ? { story_id: id } : { task_id: id };
    return api.mockups
      .list(params)
      .then((res) => {
        const items = res.mockups || [];
        setMockupList(items);
        return items;
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setMockupList(null);
    setSelected(null);
    const params =
      level === "epic" ? { epic_id: id } : level === "story" ? { story_id: id } : { task_id: id };
    api.mockups
      .list(params)
      .then((res) => {
        if (cancelled) return;
        const items = res.mockups || [];
        setMockupList(items);
        // Task: rendering diretto, nessuna preview board intermedia.
        if (!showBoard && items.length > 0) setSelected(items[0]);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [level, id, showBoard]);

  return (
    <div className="mockup-overlay-backdrop" onClick={onClose}>
      <div className="mockup-overlay" onClick={(e) => e.stopPropagation()}>
        {selected ? (
          <MockupRendering
            item={selected}
            onBack={showBoard ? () => setSelected(null) : null}
            onClose={onClose}
          />
        ) : (
          <PreviewBoard
            level={level}
            ownerId={id}
            title={title}
            mockupList={mockupList}
            error={error}
            onSelect={setSelected}
            onClose={onClose}
            onChanged={reload}
          />
        )}
      </div>
    </div>
  );
}

function PreviewBoard({ level, ownerId, title, mockupList, error, onSelect, onClose, onChanged }) {
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const filtered = (mockupList || []).filter(
    (m) => filter === "all" || itemType(m) === filter
  );

  const del = async (m) => {
    if (!isEntityItem(m)) return; // legacy item: non cancellabile (vive nel md)
    await api.mockups.remove(m.id);
    onChanged();
  };

  // Solo le story possono aprire il form "New mockup" con owner = story o un
  // suo task (level=task non ha senso scegliere un owner diverso).
  const canManage = level === "story" || level === "task";

  return (
    <div className="preview-overlay">
      <div className="preview-head">
        <div className="preview-title">
          <span className="badge" style={{ background: level === "epic" ? "var(--epic)" : "var(--story)" }}>
            {level.toUpperCase()}
          </span>
          Mockup di &quot;{title}&quot;
        </div>
        <button className="close-x" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="toolbar">
        <div className="filter-row">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? " active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {!READONLY && canManage && (
          <button className="btn-primary" style={{ flex: "none" }} onClick={() => setAdding((v) => !v)}>
            <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
            New mockup
          </button>
        )}
      </div>

      {!READONLY && adding && (
        <NewMockupForm
          level={level}
          ownerId={ownerId}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {!READONLY && editingId && (
        <EditMockupForm
          item={(mockupList || []).find((m) => isEntityItem(m) && m.id === editingId)}
          onDone={() => {
            setEditingId(null);
            onChanged();
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {error && <div className="empty-state">Errore nel caricamento dei mockup: {error}</div>}
      {!error && mockupList === null && <div className="empty-state">Caricamento…</div>}
      {!error && mockupList && mockupList.length === 0 && (
        <div className="empty-state">Nessun mockup trovato in questa {level} né nei suoi discendenti.</div>
      )}
      {!error && mockupList && mockupList.length > 0 && filtered.length === 0 && (
        <div className="empty-state">Nessun mockup di tipo &quot;{filter}&quot;.</div>
      )}
      {!error && filtered.length > 0 && (
        <div className="mockup-grid">
          {filtered.map((m) => {
            const type = itemType(m);
            const entity = isEntityItem(m);
            return (
              <div key={itemKey(m)} className="mockup-card" onClick={() => onSelect(m)}>
                {!READONLY && entity && (
                  <div className="card-menu" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="icon-btn-sm"
                      title="Edit"
                      onClick={() => setEditingId(m.id)}
                    >
                      <Pencil size={11} />
                    </button>
                    <button className="icon-btn-sm" title="Delete" onClick={() => del(m)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
                <MockupThumb type={type} />
                <div className="mockup-name">{itemTitle(m)}</div>
                <div className="mockup-meta-row">
                  <span className={`type-badge type-${type}`}>{TYPE_LABEL[type] || type}</span>
                  <span className={`origin-badge origin-${itemOwnerType(m)}`}>
                    {originLabel(itemOwnerType(m))}
                  </span>
                </div>
                <div className="mockup-origin">
                  {m.comment_count > 0 && (
                    <span className="mockup-comment-count">
                      <MessageSquare size={11} /> {m.comment_count}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MockupThumb({ type }) {
  const icon =
    type === "image" ? (
      <ImageIcon size={16} />
    ) : type === "figma" ? (
      <Squircle size={16} />
    ) : type === "claude_canvas" ? (
      <Squircle size={16} />
    ) : type === "link" ? (
      <LinkIcon size={16} />
    ) : (
      <Code size={16} />
    );
  return (
    <div className="mockup-thumb">
      {icon}
      &nbsp;{TYPE_LABEL[type] || type}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form "New mockup": owner = story preselezionata o un task della stessa
// story (dropdown), title, type (select sui 5 valori enum) + area contenuto
// condizionale via mini-tab (Paste HTML / Upload image / External link).
// ---------------------------------------------------------------------------
const SOURCE_FOR_TYPE = {
  html: "embedded",
  image: "upload",
  figma: "figma",
  claude_canvas: "claude",
  link: "url",
};
const CONTENT_MODE_FOR_TYPE = {
  html: "html",
  image: "image",
  figma: "link",
  claude_canvas: "link",
  link: "link",
};

function NewMockupForm({ level, ownerId, onDone, onCancel }) {
  const [tasks, setTasks] = useState([]);
  const [ownerType, setOwnerType] = useState(level === "task" ? "task" : "story");
  const [ownerSel, setOwnerSel] = useState(ownerId);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("html");
  const [html, setHtml] = useState("");
  const [image, setImage] = useState(null); // data URI
  const [imageName, setImageName] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (level !== "story") return;
    let cancelled = false;
    api.tasks
      .list({ story_id: ownerId })
      .then((list) => !cancelled && setTasks(list || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [level, ownerId]);

  const contentMode = CONTENT_MODE_FOR_TYPE[type];

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setSubmitError(null);
    if (!title.trim()) {
      setSubmitError("Title obbligatorio.");
      return;
    }
    const body = {
      owner_type: ownerType,
      owner_id: ownerSel,
      title: title.trim(),
      type,
      source: SOURCE_FOR_TYPE[type],
      position: 0,
    };
    if (contentMode === "html") {
      if (!html.trim()) {
        setSubmitError("Incolla l'HTML del mockup.");
        return;
      }
      body.content = html;
    } else if (contentMode === "image") {
      if (!image) {
        setSubmitError("Carica un'immagine.");
        return;
      }
      body.content = image;
    } else {
      if (!refUrl.trim()) {
        setSubmitError("Specifica l'URL esterno.");
        return;
      }
      body.ref_url = refUrl.trim();
    }
    setSubmitting(true);
    try {
      await api.mockups.create(body);
      onDone();
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="section-title">New mockup — owner &amp; type selection</div>
      <div className="add-form" onClick={(e) => e.stopPropagation()}>
        <div className="form-row">
          <div className="field">
            <span className="field-label">Owner</span>
            {level === "task" ? (
              <div className="owner-pill">
                <span className="badge" style={{ background: "var(--c-prog)", color: "#1a1300" }}>
                  TASK
                </span>
                this task
              </div>
            ) : (
              <select
                className="input"
                value={ownerType === "story" ? "story" : ownerSel}
                onChange={(e) => {
                  if (e.target.value === "story") {
                    setOwnerType("story");
                    setOwnerSel(ownerId);
                  } else {
                    setOwnerType("task");
                    setOwnerSel(e.target.value);
                  }
                }}
              >
                <option value="story">(use story as owner)</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} — {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <span className="field-label">Title</span>
            <input
              className="input"
              placeholder="e.g. Preview board — list view"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="field-label">Type</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="html">html (embedded)</option>
              <option value="image">image (upload)</option>
              <option value="figma">figma (link)</option>
              <option value="claude_canvas">claude_canvas (link)</option>
              <option value="link">link (generic url)</option>
            </select>
          </div>
        </div>

        {contentMode === "html" && (
          <textarea
            className="input"
            style={{ minHeight: 90, fontFamily: "monospace" }}
            placeholder="<!doctype html>..."
            value={html}
            onChange={(e) => setHtml(e.target.value)}
          />
        )}
        {contentMode === "image" && (
          <div>
            <label className="attach-btn" style={{ maxWidth: "100%" }}>
              <Paperclip size={13} /> {imageName || "Upload image"}
              <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
            </label>
          </div>
        )}
        {contentMode === "link" && (
          <input
            className="input"
            placeholder="https://…"
            value={refUrl}
            onChange={(e) => setRefUrl(e.target.value)}
          />
        )}

        {submitError && <div className="comment-error">{submitError}</div>}
        <div className="form-row">
          <button className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "…" : "Create mockup"}
          </button>
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

function EditMockupForm({ item, onDone, onCancel }) {
  if (!item) return null;
  const [title, setTitle] = useState(item.title);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitError(null);
    if (!title.trim()) {
      setSubmitError("Title obbligatorio.");
      return;
    }
    setSubmitting(true);
    try {
      await api.mockups.update(item.id, { title: title.trim() });
      onDone();
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="add-form" onClick={(e) => e.stopPropagation()}>
      <span className="field-label">Edit title</span>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      {submitError && <div className="comment-error">{submitError}</div>}
      <div className="form-row">
        <button className="btn-primary" onClick={submit} disabled={submitting}>
          {submitting ? "…" : "Save"}
        </button>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MockupRendering — corpo del viewer condizionale per `type`. Per gli item
// "nuovi" (entità Mockup, hanno `id`) il contenuto/ref_url sono già nel payload
// di list/get: nessuna fetch aggiuntiva del md. Per gli item legacy (niente
// `id`, sempre type=html) si estrae ancora il blocco dal `md` dell'owner.
// ---------------------------------------------------------------------------
function MockupRendering({ item, onBack, onClose }) {
  const entity = isEntityItem(item);
  const type = itemType(item);

  return (
    <div className="rendered">
      <div className="rendered-head">
        <div className="rendered-title">
          {onBack ? (
            <button className="back-link" onClick={onBack}>
              <ArrowLeft size={13} /> Back to mockups
            </button>
          ) : (
            <span className="badge" style={{ background: "var(--c-prog)", color: "#1a1300" }}>
              {originLabel(itemOwnerType(item))}
            </span>
          )}
          <span className={`type-badge type-${type}`}>{TYPE_LABEL[type] || type}</span>
        </div>
        <button className="close-x" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {onBack && (
        <div className="sub-note" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          from {originLabel(itemOwnerType(item)).toLowerCase()} &quot;{itemTitle(item)}&quot;
        </div>
      )}

      {entity ? (
        <MockupBody item={item} />
      ) : (
        <LegacyHtmlBody item={item} />
      )}

      <CommentsPanel item={item} />
    </div>
  );
}

// Corpo per item "nuovi" (entità Mockup): dispatch su `type`.
function MockupBody({ item }) {
  if (item.type === "html") {
    return (
      <iframe
        title={`mockup-${item.id}`}
        sandbox=""
        srcDoc={item.content || ""}
        style={{
          width: "100%",
          minHeight: 360,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "#fff",
        }}
      />
    );
  }
  if (item.type === "image") {
    return <ImageViewer src={item.content} title={item.title} />;
  }
  // figma | claude_canvas | link → placeholder con link esterno.
  return <ExternalPlaceholder item={item} />;
}

// Item legacy (derivato dal md): unico type possibile è html, va estratto dal
// blocco ```mockup``` dell'owner.
function LegacyHtmlBody({ item }) {
  const [md, setMd] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setMd(null);
    setError(null);
    const fetcher = item.target_type === "story" ? api.stories.get : api.tasks.get;
    fetcher(item.target_id)
      .then((obj) => !cancelled && setMd(obj.md || ""))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [item.target_type, item.target_id]);

  const block = md != null ? extractMockupBlock(md, item.mockup_index) : null;

  return (
    <>
      {error && <div className="empty-state">Errore nel caricamento del mockup: {error}</div>}
      {!error && md === null && <div className="empty-state">Caricamento…</div>}
      {!error && md !== null && block === null && (
        <div className="empty-state">Mockup non trovato (indice {item.mockup_index}).</div>
      )}
      {!error && block !== null && (
        <iframe
          title={`mockup-${item.target_type}-${item.target_id}-${item.mockup_index}`}
          sandbox=""
          srcDoc={block}
          style={{
            width: "100%",
            minHeight: 360,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "#fff",
          }}
        />
      )}
    </>
  );
}

// Estrae l'n-esimo blocco ```mockup``` dalla md (coerente con MOCKUP_BLOCK_RE/splitMockups).
function extractMockupBlock(md, index) {
  const re = /```mockup\s*([\s\S]*?)```/g;
  let i = 0;
  let m;
  while ((m = re.exec(md))) {
    if (i === index) return m[1];
    i++;
  }
  return null;
}

// Image viewer con toolbar zoom/download (D2: content è una data URI base64).
function ImageViewer({ src, title }) {
  const [zoom, setZoom] = useState(1);
  if (!src) {
    return <div className="empty-state">Nessuna immagine associata a questo mockup.</div>;
  }
  return (
    <>
      <div className="img-toolbar">
        <button className="icon-btn-sm" title="Zoom in" onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}>
          <ZoomIn size={12} />
        </button>
        <button className="icon-btn-sm" title="Zoom out" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}>
          <ZoomOut size={12} />
        </button>
        <a className="icon-btn-sm" title="Download" href={src} download={`${title || "mockup"}.png`}>
          <Download size={12} />
        </a>
      </div>
      <div className="image-viewer-frame">
        <img src={src} alt={title || "mockup"} style={{ transform: `scale(${zoom})` }} />
      </div>
    </>
  );
}

// Placeholder per provider esterni (figma/claude_canvas/link): icona + nome +
// hint + pulsante che apre ref_url in una nuova tab. Nessun iframe esterno reale.
function ExternalPlaceholder({ item }) {
  const cfg = {
    figma: { glyph: "◆", openLabel: "Open in Figma" },
    claude_canvas: { glyph: "✦", openLabel: "Open in Claude" },
    link: { glyph: "🔗", openLabel: "Open link" },
  }[item.type] || { glyph: "?", openLabel: "Open" };

  return (
    <div className="placeholder-embed">
      <div className="glyph">{cfg.glyph}</div>
      <div className="name">{item.title}</div>
      <div className="hint">
        Live embed not yet wired up — integration arrives in a future story. For now this links out
        to the source {item.type === "link" ? "page" : "file"}.
      </div>
      {item.ref_url ? (
        <a className="open-ext-btn" href={item.ref_url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} /> {cfg.openLabel}
        </a>
      ) : (
        <div className="empty-state">Nessun link esterno configurato.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommentsPanel — pannello commenti. Composer sempre abilitato (eccezione a
// VITE_READONLY: la richiesta di modifiche è lo scopo della storia, vedi md
// del task td40b5cb6). Usa `mockup_id` (FK) per gli item entità; retrocompat
// su target_type/target_id/mockup_index per gli item legacy non backfillati.
// ---------------------------------------------------------------------------
function CommentsPanel({ item }) {
  const entity = isEntityItem(item);
  const listParams = entity
    ? { mockup_id: item.id }
    : { target_type: item.target_type, target_id: item.target_id, mockup_index: item.mockup_index };
  const createExtra = entity
    ? { mockup_id: item.id }
    : { target_type: item.target_type, target_id: item.target_id, mockup_index: item.mockup_index };

  const [comments, setComments] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState(null); // data URL
  const [imageName, setImageName] = useState("");
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setError(null);
    api.mockupComments
      .list(listParams)
      .then(setComments)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    setComments(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listParams.mockup_id, listParams.target_type, listParams.target_id, listParams.mockup_index]);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setSubmitError(null);
    if (!text.trim() && !image) {
      setSubmitError("Specifica almeno un testo o un'immagine.");
      return;
    }
    setSubmitting(true);
    try {
      await api.mockupComments.create({
        ...createExtra,
        author: "user",
        text: text.trim(),
        image: image || null,
      });
      setText("");
      setImage(null);
      setImageName("");
      load();
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="comments-panel">
      <div className="comments-title">
        <MessageSquare size={14} /> Comments
        <span className="comment-count">{comments ? comments.length : 0}</span>
      </div>

      <div className="composer">
        <textarea
          placeholder="Describe what to change (component, style)…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="composer-row">
          <label className="attach-btn">
            <Paperclip size={13} /> {imageName || "Attach image"}
            <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
          </label>
          <button className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "…" : "Comment"}
          </button>
        </div>
        {submitError && <div className="comment-error">{submitError}</div>}
      </div>

      {error && <div className="empty-comments">Errore nel caricamento dei commenti: {error}</div>}
      {!error && comments === null && <div className="empty-comments">Caricamento…</div>}
      {!error && comments && comments.length === 0 && (
        <div className="empty-comments">No comments yet. Be the first to request a change.</div>
      )}
      {!error && comments && comments.length > 0 && (
        <div className="comment-list">
          {comments.map((c) => (
            <div className="comment" key={c.id}>
              <div className="comment-avatar">{(c.author || "?").slice(0, 2).toUpperCase()}</div>
              <div className="comment-body">
                <div className="comment-head">
                  <span className="comment-author">{c.author}</span>
                  <span className="comment-time">
                    {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
                  </span>
                </div>
                {c.text && <div className="comment-text">{c.text}</div>}
                {c.image && <img className="comment-image" src={c.image} alt="attachment" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Pulsante "view mockup" condizionale, da riusare in Agenda.jsx (epic/story) e
// Task.jsx (task). Non renderizza nulla se count <= 0 (D3: nessun pulsante morto).
export function MockupButton({ count, onClick, compact = false }) {
  if (!count || count <= 0) return null;
  if (compact) {
    return (
      <button className="icon-btn mockup-on" title="View mockup" onClick={onClick}>
        <Eye size={13} />
      </button>
    );
  }
  return (
    <button className="mockup-btn" onClick={onClick}>
      <Eye size={14} /> View mockup
    </button>
  );
}
