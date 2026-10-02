import { useEffect } from "react";
import { Image, ListChecks, MessageSquare, Palette, ShoppingBag, SlidersHorizontal } from "lucide-react";
import Editor2D from "./editor2d/Editor2D";
import Viewer3D from "./viewer3d/Viewer3D";
import ChatPanel from "./panels/ChatPanel";
import CatalogPanel from "./panels/CatalogPanel";
import BriefPanel from "./panels/BriefPanel";
import RendersPanel from "./panels/RendersPanel";
import ReferencesPanel from "./panels/ReferencesPanel";
import Inspector from "./panels/Inspector";
import TopBar from "./components/TopBar";
import Toolbar from "./components/Toolbar";
import { useStore, type RightTab } from "./store";

const TABS: Array<{ id: RightTab; label: string; icon: React.ReactNode }> = [
  { id: "chat", label: "Чат", icon: <MessageSquare size={15} /> },
  { id: "catalog", label: "Каталог", icon: <ShoppingBag size={15} /> },
  { id: "brief", label: "Бриф", icon: <ListChecks size={15} /> },
  { id: "refs", label: "Референсы", icon: <Palette size={15} /> },
  { id: "renders", label: "Рендеры", icon: <Image size={15} /> },
  { id: "inspector", label: "Свойства", icon: <SlidersHorizontal size={15} /> },
];

export default function App() {
  const init = useStore((s) => s.init);
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const catalogCount = useStore((s) => s.project?.catalog.length ?? 0);
  const rendersCount = useStore((s) => s.project?.renders.length ?? 0);

  useEffect(() => {
    void init();
    const before = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) {
        e.preventDefault();
        void useStore.getState().flushSave();
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [init]);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <Toolbar />
        <div className="stage">
          {project ? (
            <>
              {view === "2d" && <Editor2D />}
              <Viewer3D visible={view === "3d"} />
            </>
          ) : (
            <div className="editor-empty">Загрузка проекта…</div>
          )}
        </div>
        <div className="right">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={rightTab === t.id ? "active" : ""} onClick={() => setRightTab(t.id)} title={t.label}>
                {t.icon}
                <span>{t.label}</span>
                {t.id === "catalog" && catalogCount > 0 && <em>{catalogCount}</em>}
                {t.id === "renders" && rendersCount > 0 && <em>{rendersCount}</em>}
              </button>
            ))}
          </div>
          <div className="panel">
            {rightTab === "chat" && <ChatPanel />}
            {rightTab === "catalog" && <CatalogPanel />}
            {rightTab === "brief" && <BriefPanel />}
            {rightTab === "refs" && <ReferencesPanel />}
            {rightTab === "renders" && <RendersPanel />}
            {rightTab === "inspector" && <Inspector />}
          </div>
        </div>
      </div>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
