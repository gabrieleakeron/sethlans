import { useState } from "react";
import { UploadCloud, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import * as api from "../api.js";

// ---------------------------------------------------------------------------
// ImportWizard — overlay wizard a 4 step per l'import dati progetto (story
// s09f34f1a). Riusa il pattern .mockup-overlay-backdrop/.preview-overlay di
// MockupViewer.jsx e le classi del mockup approvato mkff9f807c (.wizard-steps,
// .dropzone, .radio-row, .summary-tile, .warn-box).
//
// Step 1 File (upload/drag .json) → 2 Target (nuovo | esistente) →
// 3 Mode (merge/replace) → 4 Preview & confirm (chiama /projects/import/preview,
// poi conferma → /projects/import) → success state → onDone(reload).
//
// Props:
//   projects: lista progetti (state.projects) per la select del target esistente.
//   onClose: chiusura senza applicare nulla.
//   onImported: callback dopo un import applicato con successo (reload()).
// ---------------------------------------------------------------------------

const STEPS = ["1 · File", "2 · Target", "3 · Mode", "4 · Preview & confirm"];

export default function ImportWizard({ projects, onClose, onImported }) {
  const [step, setStep] = useState(0); // 0..3
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [data, setData] = useState(null); // parsed JSON envelope

  const [targetMode, setTargetMode] = useState("new"); // 'new' | 'existing'
  const [targetProjectId, setTargetProjectId] = useState(projects[0]?.id || "");

  const [mode, setMode] = useState("merge"); // 'merge' | 'replace'

  const [preview, setPreview] = useState(null); // ImportPreviewOut
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const [result, setResult] = useState(null); // ImportResultOut

  const effectiveTargetProjectId = targetMode === "new" ? null : targetProjectId || null;

  const readFile = (file) => {
    if (!file) return;
    setFileError(null);
    if (!file.name.toLowerCase().endsWith(".json")) {
      setFileError(`File "${file.name}" non è un .json.`);
      setFileName(file.name);
      setData(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        setData(parsed);
        setFileName(file.name);
        setFileError(null);
      } catch {
        setFileError(`File "${file.name}" non contiene un JSON valido.`);
        setFileName(file.name);
        setData(null);
      }
    };
    reader.onerror = () => setFileError("Impossibile leggere il file.");
    reader.readAsText(file);
  };

  const onFileInput = (e) => readFile(e.target.files?.[0]);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    readFile(e.dataTransfer.files?.[0]);
  };

  const goToPreviewStep = async () => {
    setStep(3);
    setPreviewLoading(true);
    setPreviewError(null);
    setConfirmChecked(false);
    try {
      const res = await api.projectData.importPreview(data, effectiveTargetProjectId, mode);
      setPreview(res);
    } catch (e) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmImport = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const res = await api.projectData.importApply(data, effectiveTargetProjectId, mode);
      setResult(res);
    } catch (e) {
      setApplyError(e.message);
    } finally {
      setApplying(false);
    }
  };

  const done = () => {
    onImported();
    onClose();
  };

  const targetProjectName = projects.find((p) => p.id === targetProjectId)?.name || "";
  const isDestructive = targetMode === "existing" && mode === "replace";
  const needsConfirmCheckbox = isDestructive;
  const canConfirm = preview?.valid && (!needsConfirmCheckbox || confirmChecked);

  return (
    <div className="mockup-overlay-backdrop" onClick={onClose}>
      <div className="mockup-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="preview-overlay">
          <div className="preview-head">
            <div className="preview-title">
              <UploadCloud size={15} />
              Import project data
            </div>
            <button className="close-x" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          {!result && (
            <div className="wizard-steps">
              {STEPS.map((label, i) => (
                <div key={label} className={`wizard-step${i < step ? " done" : i === step ? " active" : ""}`}>
                  {label}
                </div>
              ))}
            </div>
          )}

          {result ? (
            <SuccessStep
              result={result}
              projectName={
                targetMode === "new"
                  ? data?.project?.name || result.target_project_id
                  : projects.find((p) => p.id === result.target_project_id)?.name || result.target_project_id
              }
              onDone={done}
            />
          ) : step === 0 ? (
            <StepFile
              fileName={fileName}
              fileError={fileError}
              dragOver={dragOver}
              setDragOver={setDragOver}
              onFileInput={onFileInput}
              onDrop={onDrop}
              onCancel={onClose}
              onNext={() => setStep(1)}
              canNext={!!data && !fileError}
            />
          ) : step === 1 ? (
            <StepTarget
              fileName={fileName}
              projects={projects}
              targetMode={targetMode}
              setTargetMode={setTargetMode}
              targetProjectId={targetProjectId}
              setTargetProjectId={setTargetProjectId}
              onBack={() => setStep(0)}
              onNext={() => setStep(2)}
              canNext={targetMode === "new" || !!targetProjectId}
            />
          ) : step === 2 ? (
            <StepMode
              targetMode={targetMode}
              targetProjectName={targetProjectName}
              mode={mode}
              setMode={setMode}
              onBack={() => setStep(1)}
              onNext={goToPreviewStep}
            />
          ) : (
            <StepPreview
              preview={preview}
              loading={previewLoading}
              error={previewError}
              targetMode={targetMode}
              targetProjectName={targetProjectName}
              mode={mode}
              isDestructive={isDestructive}
              confirmChecked={confirmChecked}
              setConfirmChecked={setConfirmChecked}
              applying={applying}
              applyError={applyError}
              canConfirm={canConfirm}
              onBack={() => setStep(2)}
              onConfirm={confirmImport}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Upload file
// ---------------------------------------------------------------------------
function StepFile({ fileName, fileError, dragOver, setDragOver, onFileInput, onDrop, onCancel, onNext, canNext }) {
  return (
    <>
      <div
        className={`dropzone${dragOver ? " drag-over" : ""}${fileError ? " has-error" : ""}${
          fileName && !fileError ? " has-file" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <UploadCloud size={26} />
        {fileName ? (
          <>
            <span className="fname">{fileName}</span>
            {fileError && <span>{fileError}</span>}
            <label className="btn-ghost" style={{ cursor: "pointer" }}>
              {fileError ? "Choose a different file" : "Change file"}
              <input type="file" accept=".json,application/json" onChange={onFileInput} style={{ display: "none" }} />
            </label>
          </>
        ) : (
          <>
            Drag a <code>.json</code> export file here, or
            <label className="btn-ghost" style={{ cursor: "pointer" }}>
              Browse files…
              <input type="file" accept=".json,application/json" onChange={onFileInput} style={{ display: "none" }} />
            </label>
          </>
        )}
      </div>
      <div className="form-row" style={{ marginTop: 14 }}>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" onClick={onNext} disabled={!canNext}>
          Next →
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Target project
// ---------------------------------------------------------------------------
function StepTarget({ fileName, projects, targetMode, setTargetMode, targetProjectId, setTargetProjectId, onBack, onNext, canNext }) {
  return (
    <>
      <div className="dropzone has-file" style={{ padding: 14, marginBottom: 14 }}>
        <span className="fname">{fileName}</span>
      </div>

      <div className="section-title">Target project</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className={`radio-row${targetMode === "new" ? " selected" : ""}`}>
          <input type="radio" checked={targetMode === "new"} onChange={() => setTargetMode("new")} />
          <div>
            <div className="rt">Create a new project</div>
            <div className="rd">Imports into a brand-new project named from the export.</div>
          </div>
        </label>
        <label className={`radio-row${targetMode === "existing" ? " selected" : ""}`}>
          <input type="radio" checked={targetMode === "existing"} onChange={() => setTargetMode("existing")} />
          <div style={{ flex: 1 }}>
            <div className="rt">Existing project</div>
            <div className="rd">Choose a project already on this board.</div>
            {targetMode === "existing" && (
              <select
                className="input"
                style={{ marginTop: 8 }}
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </label>
      </div>

      <div className="form-row" style={{ marginTop: 14 }}>
        <button className="btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <button className="btn-primary" onClick={onNext} disabled={!canNext}>
          Next →
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Mode (merge vs replace) — solo per target esistente
// ---------------------------------------------------------------------------
function StepMode({ targetMode, targetProjectName, mode, setMode, onBack, onNext }) {
  return (
    <>
      <div className="section-title">
        Target: <span style={{ color: "var(--text)" }}>{targetMode === "new" ? "New project" : targetProjectName}</span>
      </div>

      {targetMode === "new" ? (
        <div className="empty-state">A new project will be created — merge/replace does not apply.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label className={`radio-row${mode === "merge" ? " selected" : ""}`}>
            <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} />
            <div>
              <div className="rt">
                Merge <span className="badge" style={{ background: "var(--c-done)", marginLeft: 6 }}>Recommended</span>
              </div>
              <div className="rd">
                Knowledge cards are matched by role + kind + title and updated; new cards are added. Profile is
                overwritten only if currently empty. Nothing is deleted.
              </div>
            </div>
          </label>
          <label className={`radio-row${mode === "replace" ? " selected danger" : ""}`}>
            <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
            <div>
              <div className="rt" style={{ color: "var(--c-err)" }}>
                Replace
              </div>
              <div className="rd">
                Deletes ALL knowledge cards and the design system currently on the target project, then re-imports
                from the file. The project profile is overwritten. Destructive — cannot be undone.
              </div>
            </div>
          </label>
        </div>
      )}

      <div className="form-row" style={{ marginTop: 14 }}>
        <button className="btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <button className="btn-primary" onClick={onNext}>
          Next →
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Preview & confirm
// ---------------------------------------------------------------------------
function StepPreview({
  preview, loading, error, targetMode, targetProjectName, mode, isDestructive,
  confirmChecked, setConfirmChecked, applying, applyError, canConfirm, onBack, onConfirm,
}) {
  if (loading) {
    return <div className="empty-state">Computing preview…</div>;
  }
  if (error) {
    return (
      <>
        <div className="warn-box">
          <AlertTriangle size={18} color="var(--c-err)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Preview failed</div>
            <div style={{ color: "var(--muted)" }}>{error}</div>
          </div>
        </div>
        <div className="form-row">
          <button className="btn-ghost" onClick={onBack}>
            ← Back
          </button>
        </div>
      </>
    );
  }
  if (!preview) return null;

  if (!preview.valid) {
    return (
      <>
        <div className="warn-box">
          <AlertTriangle size={18} color="var(--c-err)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
              Not a valid Sethlans export file
            </div>
            <div style={{ color: "var(--muted)" }}>
              {(preview.errors || []).map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="form-row">
          <button className="btn-ghost" onClick={onBack}>
            ← Back
          </button>
        </div>
      </>
    );
  }

  const { counts, plan, warnings } = preview;
  const targetLabel = targetMode === "new" ? "a new project" : targetProjectName;

  return (
    <>
      {isDestructive && (
        <div className="warn-box">
          <AlertTriangle size={18} color="var(--c-err)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
              This will permanently delete existing data on &quot;{targetProjectName}&quot;
            </div>
            <div style={{ color: "var(--muted)" }}>
              All {plan.knowledge_delete} existing knowledge cards and the current design system on this project
              will be removed before importing. This cannot be undone.
            </div>
          </div>
        </div>
      )}

      {warnings && warnings.length > 0 && (
        <div className="warn-box">
          <AlertTriangle size={18} color="var(--c-err)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
              {warnings.length} card{warnings.length > 1 ? "s" : ""} will be skipped
            </div>
            <div style={{ color: "var(--muted)" }}>
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="section-title">Content preview</div>
      <div className="summary-grid">
        <div className="summary-tile">
          <span className="summary-val">{counts.knowledge_valid}</span>
          <span className="summary-label">Knowledge cards</span>
        </div>
        <div className="summary-tile">
          <span className="summary-val">{counts.roles}</span>
          <span className="summary-label">Roles covered</span>
        </div>
        <div className="summary-tile">
          <span className="summary-val" style={{ color: counts.design_system_included ? "var(--c-done)" : "var(--muted)" }}>
            {counts.design_system_included ? "Yes" : "No"}
          </span>
          <span className="summary-label">Design system included</span>
        </div>
        <div className="summary-tile">
          <span className="summary-val">{counts.standards}</span>
          <span className="summary-label">Standards cards</span>
        </div>
      </div>

      <div className="section-title">
        Target: {targetLabel} · Mode: <span style={{ color: "var(--text)" }}>{targetMode === "new" ? "new project" : mode}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
        {plan.knowledge_create} card{plan.knowledge_create === 1 ? "" : "s"} will be{" "}
        <strong style={{ color: "var(--text)" }}>created</strong>
        {plan.knowledge_update > 0 && (
          <>
            , {plan.knowledge_update} matched by role+kind+title will be{" "}
            <strong style={{ color: "var(--text)" }}>updated</strong>
          </>
        )}
        . Project profile will be <strong style={{ color: "var(--text)" }}>{plan.profile_action}</strong>. Design
        system: <strong style={{ color: "var(--text)" }}>{plan.design_system_action}</strong>.
      </div>

      {isDestructive ? (
        <div className="confirm-row">
          <input
            type="checkbox"
            checked={confirmChecked}
            onChange={(e) => setConfirmChecked(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            I understand this will <strong style={{ color: "var(--c-err)" }}>delete existing knowledge and design-system data</strong>{" "}
            on &quot;{targetProjectName}&quot; and cannot be undone.
          </span>
        </div>
      ) : (
        <div className="confirm-row">
          <input
            type="checkbox"
            checked={confirmChecked}
            onChange={(e) => setConfirmChecked(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>I reviewed the content above and want to import it into {targetLabel}.</span>
        </div>
      )}

      {applyError && <div className="comment-error">{applyError}</div>}

      <div className="form-row" style={{ marginTop: 4 }}>
        <button className="btn-ghost" onClick={onBack} disabled={applying}>
          ← Back
        </button>
        <button
          className={`btn-primary${isDestructive ? " danger" : ""}`}
          onClick={onConfirm}
          disabled={!canConfirm || applying}
          title={!canConfirm ? "Check the confirmation box to enable" : undefined}
        >
          {applying ? "…" : isDestructive ? "Replace & import" : "Confirm import"}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Success state
// ---------------------------------------------------------------------------
function SuccessStep({ result, projectName, onDone }) {
  return (
    <div className="success-box">
      <div className="success-icon">
        <CheckCircle2 size={22} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>Import completed on project &quot;{projectName}&quot;</div>
      <div className="summary-grid" style={{ width: "100%", marginTop: 6 }}>
        <div className="summary-tile">
          <span className="summary-val" style={{ color: "var(--c-done)" }}>
            {result.knowledge_created}
          </span>
          <span className="summary-label">Cards created</span>
        </div>
        <div className="summary-tile">
          <span className="summary-val" style={{ color: "var(--c-prog)" }}>
            {result.knowledge_updated}
          </span>
          <span className="summary-label">Cards updated</span>
        </div>
        <div className="summary-tile">
          <span className="summary-val" style={{ color: result.design_system_action !== "none" ? "var(--c-done)" : "var(--muted)" }}>
            {result.design_system_action}
          </span>
          <span className="summary-label">Design system</span>
        </div>
        <div className="summary-tile">
          <span className="summary-val">{result.knowledge_skipped}</span>
          <span className="summary-label">Skipped / warnings</span>
        </div>
      </div>
      <button className="btn-primary" style={{ marginTop: 10, flex: "none", padding: "8px 22px" }} onClick={onDone}>
        Done
      </button>
    </div>
  );
}
