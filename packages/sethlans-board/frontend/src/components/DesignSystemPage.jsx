import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, AlertTriangle, Palette } from "lucide-react";
import * as api from "../api.js";

// ---------------------------------------------------------------------------
// DesignSystemPage — pagina a livello di project (1:1, story s2340fc3b),
// distinta dai Mockup di story/task. Consuma `GET /design-systems?project_id=`
// (presenza/detail) e replica 1:1 il mockup approvato nel md della story:
// header (source/sync badge, timestamp, CTA Open in Penpot, Re-scan),
// sezioni Tokens (Colors/Typography/Spacing & Radius) e Components Inventory.
// Riusa le classi esistenti (.badge, .mockup-grid/.mockup-card, .open-ext-btn,
// .empty-state, .btn-primary/.btn-ghost) — solo il layout di pagina è nuovo
// (vedi blocco "Design System page" in styles.css).
//
// Read-only: VITE_READONLY=true di default — Re-scan e Open-in-Penpot sono
// CTA informative, nessuna scrittura dalla UI (coerente col resto della Board).
// ---------------------------------------------------------------------------

const SOURCE_LABEL = { code_scan: "CODE_SCAN", manual: "MANUAL" };
const SYNC_LABEL = { local: "LOCAL", synced: "SYNCED", sync_failed: "SYNC FAILED" };

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function safeParse(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function DesignSystemPage({ state, selectedProject }) {
  const project = (state.projects || []).find((p) => p.id === selectedProject);
  const [ds, setDs] = useState(null); // undefined-like: null = loading
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    setError(null);
    setLoaded(false);
    if (!selectedProject) {
      setDs(null);
      setLoaded(true);
      return;
    }
    api.designSystems
      .list({ project_id: selectedProject })
      .then((list) => {
        setDs((list && list[0]) || null);
        setLoaded(true);
      })
      .catch((e) => {
        setError(e.message);
        setLoaded(true);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  if (!project) {
    return <div className="empty">No project selected.</div>;
  }

  return (
    <div className="ds-page">
      {error && (
        <div className="empty-state">Errore nel caricamento del design system: {error}</div>
      )}
      {!error && !loaded && <div className="empty-state">Caricamento…</div>}
      {!error && loaded && !ds && <EmptyState />}
      {!error && loaded && ds && <Populated ds={ds} project={project} onReload={load} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="ds-panel">
      <div className="ds-header">
        <div className="ds-header-left">
          <div className="ds-title-row">
            <span className="ds-title">Design System</span>
          </div>
        </div>
      </div>
      <div className="empty-state">
        <Palette size={28} />
        <span className="lead" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
          No design system generated yet
        </span>
        <span>
          This project has no <code>DesignSystem</code> artifact. Run <code>/sethlans-design</code> to
          scan the codebase and infer tokens (colors, typography, spacing, radius) and the component
          inventory. Penpot sync is optional and only runs if configured.
        </span>
      </div>
    </div>
  );
}

function Populated({ ds, project, onReload }) {
  const tokens = safeParse(ds.tokens) || {};
  const components = safeParse(ds.components) || [];
  const colors = tokens.colors || [];
  const typography = tokens.typography || [];
  const spacing = tokens.spacing || [];
  const radius = tokens.radius || [];
  const showOpenInPenpot = ds.ext_provider === "penpot" && !!ds.ext_url;
  const syncState = ds.sync_state || "local";

  return (
    <div className="ds-panel">
      <div className="ds-header">
        <div className="ds-header-left">
          <div className="ds-title-row">
            <span className="ds-title">{project.name} — Design System</span>
            <span className="badge source-badge">{SOURCE_LABEL[ds.source] || ds.source}</span>
            <span className={`badge sync-badge sync-${syncState}`}>
              {syncState === "sync_failed" && <AlertTriangle size={11} />}
              {SYNC_LABEL[syncState] || syncState}
            </span>
          </div>
          <div className="ds-meta-row">
            <span>Last scan: {fmtDate(ds.last_scan_at)}</span>
            <span>Last sync (Penpot): {fmtDate(ds.last_sync_at)}</span>
          </div>
        </div>
        <div className="ds-header-right">
          {showOpenInPenpot && (
            <a className="open-ext-btn" href={ds.ext_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} /> Open in Penpot
            </a>
          )}
          <button
            className="btn-primary"
            title="Rigenera il design system: esegui la skill /sethlans-design dal CLI Claude Code"
            onClick={() =>
              window.alert(
                'Per rigenerare il design system esegui la skill "/sethlans-design" da Claude Code su questo progetto. Non è ancora disponibile un trigger dalla UI (la Board è read-only).'
              )
            }
          >
            <RefreshCw size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
            Re-scan
          </button>
        </div>
      </div>

      {syncState === "sync_failed" && (
        <div className="empty-state ds-warning">
          <span className="lead" style={{ color: "var(--text)" }}>
            Push to Penpot failed on the last run.
          </span>
          <span>
            The Board artifact below is up to date with the codebase (source of truth). Re-run{" "}
            <code>/sethlans-design</code> to retry the Penpot push, or check{" "}
            <code>SETHLANS_DESIGN_PENPOT_URL</code> / <code>SETHLANS_DESIGN_PENPOT_TOKEN</code>.
          </span>
        </div>
      )}

      {colors.length > 0 && (
        <>
          <div className="section-title">Tokens — Colors</div>
          <div className="token-grid">
            {colors.map((c) => (
              <div className="swatch-card" key={c.name}>
                <div className="swatch-color" style={{ background: c.hex }} />
                <div className="swatch-info">
                  <div className="swatch-name">{c.name}</div>
                  <div className="swatch-hex">{c.hex}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {typography.length > 0 && (
        <>
          <div className="section-title">Tokens — Typography</div>
          <div className="type-scale">
            {typography.map((t, i) => (
              <div className="type-row" key={i}>
                <span className="type-label">{t.label}</span>
                <span
                  className="type-sample"
                  style={{
                    fontSize: t.size,
                    fontWeight: t.weight,
                    textTransform: t.uppercase ? "uppercase" : "none",
                    letterSpacing: t.uppercase ? 0.5 : "normal",
                    color: t.uppercase ? "var(--muted)" : "inherit",
                  }}
                >
                  {t.label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {(spacing.length > 0 || radius.length > 0) && (
        <>
          <div className="section-title">Tokens — Spacing &amp; Radius</div>
          <div className="dim-grid">
            {spacing.length > 0 && (
              <div className="dim-group">
                <div className="dim-group-label">Spacing</div>
                {spacing.map((px) => (
                  <div className="dim-row" key={`sp-${px}`}>
                    <div className="dim-box" style={{ width: px, height: 16 }} />
                    <span className="dim-box-label">{px}px</span>
                  </div>
                ))}
              </div>
            )}
            {radius.length > 0 && (
              <div className="dim-group">
                <div className="dim-group-label">Radius</div>
                {radius.map((px) => (
                  <div className="dim-row" key={`rd-${px}`}>
                    <div className="dim-box" style={{ width: 32, height: 24, borderRadius: px }} />
                    <span className="dim-box-label">{px}px</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="section-title">Components — Inventory</div>
      {components.length === 0 ? (
        <div className="empty-state">Nessun componente nell'inventario.</div>
      ) : (
        <div className="mockup-grid">
          {components.map((c) => (
            <div className="mockup-card" key={c.name} style={{ cursor: "default" }}>
              <div className="mockup-thumb">
                <div
                  className="ds-component-preview"
                  // Markup di esempio fidato (generato dalla skill /sethlans-design dal
                  // codice del progetto stesso) — non input utente.
                  dangerouslySetInnerHTML={{ __html: c.example || "" }}
                />
              </div>
              <div className="mockup-name">{c.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
