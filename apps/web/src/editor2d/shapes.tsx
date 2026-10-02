import { memo } from "react";
import {
  add,
  doorSwingPolygon,
  getMaterial,
  ITEM_KIND_COLORS,
  MATERIALS,
  mul,
  nichePolygon,
  openingWorld,
  rotate,
  wallDir,
  wallLength,
  wallPolygon,
  type Material,
  type Opening,
  type PlacedItem,
  type Room,
  type Vec2,
  type Wall,
} from "@planner/shared";

export const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(" ");

/** SVG pattern definitions for floor materials (world units = cm). */
export function MaterialPatterns() {
  return (
    <defs>
      {MATERIALS.filter((m) => m.category === "floor").map((m) => (
        <FloorPattern key={m.id} m={m} />
      ))}
      <pattern id="grid-minor" width={10} height={10} patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e3e6ea" strokeWidth={0.4} />
      </pattern>
      <pattern id="grid-major" width={100} height={100} patternUnits="userSpaceOnUse">
        <rect width={100} height={100} fill="url(#grid-minor)" />
        <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#cfd4da" strokeWidth={0.8} />
      </pattern>
    </defs>
  );
}

function FloorPattern({ m }: { m: Material }) {
  const s = m.scale ?? 40;
  const accent = m.accent ?? m.color;
  switch (m.pattern) {
    case "herringbone": {
      // two planks forming a chevron inside an s×s cell
      const w = s / 4;
      return (
        <pattern id={`mat-${m.id}`} width={s} height={s} patternUnits="userSpaceOnUse">
          <rect width={s} height={s} fill={m.color} />
          <g stroke={accent} strokeWidth={0.6} fill="none">
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <path d={`M ${i * w} 0 L ${i * w + s / 2} ${s / 2}`} />
                <path d={`M ${i * w + s / 2} ${s / 2} L ${i * w + s} ${s}`} transform={`translate(-${s / 2} 0)`} />
              </g>
            ))}
            <path d={`M 0 ${s / 2} L ${s / 2} ${s} M ${s / 2} 0 L ${s} ${s / 2}`} />
          </g>
        </pattern>
      );
    }
    case "planks":
      return (
        <pattern id={`mat-${m.id}`} width={s} height={s / 6} patternUnits="userSpaceOnUse">
          <rect width={s} height={s / 6} fill={m.color} />
          <path d={`M 0 ${s / 6} L ${s} ${s / 6} M ${s / 2} 0 L ${s / 2} ${s / 12}`} stroke={accent} strokeWidth={0.6} />
        </pattern>
      );
    case "tiles":
      return (
        <pattern id={`mat-${m.id}`} width={s * 2} height={s * 2} patternUnits="userSpaceOnUse">
          <rect width={s * 2} height={s * 2} fill={m.color} />
          <rect width={s} height={s} fill={m.id === "tile_black_white" ? accent : m.color} />
          <rect x={s} y={s} width={s} height={s} fill={m.id === "tile_black_white" ? accent : m.color} />
          <path d={`M ${s} 0 L ${s} ${s * 2} M 0 ${s} L ${s * 2} ${s}`} stroke={accent} strokeWidth={0.6} />
        </pattern>
      );
    case "hex":
      return (
        <pattern id={`mat-${m.id}`} width={s * 1.732} height={s * 1.5} patternUnits="userSpaceOnUse">
          <rect width={s * 1.732} height={s * 1.5} fill={m.color} />
          <path d={`M ${s * 0.866} 0 L ${s * 1.732} ${s * 0.5} L ${s * 1.732} ${s * 1.5} M ${s * 0.866} 0 L 0 ${s * 0.5} L 0 ${s * 1.5} M 0 ${s * 1.5} L ${s * 0.866} ${s * 2} M ${s * 0.866} ${s * 1} L ${s * 0.866} ${s * 2}`} stroke={accent} strokeWidth={0.6} fill="none" />
        </pattern>
      );
    default:
      return (
        <pattern id={`mat-${m.id}`} width={s || 20} height={s || 20} patternUnits="userSpaceOnUse">
          <rect width={s || 20} height={s || 20} fill={m.color} />
        </pattern>
      );
  }
}

