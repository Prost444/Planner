import { useState } from "react";
import { Box, ChevronDown, Loader2, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { useStore } from "../store";

export default function TopBar() {
  const projects = useStore((s) => s.projects);
  const project = useStore((s) => s.project);
  const openProject = useStore((s) => s.openProject);
  const createProject = useStore((s) => s.createProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const history = useStore((s) => s.history.length);
  const future = useStore((s) => s.future.length);
  const saving = useStore((s) => s.saving);
  const dirty = useStore((s) => s.dirty);
  const agentBusy = useStore((s) => s.agentBusy);
  const serverInfo = useStore((s) => s.serverInfo);
  const [menu, setMenu] = useState(false);

  return (
    <div className="topbar">
      <div className="brand">
        <Box size={18} /> Planner AI
      </div>
      <div className="project-menu">
        <button className="dropdown" onClick={() => setMenu((m) => !m)}>
          {project?.name ?? "Проект"} <ChevronDown size={14} />
        </button>
        {menu && (
          <div className="popover" onMouseLeave={() => setMenu(false)}>
            {projects.map((p) => (
              <div key={p.id} className={`menu-row ${p.id === project?.id ? "active" : ""}`}>
                <button
                  className="menu"
                  onClick={() => {
                    void openProject(p.id);
                    setMenu(false);
                  }}
                >
                  {p.name}
                </button>
                <button className="icon danger" title="Удалить проект" onClick={() => window.confirm(`Удалить проект «${p.name}»?`) && deleteProject(p.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <hr />
            <button
              className="menu"
              onClick={() => {
                const name = window.prompt("Название проекта", "Новая комната");
                if (name !== null) void createProject("empty", name || undefined);
                setMenu(false);
              }}
            >
              <Plus size={12} /> Пустой проект
            </button>
            <button
              className="menu"
              onClick={() => {
                void createProject("hallway");
                setMenu(false);
              }}
            >
              <Plus size={12} /> Из шаблона «Прихожая»
            </button>
          </div>
        )}
      </div>
      <div className="seg">
        <button className={view === "2d" ? "active" : ""} onClick={() => setView("2d")}>
          2D план
        </button>
        <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>
          3D
        </button>
      </div>
      <button className="icon" title="Отменить (Ctrl+Z)" onClick={undo} disabled={!history}>
        <Undo2 size={16} />
      </button>
      <button className="icon" title="Повторить (Ctrl+Y)" onClick={redo} disabled={!future}>
        <Redo2 size={16} />
      </button>
      <span className="spacer" />
      {agentBusy && (
        <span className="pill busy">
          <Loader2 size={12} className="spin" /> агент работает — редактор заблокирован
        </span>
      )}
      <span className="muted small">{saving ? "сохраняю…" : dirty ? "не сохранено" : "сохранено"}</span>
      {serverInfo && (
        <span className="muted small" title="Настройки сервера">
          · {serverInfo.anthropicKeyPresent ? "Claude ✓" : "Claude: нет ключа"} · рендер: {serverInfo.imageProvider}
        </span>
      )}
    </div>
  );
}
