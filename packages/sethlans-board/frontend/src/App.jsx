import { useState, useEffect, useCallback, useRef } from "react";
import { BookOpen, ChevronLeft, Icon, RefreshCw, Wifi, WifiOff , Hammer, Palette, Download, UploadCloud, LayoutGrid} from "lucide-react";
import Agenda from "./components/Agenda.jsx";
import StoryPage from "./components/StoryPage.jsx";
import ProjectSwitcher from "./components/ProjectSwitcher.jsx";
import KnowledgePanel from "./components/KnowledgePanel.jsx";
import CardsPanel from "./components/CardsPanel.jsx";
import DesignSystemPage from "./components/DesignSystemPage.jsx";
import ImportWizard from "./components/ImportWizard.jsx";
import * as api from "./api.js";

const EMPTY = { projects: [], epics: [], stories: [], tasks: [], agents: [], knowledge: [] };
const POLL_MS = 4000;
const PROJECT_KEY = "board-project-id";

export default function App() {
  const [page, setPage] = useState("agenda"); // 'agenda' | 'story' | 'knowledge' | 'cards' | 'design-system'
  const [state, setState] = useState(EMPTY);
  const [selectedProject, setSelectedProject] = useState(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) || null;
    } catch {
      return null;
    }
  });
  const [selectedEpic, setSelectedEpic] = useState(null);
  const [selectedStory, setSelectedStory] = useState(null);
  const [drag, setDrag] = useState(null);
  const [online, setOnline] = useState(null); // null=unknown, true/false
  const [apiUrl, setApiUrl] = useState(api.getBaseUrl());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const dragging = useRef(false);

  // Loads the full snapshot
  const reload = useCallback(async () => {
    try {
      const s = await api.getState();
      setState(s);
      setOnline(true);
      const projects = s.projects || [];
      // ensures a valid selected project (default: the first one)
      setSelectedProject((cur) =>
        cur && projects.some((p) => p.id === cur)
          ? cur
          : projects[0]?.id || null
      );
    } catch (err) {
      console.error("reload failed:", err);
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload, apiUrl]);

  // Persists the selected project
  useEffect(() => {
    try {
      if (selectedProject) localStorage.setItem(PROJECT_KEY, selectedProject);
    } catch {}
  }, [selectedProject]);

  // Keeps the selected epic valid with respect to the active project
  useEffect(() => {
    const epics = state.epics.filter((e) => e.project_id === selectedProject);
    setSelectedEpic((cur) =>
      cur && epics.some((e) => e.id === cur) ? cur : epics[0]?.id || null
    );
  }, [selectedProject, state.epics]);

  // Polling: refreshes automatically (paused during a drag to avoid disruption)
  useEffect(() => {
    const id = setInterval(() => {
      if (!dragging.current) reload();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  // tracks the drag state to pause polling
  useEffect(() => {
    dragging.current = drag !== null;
  }, [drag]);

  const openStory = (sid) => {
    setSelectedStory(sid);
    setPage("story");
  };

  const applyApiUrl = () => {
    api.setBaseUrl(apiUrl);
    setApiUrl(api.getBaseUrl());
    reload();
  };

  // Export dati progetto (story s09f34f1a): un click -> download del JSON
  // versionato del progetto attualmente selezionato.
  const exportSelectedProject = async () => {
    if (!selectedProject) return;
    setExportError(null);
    setExporting(true);
    try {
      const envelope = await api.projectData.exportProject(selectedProject);
      const projectName = state.projects.find((p) => p.id === selectedProject)?.name || "project";
      const slug = projectName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sethlans-export-${slug}-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <Hammer />
          <div>
            <div className="title">Sethlans Board</div>
            <div className="sub">Agent &amp; work dashboard</div>
          </div>
          <ProjectSwitcher
            projects={state.projects || []}
            selectedProject={selectedProject}
            onSelect={setSelectedProject}
            reload={reload}
          />
        </div>

        <div className="header-right">
          <div className="api-field" title="Backend URL">
            {online === false ? (
              <WifiOff size={14} color="var(--c-todo)" />
            ) : (
              <Wifi size={14} color="var(--c-done)" />
            )}
            <input
              className="api-input"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyApiUrl()}
              onBlur={applyApiUrl}
              spellCheck={false}
            />
          </div>

          {page !== "agenda" && (
            <button className="back-btn" onClick={() => setPage("agenda")}>
              <ChevronLeft size={16} /> Agenda
            </button>
          )}
          {page !== "knowledge" && (
            <button
              className="back-btn"
              onClick={() => setPage("knowledge")}
              title="Project profile & knowledge cards"
            >
              <BookOpen size={15} /> Knowledge
            </button>
          )}
          {page !== "cards" && (
            <button
              className="back-btn"
              onClick={() => setPage("cards")}
              title="Per-role knowledge cards (kb/learnings/standards)"
            >
              <LayoutGrid size={15} /> Cards
            </button>
          )}
          {page !== "design-system" && (
            <button
              className="back-btn"
              onClick={() => setPage("design-system")}
              title="Project design system (tokens & components)"
            >
              <Palette size={15} /> Design System
            </button>
          )}
          <button
            className="header-icon-btn"
            onClick={exportSelectedProject}
            disabled={!selectedProject || exporting}
            title="Export current project data (profile + knowledge + design system) as JSON"
          >
            <Download size={15} />
          </button>
          <button
            className="header-icon-btn"
            onClick={() => setShowImport(true)}
            title="Import project data from a JSON export"
          >
            <UploadCloud size={15} />
          </button>
          <button className="reset-btn" onClick={reload} title="Refresh now">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      <main className="main">
        {online === false && (
          <div className="offline-banner">
            Backend unreachable at <code>{apiUrl}</code>. Check that the
            server is running and the URL is correct.
          </div>
        )}
        {exportError && (
          <div className="offline-banner">
            Export failed: {exportError}
          </div>
        )}

        {page === "agenda" && (
          <Agenda
            state={state}
            reload={reload}
            selectedProject={selectedProject}
            selectedEpic={selectedEpic}
            setSelectedEpic={setSelectedEpic}
            openStory={openStory}
            drag={drag}
            setDrag={setDrag}
          />
        )}
        {page === "story" && (
          <StoryPage
            state={state}
            reload={reload}
            storyId={selectedStory}
            drag={drag}
            setDrag={setDrag}
          />
        )}
        {page === "knowledge" && (
          <KnowledgePanel state={state} selectedProject={selectedProject} />
        )}
        {page === "cards" && (
          <CardsPanel state={state} selectedProject={selectedProject} />
        )}
        {page === "design-system" && (
          <DesignSystemPage state={state} selectedProject={selectedProject} />
        )}
      </main>

      {showImport && (
        <ImportWizard
          projects={state.projects || []}
          onClose={() => setShowImport(false)}
          onImported={reload}
        />
      )}
    </div>
  );
}
