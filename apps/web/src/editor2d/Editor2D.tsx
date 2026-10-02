import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  add,
  bbox,
  checkPlacement,
  dist,
  mul,
  nichePolygon,
  openingWorld,
  projectOnWall,
  round,
  roundVec,
  snapToPoints,
  sub,
  wallLength,
  wallPolygon,
  type Opening,
  type OpeningType,
  type PlacedItem,
  type Project,
  type Vec2,
  type Wall,
} from "@planner/shared";
import { useStore, type Selection } from "../store";
import { ItemShape, MaterialPatterns, OpeningShape, RoomShape, WallShape, pts } from "./shapes";

interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; tx0: number; ty0: number }
  | { kind: "item"; id: string; offset: Vec2; recorded: boolean }
  | { kind: "rotate"; id: string; center: Vec2; recorded: boolean }
  | { kind: "wallEnd"; targets: Array<{ wallId: string; end: "a" | "b" }>; recorded: boolean }
  | { kind: "opening"; id: string; recorded: boolean }
  | { kind: "label"; id: string; offset: Vec2; recorded: boolean }
  | { kind: "roomVertex"; roomId: string; index: number; recorded: boolean };

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const GRID = 5;

const OPENING_DEFAULTS: Record<OpeningType, { width: number; height: number; sill: number; depth?: number }> = {
  door: { width: 80, height: 205, sill: 0 },
  double_door: { width: 120, height: 205, sill: 0 },
  window: { width: 120, height: 140, sill: 90 },
  passage: { width: 90, height: 210, sill: 0 },
  niche: { width: 40, height: 240, sill: 0, depth: 30 },
};

function planBounds(p: Project): { min: Vec2; max: Vec2 } {
  const points: Vec2[] = [];
  for (const w of p.plan.walls) points.push(...wallPolygon(w));
  for (const r of p.plan.rooms) points.push(...r.polygon);
  for (const it of p.plan.items) points.push({ x: it.x, y: it.y });
  if (!points.length) return { min: { x: -100, y: -100 }, max: { x: 400, y: 300 } };
  return bbox(points);
}