export const RoomShape = memo(function RoomShape({ room, selected, onPointerDown }: { room: Room; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const mat = getMaterial(room.floorMaterialId, "floor");
  return (
    <polygon points={pts(room.polygon)} fill={`url(#mat-${mat.id})`} stroke={selected ? "#2b7cff" : "none"} strokeWidth={2} vectorEffect="non-scaling-stroke" onPointerDown={onPointerDown} style={{ cursor: "pointer" }} />
  );
});

export const WallShape = memo(function WallShape({ wall, selected, showDims, scale, onPointerDown }: { wall: Wall; selected: boolean; showDims: boolean; scale: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const poly = wallPolygon(wall);
  const mid = mul(add(wall.a, wall.b), 0.5);
  const d = wallDir(wall);
  const n = { x: d.y, y: -d.x };
  const labelPos = add(mid, mul(n, wall.thickness / 2 + 10 / scale + 4));
  const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const flip = angle > 90 || angle < -90;
  return (
    <g onPointerDown={onPointerDown} style={{ cursor: "pointer" }}>
      <polygon points={pts(poly)} fill={selected ? "#5b6b7f" : "#3f4650"} stroke={selected ? "#2b7cff" : "#2a2f36"} strokeWidth={selected ? 2 : 0.8} vectorEffect="non-scaling-stroke" />
      {showDims && (
        <text x={labelPos.x} y={labelPos.y} fontSize={11 / scale} fill="#4a5568" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${flip ? angle + 180 : angle} ${labelPos.x} ${labelPos.y})`} style={{ pointerEvents: "none", userSelect: "none" }}>
          {Math.round(wallLength(wall))}
        </text>
      )}
    </g>
  );
});

export const OpeningShape = memo(function OpeningShape({ wall, opening, selected, onPointerDown }: { wall: Wall; opening: Opening; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const ow = openingWorld(wall, opening);
  const stroke = selected ? "#2b7cff" : "#4b3b2a";
  const common = { onPointerDown, style: { cursor: "pointer" } as React.CSSProperties };
  if (opening.type === "niche") {
    const poly = nichePolygon(wall, opening);
    return (
      <g {...common}>
        <polygon points={pts(poly)} fill="#f4efe6" stroke={stroke} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </g>
    );
  }
  const cut = <polygon points={pts(ow.polygon)} fill="#fbfaf7" stroke={selected ? "#2b7cff" : "none"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
  if (opening.type === "window") {
    const t = wall.thickness / 2;
    const n = { x: ow.dir.y, y: -ow.dir.x };
    const l1a = add(ow.start, mul(n, t / 3));
    const l1b = add(ow.end, mul(n, t / 3));
    const l2a = add(ow.start, mul(n, -t / 3));
    const l2b = add(ow.end, mul(n, -t / 3));
    return (
      <g {...common}>
        {cut}
        <polygon points={pts(ow.polygon)} fill="none" stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={l1a.x} y1={l1a.y} x2={l1b.x} y2={l1b.y} stroke="#8fb3d9" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={l2a.x} y1={l2a.y} x2={l2b.x} y2={l2b.y} stroke="#8fb3d9" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </g>
    );
  }
  if (opening.type === "passage") {
    return <g {...common}>{cut}</g>;
  }
  // door(s): leaf at its open angle + swing arc
  const leaves: Array<{ hinge: Vec2; toward: Vec2; width: number }> = [];
  const hingeAtStart = (opening.hinge ?? "start") === "start";
  const width = opening.type === "double_door" ? opening.width / 2 : opening.width;
  leaves.push({ hinge: hingeAtStart ? ow.start : ow.end, toward: hingeAtStart ? ow.dir : mul(ow.dir, -1), width });
  if (opening.type === "double_door") leaves.push({ hinge: hingeAtStart ? ow.end : ow.start, toward: hingeAtStart ? mul(ow.dir, -1) : ow.dir, width });
  const openAngle = opening.openAngle ?? 90;
  const swing = doorSwingPolygon(wall, opening);
  return (
    <g {...common}>
      <polygon points={pts(swing)} fill="rgba(43,124,255,0.06)" stroke="none" />
      {cut}
      {leaves.map((lf, i) => {
        // direction of the leaf rotated from "toward" by openAngle towards the normal
        const sign = Math.sign(lf.toward.x * ow.normal.y - lf.toward.y * ow.normal.x) || 1;
        const leafDir = rotate(lf.toward, sign * openAngle);
        const tip = add(lf.hinge, mul(leafDir, lf.width));
        const arcEnd = add(lf.hinge, mul(lf.toward, lf.width));
        const sweep = sign > 0 ? 1 : 0;
        return (
          <g key={i}>
            <path d={`M ${tip.x} ${tip.y} A ${lf.width} ${lf.width} 0 0 ${sweep} ${arcEnd.x} ${arcEnd.y}`} fill="none" stroke="#9aa5b1" strokeWidth={0.8} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            <line x1={lf.hinge.x} y1={lf.hinge.y} x2={tip.x} y2={tip.y} stroke={stroke} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
});

export const ItemShape = memo(function ItemShape({ item, selected, conflict, scale, showDims, onPointerDown, onRotateDown }: { item: PlacedItem; selected: boolean; conflict: boolean; scale: number; showDims: boolean; onPointerDown: (e: React.PointerEvent) => void; onRotateDown?: (e: React.PointerEvent) => void }) {
  const color = item.color ?? ITEM_KIND_COLORS[item.kind] ?? "#bdbdbd";
  const fs = Math.min(10 / scale, Math.max(3, Math.min(item.w, item.d) / 3));
  const elevated = item.elevation >= 90;
  return (
    <g transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`} onPointerDown={onPointerDown} style={{ cursor: "move" }}>
      <rect x={-item.w / 2} y={-item.d / 2} width={item.w} height={item.d} fill={color} fillOpacity={elevated ? 0.45 : item.kind === "rug" ? 0.6 : 0.9} stroke={conflict ? "#e53e3e" : selected ? "#2b7cff" : "#2a2f36"} strokeWidth={conflict || selected ? 2 : 0.8} strokeDasharray={elevated ? "4 3" : undefined} vectorEffect="non-scaling-stroke" rx={item.kind === "seating" ? Math.min(item.w, item.d) / 4 : 1} />
      {item.imageUrl && item.w * scale > 24 && <image href={item.imageUrl} x={-item.w / 2 + 1} y={-item.d / 2 + 1} width={item.w - 2} height={item.d - 2} preserveAspectRatio="xMidYMid slice" opacity={0.85} style={{ pointerEvents: "none" }} />}
      {item.d * scale >= 12 && item.w * scale >= 30 && (
        <text x={0} y={0} fontSize={fs} fill="#1a202c" textAnchor="middle" dominantBaseline="middle" style={{ pointerEvents: "none", userSelect: "none" }}>
          {item.name.length > 18 ? `${item.name.slice(0, 17)}…` : item.name}
        </text>
      )}
      {showDims && selected && (
        <>
          <text x={0} y={-item.d / 2 - 6 / scale} fontSize={10 / scale} fill="#2b7cff" textAnchor="middle" style={{ pointerEvents: "none", userSelect: "none" }}>
            {Math.round(item.w)}
          </text>
          <text x={item.w / 2 + 6 / scale} y={0} fontSize={10 / scale} fill="#2b7cff" textAnchor="start" dominantBaseline="middle" style={{ pointerEvents: "none", userSelect: "none" }}>
            {Math.round(item.d)}
          </text>
        </>
      )}
      {selected && onRotateDown && (
        <g onPointerDown={onRotateDown} style={{ cursor: "grab" }}>
          <line x1={0} y1={-item.d / 2} x2={0} y2={-item.d / 2 - 18 / scale} stroke="#2b7cff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={0} cy={-item.d / 2 - 18 / scale} r={5 / scale} fill="#fff" stroke="#2b7cff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </g>
  );
});
