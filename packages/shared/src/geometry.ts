import type { Opening, PlacedItem, Vec2, Wall } from "./types.js";

export const EPS = 1e-6;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b));
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** Perpendicular pointing to the left of direction d (in screen coordinates with y down, "left" of a→b). */
export const perpLeft = (d: Vec2): Vec2 => ({ x: d.y, y: -d.x });
export const perpRight = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
export const rotate = (p: Vec2, deg: number): Vec2 => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
export const round = (n: number, step = 1): number => Math.round(n / step) * step;
export const roundVec = (p: Vec2, step = 1): Vec2 => ({ x: round(p.x, step), y: round(p.y, step) });

export function wallDir(w: Wall): Vec2 {
  return norm(sub(w.b, w.a));
}
export function wallLength(w: Wall): number {
  return dist(w.a, w.b);
}
/** Corners of the wall slab (axis of the wall is the centre line). */
export function wallPolygon(w: Wall): Vec2[] {
  const d = wallDir(w);
  const n = mul(perpLeft(d), w.thickness / 2);
  return [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)];
}
export function wallAngleDeg(w: Wall): number {
  const d = wallDir(w);
  return (Math.atan2(d.y, d.x) * 180) / Math.PI;
}

export interface OpeningWorld {
  start: Vec2;
  end: Vec2;
  center: Vec2;
  dir: Vec2;
  /** Normal pointing to the swing side (for doors) or the left side. */
  normal: Vec2;
  polygon: Vec2[];
}

export function openingWorld(w: Wall, o: Opening): OpeningWorld {
  const d = wallDir(w);
  const start = add(w.a, mul(d, o.offset));
  const end = add(w.a, mul(d, o.offset + o.width));
  const center = mul(add(start, end), 0.5);
  const left = perpLeft(d);
  const normal = o.swing === "right" ? perpRight(d) : left;
  const half = mul(left, w.thickness / 2 + 0.5);
  return {
    start,
    end,
    center,
    dir: d,
    normal,
    polygon: [add(start, half), add(end, half), sub(end, half), sub(start, half)],
  };
}

/** Quarter-circle region swept by a door leaf (approximated by a polygon). */
export function doorSwingPolygon(w: Wall, o: Opening, segments = 8): Vec2[] {
  const ow = openingWorld(w, o);
  const hingeAtStart = (o.hinge ?? "start") === "start";
  const hinge = hingeAtStart ? ow.start : ow.end;
  const toward = hingeAtStart ? ow.dir : mul(ow.dir, -1); // from hinge across the opening
  const n = ow.normal;
  const width = o.type === "double_door" ? o.width / 2 : o.width;
  const pts: Vec2[] = [hinge];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * (Math.PI / 2);
    // closed position = along "toward"; open = along the normal
    pts.push(add(hinge, add(mul(toward, Math.cos(t) * width), mul(n, Math.sin(t) * width))));
  }
  if (o.type === "double_door") {
    const hinge2 = hingeAtStart ? ow.end : ow.start;
    const toward2 = mul(toward, -1);
    const pts2: Vec2[] = [hinge2];
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * (Math.PI / 2);
      pts2.push(add(hinge2, add(mul(toward2, Math.cos(t) * width), mul(n, Math.sin(t) * width))));
    }
    // return union-ish as a single polygon spanning both arcs (concave but fine for SAT-on-hull purposes)
    return convexHull([...pts, ...pts2]);
  }
  return pts;
}

/** Rectangle in front of an opening that must stay passable. */
export function openingClearancePolygon(w: Wall, o: Opening, depth = 60): Vec2[] {
  const ow = openingWorld(w, o);
  const n = ow.normal;
  const off = w.thickness / 2;
  const s = add(ow.start, mul(n, off));
  const e = add(ow.end, mul(n, off));
  return [s, e, add(e, mul(n, depth)), add(s, mul(n, depth))];
}

export function itemPolygon(it: Pick<PlacedItem, "x" | "y" | "w" | "d" | "rotation">): Vec2[] {
  const hw = it.w / 2;
  const hd = it.d / 2;
  const c = { x: it.x, y: it.y };
  return [v(-hw, -hd), v(hw, -hd), v(hw, hd), v(-hw, hd)].map((p) => add(c, rotate(p, it.rotation)));
}

export function polygonArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += cross(a, b);
  }
  return Math.abs(s) / 2;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  if (poly.length === 0) return v(0, 0);
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return v(sx / poly.length, sy / poly.length);
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersects = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + EPS) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function bbox(poly: Vec2[]): { min: Vec2; max: Vec2 } {
  const min = v(Infinity, Infinity);
  const max = v(-Infinity, -Infinity);
  for (const p of poly) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}

export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1]!, lower[lower.length - 2]!), sub(p, lower[lower.length - 2]!)) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1]!, upper[upper.length - 2]!), sub(p, upper[upper.length - 2]!)) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Separating axis test for two convex polygons. Touching edges (within tolerance) do not count as overlap. */
export function convexPolygonsOverlap(a: Vec2[], b: Vec2[], tolerance = 0.5): boolean {
  const polys = [a, b];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i]!;
      const p2 = poly[(i + 1) % poly.length]!;
      const axis = norm(perpLeft(sub(p2, p1)));
      if (len(axis) < EPS) continue;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const p of a) {
        const d = dot(p, axis);
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of b) {
        const d = dot(p, axis);
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA <= minB + tolerance || maxB <= minA + tolerance) return false;
    }
  }
  return true;
}

/** Generic polygon overlap: concave polygons are split via hull (good enough for door swings). */
export function polygonsOverlap(a: Vec2[], b: Vec2[], tolerance = 0.5): boolean {
  return convexPolygonsOverlap(convexHull(a), convexHull(b), tolerance);
}

/** Distance from point p to segment ab, and the projected point. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number; q: Vec2 } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, mul(ab, t));
  return { d: dist(p, q), t, q };
}

/** Ray–segment intersection parameter along the ray (>= 0) or null. */
export function raySegment(origin: Vec2, dir: Vec2, a: Vec2, b: Vec2): number | null {
  const vv = sub(a, origin);
  const ab = sub(b, a);
  const denom = cross(dir, ab);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(vv, ab) / denom;
  const u = cross(vv, dir) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}

export function rayPolygon(origin: Vec2, dir: Vec2, poly: Vec2[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const t = raySegment(origin, dir, poly[i]!, poly[(i + 1) % poly.length]!);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Snap a point to the closest of a set of candidate points if within radius. */
export function snapToPoints(p: Vec2, candidates: Vec2[], radius: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = radius;
  for (const c of candidates) {
    const d = dist(p, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Project a point onto a wall axis; returns offset along the wall (cm) and distance. */
export function projectOnWall(p: Vec2, w: Wall): { offset: number; distance: number; point: Vec2 } {
  const r = pointSegmentDistance(p, w.a, w.b);
  return { offset: r.t * wallLength(w), distance: r.d, point: r.q };
}

export function fmtCm(n: number): string {
  return `${Math.round(n)} см`;
}
export function fmtM2(cm2: number): string {
  return `${(cm2 / 10000).toFixed(2)} м²`;
}
