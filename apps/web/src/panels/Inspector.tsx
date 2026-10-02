import { Copy, Trash2 } from "lucide-react";
import { checkPlacement, fmtM2, ITEM_KIND_LABELS, MATERIALS, polygonArea, wallLength, type ItemKind, type Opening, type OpeningType, type PlacedItem, type Wall } from "@planner/shared";
import { useStore } from "../store";

function Num({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="field inline">
      <span>{label}</span>
      <input type="number" value={Number.isFinite(value) ? Math.round(value * 10) / 10 : 0} step={step} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Text({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field inline">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function MaterialSelect({ label, category, value, onChange }: { label: string; category: "floor" | "wall"; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <label className="field inline">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {MATERIALS.filter((m) => m.category === category).map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const update = useStore((s) => s.update);
  const select = useStore((s) => s.select);
  const deleteSelection = useStore((s) => s.deleteSelection);
  const showDims = useStore((s) => s.showDims);
  const setShowDims = useStore((s) => s.setShowDims);
  const showLabels3d = useStore((s) => s.showLabels3d);
  const setShowLabels3d = useStore((s) => s.setShowLabels3d);
  if (!project) return null;
  const plan = project.plan;

  if (!selection) {
    const area = plan.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
    return (
      <div className="inspector">
        <div className="panel-head">
          <strong>Проект</strong>
        </div>
        <Text label="Название" value={project.name} onChange={(v) => update((p) => void (p.name = v))} />
        <Num label="Потолок, см" value={plan.ceilingHeight} onChange={(v) => update((p) => void (p.plan.ceilingHeight = v))} />
        <label className="chk">
          <input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} /> размеры стен на плане
        </label>
        <label className="chk">
          <input type="checkbox" checked={showLabels3d} onChange={(e) => setShowLabels3d(e.target.checked)} /> подписи в 3D
        </label>
        <div className="stats">
          <div>Площадь полов: {fmtM2(area)}</div>
          <div>Стен: {plan.walls.length}, проёмов: {plan.openings.length}, предметов: {plan.items.length}</div>
        </div>
        <p className="muted small">Выберите стену, проём или предмет на плане, чтобы редактировать свойства. Координаты в сантиметрах, начало координат — точка (0,0) на сетке.</p>
      </div>
    );
  }

  const del = (
    <div className="row">
      <button className="danger" onClick={deleteSelection}>
        <Trash2 size={14} /> Удалить
      </button>
    </div>
  );

  if (selection.type === "wall") {
    const w = plan.walls.find((x) => x.id === selection.id);
    if (!w) return null;
    const set = (fn: (w: Wall) => void) =>
      update((p) => {
        const x = p.plan.walls.find((y) => y.id === w.id);
        if (x) fn(x);
      });
    return (
      <div className="inspector">
        <div className="panel-head">
          <strong>Стена</strong>
          <span className="muted">{w.id}</span>
        </div>
        <Text label="Подпись" value={w.label ?? ""} onChange={(v) => set((x) => (x.label = v))} />
        <div className="grid2">
          <Num label="A.x" value={w.a.x} onChange={(v) => set((x) => (x.a.x = v))} />
          <Num label="A.y" value={w.a.y} onChange={(v) => set((x) => (x.a.y = v))} />
          <Num label="B.x" value={w.b.x} onChange={(v) => set((x) => (x.b.x = v))} />
          <Num label="B.y" value={w.b.y} onChange={(v) => set((x) => (x.b.y = v))} />
        </div>
        <Num label="Толщина" value={w.thickness} onChange={(v) => set((x) => (x.thickness = Math.max(1, v)))} />
        <Num label="Высота" value={w.height} onChange={(v) => set((x) => (x.height = Math.max(10, v)))} />
        <MaterialSelect label="Отделка" category="wall" value={w.materialId} onChange={(v) => set((x) => (x.materialId = v))} />
        <div className="stats">Длина: {Math.round(wallLength(w))} см</div>
        {del}
      </div>
    );
  }

  if (selection.type === "opening") {
    const o = plan.openings.find((x) => x.id === selection.id);
    if (!o) return null;
    const wall = plan.walls.find((x) => x.id === o.wallId);
    const set = (fn: (o: Opening) => void) =>
      update((p) => {
        const x = p.plan.openings.find((y) => y.id === o.id);
        if (x) fn(x);
      });
    const isDoor = o.type === "door" || o.type === "double_door";
    return (
      <div className="inspector">
        <div className="panel-head">
          <strong>Проём</strong>
          <span className="muted">{o.id}</span>
        </div>
        <Text label="Подпись" value={o.label ?? ""} onChange={(v) => set((x) => (x.label = v))} placeholder="Дверь в ванную" />
        <label className="field inline">
          <span>Тип</span>
          <select value={o.type} onChange={(e) => set((x) => (x.type = e.target.value as OpeningType))}>
            <option value="door">дверь</option>
            <option value="double_door">двустворчатая</option>
            <option value="window">окно</option>
            <option value="passage">проход</option>
            <option value="niche">ниша</option>
          </select>
        </label>
        <Num label="Отступ от начала стены" value={o.offset} onChange={(v) => set((x) => (x.offset = Math.max(0, Math.min((wall ? wallLength(wall) : 1e4) - x.width, v))))} />
        <Num label="Ширина" value={o.width} onChange={(v) => set((x) => (x.width = Math.max(10, v)))} />
        <Num label="Высота" value={o.height} onChange={(v) => set((x) => (x.height = Math.max(10, v)))} />
        {o.type === "window" && <Num label="Подоконник" value={o.sill} onChange={(v) => set((x) => (x.sill = Math.max(0, v)))} />}
        {o.type === "niche" && <Num label="Глубина ниши" value={o.depth ?? 0} onChange={(v) => set((x) => (x.depth = Math.max(0, v)))} />}
        {(isDoor || o.type === "niche") && (
          <label className="field inline">
            <span>{isDoor ? "Открывается в сторону" : "Открыта в сторону"}</span>
            <select value={o.swing ?? "left"} onChange={(e) => set((x) => (x.swing = e.target.value as "left" | "right"))}>
              <option value="left">слева от направления стены</option>
              <option value="right">справа от направления стены</option>
            </select>
          </label>
        )}
        {isDoor && (
          <>
            <label className="field inline">
              <span>Петли</span>
              <select value={o.hinge ?? "start"} onChange={(e) => set((x) => (x.hinge = e.target.value as "start" | "end"))}>
                <option value="start">у начала проёма</option>
                <option value="end">у конца проёма</option>
              </select>
            </label>
            <Num label="Угол открытия, °" value={o.openAngle ?? 90} min={0} max={180} onChange={(v) => set((x) => (x.openAngle = Math.max(0, Math.min(180, v))))} />
          </>
        )}
        {del}
      </div>
    );
  }

  if (selection.type === "item") {
    const it = plan.items.find((x) => x.id === selection.id);
    if (!it) return null;
    const product = it.productId ? project.catalog.find((p) => p.id === it.productId) : undefined;
    const issues = checkPlacement(plan, it, { ignoreItemId: it.id }).issues;
    const set = (fn: (i: PlacedItem) => void) =>
      update((p) => {
        const x = p.plan.items.find((y) => y.id === it.id);
        if (x) fn(x);
      });
    return (
      <div className="inspector">
        <div className="panel-head">
          <strong>Предмет</strong>
          <span className="muted">{it.id}</span>
        </div>
        {issues.length > 0 && (
          <div className="banner warn">
            {issues.map((i, k) => (
              <div key={k}>⚠ {i.message}</div>
            ))}
          </div>
        )}
        <Text label="Название" value={it.name} onChange={(v) => set((x) => (x.name = v))} />
        <label className="field inline">
          <span>Тип</span>
          <select value={it.kind} onChange={(e) => set((x) => (x.kind = e.target.value as ItemKind))}>
            {Object.entries(ITEM_KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="grid2">
          <Num label="Центр x" value={it.x} onChange={(v) => set((x) => (x.x = v))} />
          <Num label="Центр y" value={it.y} onChange={(v) => set((x) => (x.y = v))} />
          <Num label="Поворот, °" value={it.rotation} step={15} onChange={(v) => set((x) => (x.rotation = ((v % 360) + 360) % 360))} />
          <Num label="Низ над полом" value={it.elevation} onChange={(v) => set((x) => (x.elevation = Math.max(0, v)))} />
          <Num label="Ширина" value={it.w} onChange={(v) => set((x) => (x.w = Math.max(1, v)))} />
          <Num label="Глубина" value={it.d} onChange={(v) => set((x) => (x.d = Math.max(1, v)))} />
          <Num label="Высота" value={it.h} onChange={(v) => set((x) => (x.h = Math.max(1, v)))} />
          <label className="field inline">
            <span>Цвет</span>
            <input type="color" value={it.color ?? "#b08968"} onChange={(e) => set((x) => (x.color = e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>Заметка для агента</span>
          <input value={it.note ?? ""} onChange={(e) => set((x) => (x.note = e.target.value))} placeholder="например: заменить на тумбу" />
        </label>
        <label className="chk">
          <input type="checkbox" checked={Boolean(it.locked)} onChange={(e) => set((x) => (x.locked = e.target.checked))} /> закреплён (агент не двигает)
        </label>
        {product && (
          <div className="stats">
            Товар:{" "}
            <a href={product.url} target="_blank" rel="noreferrer noopener">
              {product.title}
            </a>
            {product.price ? ` · ${product.price.toLocaleString("ru-RU")} ₽` : ""}
          </div>
        )}
        <div className="row">
          <button
            onClick={() => {
              const id = `it_${Math.random().toString(36).slice(2, 10)}`;
              update((p) => {
                p.plan.items.push({ ...it, id, x: it.x + 10, y: it.y + 10, locked: false });
              });
              select({ type: "item", id });
            }}
          >
            <Copy size={14} /> Дублировать
          </button>
          <button className="danger" onClick={deleteSelection}>
            <Trash2 size={14} /> Удалить
          </button>
        </div>
      </div>
    );
  }

  if (selection.type === "room") {
    const r = plan.rooms.find((x) => x.id === selection.id);
    if (!r) return null;
    return (
      <div className="inspector">
        <div className="panel-head">
          <strong>Помещение</strong>
          <span className="muted">{r.id}</span>
        </div>
        <Text
          label="Название"
          value={r.name}
          onChange={(v) =>
            update((p) => {
              const x = p.plan.rooms.find((y) => y.id === r.id);
              if (x) x.name = v;
            })
          }
        />
        <MaterialSelect
          label="Пол"
          category="floor"
          value={r.floorMaterialId}
          onChange={(v) =>
            update((p) => {
              const x = p.plan.rooms.find((y) => y.id === r.id);
              if (x) x.floorMaterialId = v;
            })
          }
        />
        <div className="stats">Площадь: {fmtM2(polygonArea(r.polygon))}</div>
        <p className="muted small">Углы пола можно перетаскивать на плане.</p>
        {del}
      </div>
    );
  }

  if (selection.type === "label") {
    const l = plan.labels.find((x) => x.id === selection.id);
    if (!l) return null;
    return (
      <div className="inspector">
        <div className="panel-head">
          <strong>Подпись</strong>
        </div>
        <Text
          label="Текст"
          value={l.text}
          onChange={(v) =>
            update((p) => {
              const x = p.plan.labels.find((y) => y.id === l.id);
              if (x) x.text = v;
            })
          }
        />
        {del}
      </div>
    );
  }

  if (selection.type === "measurement") {
    const m = plan.measurements.find((x) => x.id === selection.id);
    if (!m) return null;
    return (
      <div className="inspector">
        <div className="panel-head">
          <strong>Замер</strong>
        </div>
        <Text
          label="Подпись"
          value={m.label ?? ""}
          onChange={(v) =>
            update((p) => {
              const x = p.plan.measurements.find((y) => y.id === m.id);
              if (x) x.label = v;
            })
          }
          placeholder="например: место под обувницу"
        />
        <div className="stats">{Math.round(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y))} см</div>
        {del}
      </div>
    );
  }
  return null;
}
