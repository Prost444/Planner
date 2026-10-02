import { useState } from "react";
import { Armchair, Box, DoorOpen, Hand, LayoutGrid, MousePointer2, Ruler, Type } from "lucide-react";
import type { OpeningType } from "@planner/shared";
import { useStore, type EditorMode, type ItemTemplate } from "../store";

const GENERIC_ITEMS: ItemTemplate[] = [
  { name: "Тумба", kind: "storage", w: 80, d: 35, h: 60 },
  { name: "Шкаф", kind: "storage", w: 100, d: 58, h: 240 },
  { name: "Обувница слим", kind: "storage", w: 60, d: 20, h: 100 },
  { name: "Консоль", kind: "table", w: 80, d: 25, h: 80 },
  { name: "Пуф", kind: "seating", w: 35, d: 35, h: 42 },
  { name: "Скамья", kind: "seating", w: 80, d: 35, h: 45 },
  { name: "Вешалка настенная", kind: "hooks", w: 60, d: 8, h: 20, elevation: 160 },
  { name: "Зеркало", kind: "mirror", w: 50, d: 3, h: 140, elevation: 50 },
  { name: "Полка", kind: "shelf", w: 60, d: 25, h: 4, elevation: 180 },
  { name: "Антресоль", kind: "shelf", w: 120, d: 50, h: 50, elevation: 215 },
  { name: "Ковёр", kind: "rug", w: 120, d: 70, h: 1 },
  { name: "Бра", kind: "lighting", w: 15, d: 12, h: 20, elevation: 180 },
  { name: "Растение", kind: "plant", w: 30, d: 30, h: 90 },
  { name: "Произвольный объект", kind: "other", w: 50, d: 50, h: 50 },
];

const OPENING_LABELS: Record<OpeningType, string> = { door: "Дверь", double_door: "Двустворчатая дверь", window: "Окно", passage: "Проход", niche: "Ниша" };

export default function Toolbar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const openingType = useStore((s) => s.openingType);
  const setOpeningType = useStore((s) => s.setOpeningType);
  const setItemTemplate = useStore((s) => s.setItemTemplate);
  const itemTemplate = useStore((s) => s.itemTemplate);
  const wallThickness = useStore((s) => s.wallThickness);
  const setWallThickness = useStore((s) => s.setWallThickness);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const [popover, setPopover] = useState<"items" | "openings" | "walls" | null>(null);

  const tool = (m: EditorMode, icon: React.ReactNode, title: string, onClick?: () => void) => (
    <button
      className={`tool ${mode === m ? "active" : ""}`}
      title={title}
      onClick={() => {
        if (view !== "2d") setView("2d");
        if (onClick) onClick();
        else {
          setMode(m);
          setPopover(null);
        }
      }}
    >
      {icon}
      <span>{title}</span>
    </button>
  );

  return (
    <div className="toolbar">
      {tool("select", <MousePointer2 size={18} />, "Выбор")}
      {tool("wall", <Box size={18} />, "Стена", () => {
        setMode("wall");
        setPopover((p) => (p === "walls" ? null : "walls"));
      })}
      {tool("room", <LayoutGrid size={18} />, "Пол")}
      {tool("opening", <DoorOpen size={18} />, "Проём", () => {
        setMode("opening");
        setPopover((p) => (p === "openings" ? null : "openings"));
      })}
      {tool("item", <Armchair size={18} />, "Мебель", () => setPopover((p) => (p === "items" ? null : "items")))}
      {tool("ruler", <Ruler size={18} />, "Линейка")}
      {tool("label", <Type size={18} />, "Подпись")}
      {tool("pan", <Hand size={18} />, "Рука")}

      {popover === "walls" && (
        <div className="popover">
          <label className="field inline">
            <span>Толщина, см</span>
            <input type="number" value={wallThickness} min={2} max={60} onChange={(e) => setWallThickness(Math.max(2, Number(e.target.value)))} />
          </label>
          <p className="muted small">Клик — точки стены, Enter — завершить. Углы прилипают к 90°, точки — к сетке 5 см и к концам других стен.</p>
        </div>
      )}
      {popover === "openings" && (
        <div className="popover">
          {(Object.keys(OPENING_LABELS) as OpeningType[]).map((t) => (
            <button key={t} className={`menu ${openingType === t ? "active" : ""}`} onClick={() => setOpeningType(t)}>
              {OPENING_LABELS[t]}
            </button>
          ))}
          <p className="muted small">Кликните по стене. Сторону открывания и петли меняйте в свойствах.</p>
        </div>
      )}
      {popover === "items" && (
        <div className="popover wide">
          {GENERIC_ITEMS.map((t) => (
            <button
              key={t.name}
              className={`menu ${itemTemplate?.name === t.name ? "active" : ""}`}
              onClick={() => {
                setItemTemplate(t);
                setPopover(null);
              }}
            >
              {t.name} <span className="muted">{t.w}×{t.d}×{t.h}</span>
            </button>
          ))}
          <p className="muted small">Размеры правятся в свойствах. Товары из каталога ставятся кнопкой «на план».</p>
        </div>
      )}
    </div>
  );
}
