import { add, mul, openingWorld, perpLeft, perpRight, rotate, wallDir, wallLength, type Opening, type Vec2, type Wall } from "@planner/shared";

/** Axis-aligned-in-local-frame box in plan units (cm). */
export interface Box3 {
  key: string;
  cx: number;
  cy: number;
  /** Rotation of the local x axis in plan degrees. */
  angle: number;
  length: number;
  thickness: number;
  y0: number;
  y1: number;
  kind: "wall" | "lintel" | "sill" | "niche" | "leaf" | "frame";
  color?: string;
  materialId?: string;
}

function box(key: string, wall: Wall, t0: number, t1: number, y0: number, y1: number, kind: Box3["kind"], thickness = wall.thickness, lateral = 0): Box3 {
  const d = wallDir(wall);
  const n = perpLeft(d);
  const mid = add(add(wall.a, mul(d, (t0 + t1) / 2)), mul(n, lateral));
  return { key, cx: mid.x, cy: mid.y, angle: (Math.atan2(d.y, d.x) * 180) / Math.PI, length: Math.max(0.1, t1 - t0), thickness, y0, y1, kind, materialId: wall.materialId };
}

/** Split a wall into solid boxes around its openings. */
export function wallBoxes(wall: Wall, openings: Opening[]): Box3[] {
  const L = wallLength(wall);
  const H = wall.height;
  const list = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({ o, s: Math.max(0, o.offset), e: Math.min(L, o.offset + o.width) }))
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s);
  const out: Box3[] = [];
  let cur = 0;
  let i = 0;
  for (const { o, s, e } of list) {
    if (s > cur) out.push(box(`${wall.id}-w${i++}`, wall, cur, s, 0, H, "wall"));
    const top = o.sill + o.height;
    if (o.type === "window") {
      if (o.sill > 0) out.push(box(`${o.id}-sill`, wall, s, e, 0, o.sill, "sill"));
      if (top < H) out.push(box(`${o.id}-lintel`, wall, s, e, top, H, "lintel"));
    } else if (o.type === "niche") {
      const depth = o.depth ?? 0;
      // niche opens to the swing side; the recess extends through the wall and `depth` beyond the far face
      const sideSign = o.swing === "right" ? 1 : -1; // +1 → opening faces perpRight
      // back panel
      const backLateral = -sideSign * (wall.thickness / 2 + depth + 1);
      out.push({ ...box(`${o.id}-back`, wall, s, e, 0, Math.min(top, H), "niche", 2, backLateral), kind: "niche" });
      // side cheeks
      const cheekLen = wall.thickness + depth;
      const cheekLateral = -sideSign * (depth / 2);
      for (const [k, t] of [["l", s], ["r", e]] as const) {
        const d = wallDir(wall);
        const n = perpLeft(d);
        const p = add(add(wall.a, mul(d, t)), mul(n, cheekLateral));
        out.push({ key: `${o.id}-cheek-${k}`, cx: p.x, cy: p.y, angle: (Math.atan2(d.y, d.x) * 180) / Math.PI + 90, length: cheekLen, thickness: 2, y0: 0, y1: Math.min(top, H), kind: "niche", materialId: wall.materialId });
      }
      if (top < H) out.push(box(`${o.id}-lintel`, wall, s, e, top, H, "lintel"));
      // ceiling of the niche when it is lower than the wall
      if (top < H) {
        const d = wallDir(wall);
        const n = perpLeft(d);
        const p = add(add(wall.a, mul(d, (s + e) / 2)), mul(n, -sideSign * (depth / 2)));
        out.push({ key: `${o.id}-top`, cx: p.x, cy: p.y, angle: (Math.atan2(d.y, d.x) * 180) / Math.PI, length: e - s, thickness: depth + 2, y0: top - 2, y1: top, kind: "niche", materialId: wall.materialId });
      }
    } else {
      if (top < H) out.push(box(`${o.id}-lintel`, wall, s, e, top, H, "lintel"));
    }
    cur = Math.max(cur, e);
  }
  if (cur < L) out.push(box(`${wall.id}-w${i++}`, wall, cur, L, 0, H, "wall"));
  return out;
}

/** Door leaves at their open angle. */
export function doorLeaves(wall: Wall, o: Opening): Box3[] {
  if (o.type !== "door" && o.type !== "double_door") return [];
  const ow = openingWorld(wall, o);
  const hingeAtStart = (o.hinge ?? "start") === "start";
  const width = o.type === "double_door" ? o.width / 2 : o.width;
  const openAngle = o.openAngle ?? 0;
  const leaves: Array<{ hinge: Vec2; toward: Vec2 }> = [{ hinge: hingeAtStart ? ow.start : ow.end, toward: hingeAtStart ? ow.dir : mul(ow.dir, -1) }];
  if (o.type === "double_door") leaves.push({ hinge: hingeAtStart ? ow.end : ow.start, toward: hingeAtStart ? mul(ow.dir, -1) : ow.dir });
  const entrance = /вход|entrance|входн/i.test(o.label ?? "");
  const color = entrance ? "#6b2a2a" : "#b5793f";
  return leaves.map((lf, i) => {
    const sign = Math.sign(lf.toward.x * ow.normal.y - lf.toward.y * ow.normal.x) || 1;
    const dir = rotate(lf.toward, sign * openAngle);
    const c = add(lf.hinge, mul(dir, width / 2));
    return { key: `${o.id}-leaf${i}`, cx: c.x, cy: c.y, angle: (Math.atan2(dir.y, dir.x) * 180) / Math.PI, length: width - 1, thickness: 4, y0: 1, y1: o.height - 1, kind: "leaf", color };
  });
}

/** Simple door/passage frame: two jambs + head. */
export function openingFrame(wall: Wall, o: Opening): Box3[] {
  if (o.type === "window" || o.type === "niche") return [];
  const ow = openingWorld(wall, o);
  const d = ow.dir;
  const out: Box3[] = [];
  const t = wall.thickness + 2;
  for (const [k, p] of [["s", ow.start], ["e", ow.end]] as const) {
    const c = add(p, mul(d, k === "s" ? 2 : -2));
    out.push({ key: `${o.id}-jamb-${k}`, cx: c.x, cy: c.y, angle: (Math.atan2(d.y, d.x) * 180) / Math.PI, length: 4, thickness: t, y0: 0, y1: o.height, kind: "frame", color: "#d9cbb8" });
  }
  out.push({ key: `${o.id}-head`, cx: ow.center.x, cy: ow.center.y, angle: (Math.atan2(d.y, d.x) * 180) / Math.PI, length: o.width, thickness: t, y0: o.height - 4, y1: o.height, kind: "frame", color: "#d9cbb8" });
  return out;
}

export { perpRight };