export default function Editor2D() {
  const project = useStore((s) => s.project);
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const setMode = useStore((s) => s.setMode);
  const openingType = useStore((s) => s.openingType);
  const itemTemplate = useStore((s) => s.itemTemplate);
  const setItemTemplate = useStore((s) => s.setItemTemplate);
  const wallThickness = useStore((s) => s.wallThickness);
  const showDims = useStore((s) => s.showDims);
  const toast = useStore((s) => s.toast);

  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState<Viewport>({ scale: 2, tx: 100, ty: 100 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [ghostRotation, setGhostRotation] = useState(0);
  const [spaceDown, setSpaceDown] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const fittedFor = useRef<string | null>(null);

  // Fit the view to the plan when a project is opened.
  useEffect(() => {
    if (!project || !svgRef.current) return;
    if (fittedFor.current === project.id) return;
    fittedFor.current = project.id;
    const rect = svgRef.current.getBoundingClientRect();
    const b = planBounds(project);
    const w = Math.max(100, b.max.x - b.min.x + 160);
    const h = Math.max(100, b.max.y - b.min.y + 160);
    const scale = Math.min(rect.width / w, rect.height / h, 6);
    setVp({ scale, tx: rect.width / 2 - ((b.min.x + b.max.x) / 2) * scale, ty: rect.height / 2 - ((b.min.y + b.max.y) / 2) * scale });
  }, [project]);

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Vec2 => {
      const rect = svgRef.current!.getBoundingClientRect();
      return { x: (e.clientX - rect.left - vp.tx) / vp.scale, y: (e.clientY - rect.top - vp.ty) / vp.scale };
    },
    [vp],
  );

  const snapPoints = useMemo(() => {
    if (!project) return [];
    const p: Vec2[] = [];
    for (const w of project.plan.walls) p.push(w.a, w.b);
    for (const r of project.plan.rooms) p.push(...r.polygon);
    return p;
  }, [project]);

  const snap = useCallback(
    (p: Vec2, prev?: Vec2): Vec2 => {
      const near = snapToPoints(p, snapPoints, 12 / vp.scale);
      if (near) return near;
      let q = roundVec(p, GRID);
      if (prev) {
        const d = sub(q, prev);
        const ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
        const nearest = Math.round(ang / 90) * 90;
        if (Math.abs(ang - nearest) < 7) {
          const L = dist(prev, q);
          q = roundVec(add(prev, { x: Math.cos((nearest * Math.PI) / 180) * L, y: Math.sin((nearest * Math.PI) / 180) * L }), GRID);
        }
      }
      return q;
    },
    [snapPoints, vp.scale],
  );

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
      }
      if (e.key === "Escape") {
        setDraft([]);
        if (mode !== "select") setMode("select");
        else select(null);
        setItemTemplate(null);
      }
      if (e.key === "Enter" && draft.length) finishDraft();
      if ((e.key === "Delete" || e.key === "Backspace") && selection) useStore.getState().deleteSelection();
      if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey) {
        if (mode === "item") setGhostRotation((r) => (r + 90) % 360);
        else useStore.getState().rotateSelection(e.shiftKey ? 15 : 90);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useStore.getState().redo();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  const nearestWall = useCallback(
    (p: Vec2): { wall: Wall; offset: number; point: Vec2 } | null => {
      if (!project) return null;
      let best: { wall: Wall; offset: number; point: Vec2; d: number } | null = null;
      for (const w of project.plan.walls) {
        const r = projectOnWall(p, w);
        if (r.distance <= w.thickness / 2 + 10 / vp.scale && (!best || r.distance < best.d)) best = { wall: w, offset: r.offset, point: r.point, d: r.distance };
      }
      return best;
    },
    [project, vp.scale],
  );

  function finishDraft() {
    if (!project || draft.length === 0) return;
    if (mode === "wall") {
      if (draft.length >= 2) {
        update((p) => {
          for (let i = 0; i < draft.length - 1; i++) {
            const a = draft[i]!;
            const b = draft[i + 1]!;
            if (dist(a, b) < 1) continue;
            p.plan.walls.push({ id: uid("wall"), a, b, thickness: wallThickness, height: p.plan.ceilingHeight, materialId: "paint_white" });
          }
        });
      }
    } else if (mode === "room") {
      if (draft.length >= 3) {
        const id = uid("room");
        update((p) => {
          p.plan.rooms.push({ id, name: `Помещение ${p.plan.rooms.length + 1}`, polygon: draft, floorMaterialId: "parquet_oak_herringbone" });
        });
        select({ type: "room", id });
      }
    }
    setDraft([]);
  }

  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setVp((v) => {
      const scale = Math.min(20, Math.max(0.2, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  };

  const beginDrag = (e: React.PointerEvent, drag: Drag) => {
    dragRef.current = drag;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2 || mode === "pan" || spaceDown) {
      beginDrag(e, { kind: "pan", sx: e.clientX, sy: e.clientY, tx0: vp.tx, ty0: vp.ty });
      return;
    }
    if (e.button !== 0 || !project) return;
    const raw = toWorld(e);
    switch (mode) {
      case "select":
        select(null);
        break;
      case "wall":
      case "room": {
        const p = snap(raw, draft[draft.length - 1]);
        if (mode === "room" && draft.length >= 3 && dist(p, draft[0]!) < 10 / vp.scale) {
          finishDraft();
          return;
        }
        setDraft((d) => [...d, p]);
        break;
      }
      case "opening": {
        const hit = nearestWall(raw);
        if (!hit) break;
        const defaults = OPENING_DEFAULTS[openingType];
        const L = wallLength(hit.wall);
        const offset = Math.max(0, Math.min(L - defaults.width, round(hit.offset - defaults.width / 2, 1)));
        const id = uid("op");
        update((p) => {
          const o: Opening = { id, wallId: hit.wall.id, type: openingType, offset, width: defaults.width, height: defaults.height, sill: defaults.sill, depth: defaults.depth };
          if (openingType === "door" || openingType === "double_door") {
            o.hinge = "start";
            o.swing = "right";
            o.openAngle = 90;
          }
          if (openingType === "niche") o.swing = "right";
          p.plan.openings.push(o);
        });
        select({ type: "opening", id });
        break;
      }
      case "item": {
        if (!itemTemplate) break;
        const c = roundVec(raw, 1);
        const id = uid("it");
        const item: PlacedItem = { id, name: itemTemplate.name, kind: itemTemplate.kind, x: c.x, y: c.y, rotation: ghostRotation, w: itemTemplate.w, d: itemTemplate.d, h: itemTemplate.h, elevation: itemTemplate.elevation ?? 0, color: itemTemplate.color, productId: itemTemplate.productId, imageUrl: itemTemplate.imageUrl };
        const res = checkPlacement(project.plan, item);
        update((p) => {
          p.plan.items.push(item);
          if (item.productId) {
            const prod = p.catalog.find((x) => x.id === item.productId);
            if (prod && prod.status === "candidate") prod.status = "shortlisted";
          }
        });
        if (!res.ok) toast(`Поставлено с конфликтами: ${res.issues.map((i) => i.message).join("; ")}`, "info");
        select({ type: "item", id });
        if (!e.shiftKey) setItemTemplate(null);
        break;
      }
      case "ruler": {
        const p = snap(raw);
        if (draft.length === 0) setDraft([p]);
        else {
          const a = draft[0]!;
          const id = uid("m");
          update((pr) => {
            pr.plan.measurements.push({ id, a, b: p });
          });
          setDraft([]);
          select({ type: "measurement", id });
        }
        break;
      }
      case "label": {
        const text = window.prompt("Текст подписи");
        if (text) {
          const id = uid("lb");
          update((p) => {
            p.plan.labels.push({ id, x: raw.x, y: raw.y, text });
          });
          select({ type: "label", id });
        }
        setMode("select");
        break;
      }
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const raw = toWorld(e);
    setCursor(raw);
    const drag = dragRef.current;
    if (!drag) return;
    const record = !drag.kind.startsWith("pan") && !(drag as { recorded?: boolean }).recorded;
    if ("recorded" in drag) drag.recorded = true;
    switch (drag.kind) {
      case "pan":
        setVp((v) => ({ ...v, tx: drag.tx0 + (e.clientX - drag.sx), ty: drag.ty0 + (e.clientY - drag.sy) }));
        break;
      case "item": {
        const c = roundVec(sub(raw, drag.offset), e.shiftKey ? GRID : 1);
        update(
          (p) => {
            const it = p.plan.items.find((i) => i.id === drag.id);
            if (it && !it.locked) {
              it.x = c.x;
              it.y = c.y;
            }
          },
          { record },
        );
        break;
      }
      case "rotate": {
        const v = sub(raw, drag.center);
        let ang = (Math.atan2(v.y, v.x) * 180) / Math.PI + 90;
        ang = e.shiftKey ? round(ang, 1) : round(ang, 15);
        update(
          (p) => {
            const it = p.plan.items.find((i) => i.id === drag.id);
            if (it) it.rotation = ((ang % 360) + 360) % 360;
          },
          { record },
        );
        break;
      }
      case "wallEnd": {
        const p = snap(raw);
        update(
          (pr) => {
            for (const t of drag.targets) {
              const w = pr.plan.walls.find((x) => x.id === t.wallId);
              if (w) w[t.end] = { ...p };
            }
          },
          { record },
        );
        break;
      }
      case "opening": {
        update(
          (p) => {
            const o = p.plan.openings.find((x) => x.id === drag.id);
            const w = o && p.plan.walls.find((x) => x.id === o.wallId);
            if (!o || !w) return;
            const r = projectOnWall(raw, w);
            o.offset = Math.max(0, Math.min(wallLength(w) - o.width, round(r.offset - o.width / 2, 1)));
          },
          { record },
        );
        break;
      }
      case "label": {
        update(
          (p) => {
            const l = p.plan.labels.find((x) => x.id === drag.id);
            if (l) {
              l.x = raw.x - drag.offset.x;
              l.y = raw.y - drag.offset.y;
            }
          },
          { record },
        );
        break;
      }
      case "roomVertex": {
        const p = snap(raw);
        update(
          (pr) => {
            const r = pr.plan.rooms.find((x) => x.id === drag.roomId);
            if (r) r.polygon[drag.index] = p;
          },
          { record },
        );
        break;
      }
    }
  };

  const onUp = () => {
    dragRef.current = null;
  };

  if (!project) return <div className="editor-empty">Нет открытого проекта</div>;
  const plan = project.plan;
  const wallMap = new Map(plan.walls.map((w) => [w.id, w]));
  const selId = selection?.id;
  const selectedWall = selection?.type === "wall" ? wallMap.get(selection.id) : undefined;
  const selectedRoom = selection?.type === "room" ? plan.rooms.find((r) => r.id === selection.id) : undefined;
  const isSel = (type: Selection["type"], id: string) => selection?.type === type && selId === id;

  // ghost previews
  const ghost = (() => {
    if (!cursor) return null;
    if (mode === "item" && itemTemplate) {
      const c = roundVec(cursor, 1);
      const probe: PlacedItem = { id: "ghost", name: itemTemplate.name, kind: itemTemplate.kind, x: c.x, y: c.y, rotation: ghostRotation, w: itemTemplate.w, d: itemTemplate.d, h: itemTemplate.h, elevation: itemTemplate.elevation ?? 0 };
      const ok = checkPlacement(plan, probe).ok;
      return (
        <g transform={`translate(${c.x} ${c.y}) rotate(${ghostRotation})`} style={{ pointerEvents: "none" }}>
          <rect x={-probe.w / 2} y={-probe.d / 2} width={probe.w} height={probe.d} fill={ok ? "rgba(43,124,255,0.25)" : "rgba(229,62,62,0.25)"} stroke={ok ? "#2b7cff" : "#e53e3e"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      );
    }
    if (mode === "opening") {
      const hit = nearestWall(cursor);
      if (!hit) return null;
      const defaults = OPENING_DEFAULTS[openingType];
      const o: Opening = { id: "ghost", wallId: hit.wall.id, type: openingType, offset: Math.max(0, Math.min(wallLength(hit.wall) - defaults.width, hit.offset - defaults.width / 2)), width: defaults.width, height: defaults.height, sill: defaults.sill, depth: defaults.depth, swing: "right" };
      const poly = openingType === "niche" ? nichePolygon(hit.wall, o) : openingWorld(hit.wall, o).polygon;
      return <polygon points={pts(poly)} fill="rgba(43,124,255,0.35)" stroke="#2b7cff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />;
    }
    if ((mode === "wall" || mode === "room" || mode === "ruler") && draft.length) {
      const p = snap(cursor, draft[draft.length - 1]);
      const last = draft[draft.length - 1]!;
      const L = dist(last, p);
      const mid = mul(add(last, p), 0.5);
      return (
        <g style={{ pointerEvents: "none" }}>
          <line x1={last.x} y1={last.y} x2={p.x} y2={p.y} stroke="#2b7cff" strokeWidth={mode === "wall" ? wallThickness : 1} strokeOpacity={mode === "wall" ? 0.5 : 1} strokeDasharray={mode === "ruler" ? "4 3" : undefined} />
          <text x={mid.x} y={mid.y - 8 / vp.scale} fontSize={11 / vp.scale} fill="#2b7cff" textAnchor="middle">
            {Math.round(L)} см
          </text>
        </g>
      );
    }
    return null;
  })();

  const cursorStyle = mode === "pan" || spaceDown ? "grab" : mode === "select" ? "default" : "crosshair";

  return (
    <div className="editor2d" onContextMenu={(e) => e.preventDefault()}>
      <svg
        ref={svgRef}
        className="editor-svg"
        style={{ cursor: cursorStyle }}
        onWheel={onWheel}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => draft.length && finishDraft()}
      >
        <MaterialPatterns />
        <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="#f7f8fa" />
        <g transform={`translate(${vp.tx} ${vp.ty}) scale(${vp.scale})`}>
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#grid-major)" />
          {/* axes origin marker */}
          <circle cx={0} cy={0} r={2 / vp.scale} fill="#cbd5e0" />

          {plan.rooms.map((r) => (
            <RoomShape
              key={r.id}
              room={r}
              selected={isSel("room", r.id)}
              onPointerDown={(e) => {
                if (mode !== "select") return;
                e.stopPropagation();
                select({ type: "room", id: r.id });
              }}
            />
          ))}
          {plan.rooms.map((r) => (
            <text key={`${r.id}-lbl`} x={r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length} y={r.polygon.reduce((s, p) => s + p.y, 0) / r.polygon.length} fontSize={12 / vp.scale} fill="rgba(0,0,0,0.45)" textAnchor="middle" style={{ pointerEvents: "none", userSelect: "none" }}>
              {r.name}
            </text>
          ))}

          {plan.walls.map((w) => (
            <WallShape
              key={w.id}
              wall={w}
              selected={isSel("wall", w.id)}
              showDims={showDims}
              scale={vp.scale}
              onPointerDown={(e) => {
                if (mode === "opening" || mode === "pan" || spaceDown) return;
                if (mode !== "select") return;
                e.stopPropagation();
                select({ type: "wall", id: w.id });
              }}
            />
          ))}

          {plan.openings.map((o) => {
            const w = wallMap.get(o.wallId);
            if (!w) return null;
            return (
              <OpeningShape
                key={o.id}
                wall={w}
                opening={o}
                selected={isSel("opening", o.id)}
                onPointerDown={(e) => {
                  if (mode !== "select") return;
                  e.stopPropagation();
                  select({ type: "opening", id: o.id });
                  beginDrag(e, { kind: "opening", id: o.id, recorded: false });
                }}
              />
            );
          })}

          {[...plan.items]
            .sort((a, b) => (a.kind === "rug" ? -1 : b.kind === "rug" ? 1 : a.elevation - b.elevation))
            .map((it) => (
              <ItemShape
                key={it.id}
                item={it}
                selected={isSel("item", it.id)}
                conflict={!checkPlacement(plan, it, { ignoreItemId: it.id }).ok}
                scale={vp.scale}
                showDims={showDims}
                onPointerDown={(e) => {
                  if (mode !== "select") return;
                  e.stopPropagation();
                  select({ type: "item", id: it.id });
                  if (!it.locked) beginDrag(e, { kind: "item", id: it.id, offset: sub(toWorld(e), { x: it.x, y: it.y }), recorded: false });
                }}
                onRotateDown={(e) => {
                  e.stopPropagation();
                  beginDrag(e, { kind: "rotate", id: it.id, center: { x: it.x, y: it.y }, recorded: false });
                }}
              />
            ))}

          {plan.measurements.map((m) => {
            const L = dist(m.a, m.b);
            const mid = mul(add(m.a, m.b), 0.5);
            const sel = isSel("measurement", m.id);
            return (
              <g
                key={m.id}
                onPointerDown={(e) => {
                  if (mode !== "select") return;
                  e.stopPropagation();
                  select({ type: "measurement", id: m.id });
                }}
                style={{ cursor: "pointer" }}
              >
                <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={sel ? "#2b7cff" : "#d53f8c"} strokeWidth={sel ? 2 : 1} vectorEffect="non-scaling-stroke" strokeDasharray="5 3" />
                <circle cx={m.a.x} cy={m.a.y} r={2.5 / vp.scale} fill="#d53f8c" />
                <circle cx={m.b.x} cy={m.b.y} r={2.5 / vp.scale} fill="#d53f8c" />
                <text x={mid.x} y={mid.y - 6 / vp.scale} fontSize={11 / vp.scale} fill="#d53f8c" textAnchor="middle" style={{ userSelect: "none" }}>
                  {Math.round(L)} см{m.label ? ` · ${m.label}` : ""}
                </text>
              </g>
            );
          })}

          {plan.labels.map((l) => (
            <text
              key={l.id}
              x={l.x}
              y={l.y}
              fontSize={12 / vp.scale}
              fill={isSel("label", l.id) ? "#2b7cff" : "#4a5568"}
              textAnchor="middle"
              fontWeight={600}
              style={{ cursor: "move", userSelect: "none" }}
              onPointerDown={(e) => {
                if (mode !== "select") return;
                e.stopPropagation();
                select({ type: "label", id: l.id });
                beginDrag(e, { kind: "label", id: l.id, offset: sub(toWorld(e), { x: l.x, y: l.y }), recorded: false });
              }}
            >
              {l.text}
            </text>
          ))}

          {/* draft polyline */}
          {draft.length > 0 && (
            <g style={{ pointerEvents: "none" }}>
              <polyline points={pts(draft)} fill="none" stroke="#2b7cff" strokeWidth={mode === "wall" ? wallThickness : 1} strokeOpacity={mode === "wall" ? 0.5 : 1} />
              {draft.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3 / vp.scale} fill="#2b7cff" />
              ))}
            </g>
          )}
          {ghost}

          {/* handles */}
          {selectedWall &&
            mode === "select" &&
            (["a", "b"] as const).map((end) => {
              const p = selectedWall[end];
              return (
                <circle
                  key={end}
                  cx={p.x}
                  cy={p.y}
                  r={6 / vp.scale}
                  fill="#fff"
                  stroke="#2b7cff"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: "move" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const targets: Array<{ wallId: string; end: "a" | "b" }> = [];
                    for (const w of plan.walls) {
                      if (dist(w.a, p) < 0.5) targets.push({ wallId: w.id, end: "a" });
                      if (dist(w.b, p) < 0.5) targets.push({ wallId: w.id, end: "b" });
                    }
                    beginDrag(e, { kind: "wallEnd", targets, recorded: false });
                  }}
                />
              );
            })}
          {selectedRoom &&
            mode === "select" &&
            selectedRoom.polygon.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={5 / vp.scale}
                fill="#fff"
                stroke="#2b7cff"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "move" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  beginDrag(e, { kind: "roomVertex", roomId: selectedRoom.id, index: i, recorded: false });
                }}
              />
            ))}
        </g>
      </svg>
      <div className="editor-hud">
        {cursor && (
          <span>
            x {Math.round(cursor.x)} · y {Math.round(cursor.y)} см
          </span>
        )}
        <span>масштаб {vp.scale.toFixed(2)} px/см</span>
        {mode === "wall" && <span>Стена: клик — точка, Enter/двойной клик — завершить, Esc — отмена</span>}
        {mode === "room" && <span>Пол: обойдите углы, замкните на первой точке или Enter</span>}
        {mode === "opening" && <span>Кликните по стене, чтобы вставить проём</span>}
        {mode === "item" && <span>Клик — поставить, R — повернуть, Shift+клик — поставить несколько</span>}
        {mode === "ruler" && <span>Линейка: две точки</span>}
        {mode === "select" && <span>Перетаскивание, R — повернуть, Delete — удалить, колесо — зум, пробел/ПКМ — панорама</span>}
      </div>
    </div>
  );
}
