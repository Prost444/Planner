import {
  add,
  convexHull,
  doorSwingPolygon,
  dot,
  sub,
  itemPolygon,
  mul,
  openingClearancePolygon,
  openingWorld,
  perpLeft,
  perpRight,
  pointInPolygon,
  polygonCentroid,
  polygonsOverlap,
  rayPolygon,
  wallDir,
  wallLength,
  wallPolygon,
} from "./geometry.js";
import type {
  FreeWallSegment,
  Opening,
  PlacedItem,
  Plan,
  PlacementIssue,
  PlacementResult,
  Vec2,
  Wall,
} from "./types.js";

export interface PlacementOptions {
  /** Item id to ignore (when moving an existing item). */
  ignoreItemId?: string;
  /** Depth of the passage zone in front of doors/passages (cm). */
  clearanceDepth?: number;
}

const THIN_KINDS = new Set(["rug"]);
const WALL_MOUNTED_KINDS = new Set(["mirror", "hooks"]);

/** Items that actually take floor space in front of a wall (not rugs, not wall-mounted, not the mezzanine). */
export function isFloorObstacle(it: PlacedItem): boolean {
  if (THIN_KINDS.has(it.kind) || WALL_MOUNTED_KINDS.has(it.kind)) return false;
  if (it.elevation >= 90) return false;
  if (it.elevation > 0 && it.d <= 8) return false;
  return true;
}

function isAboveDoors(item: PlacedItem, plan: Plan): boolean {
  const maxDoor =
    plan.openings.reduce(
      (m, o) => (o.type === "window" ? m : Math.max(m, o.sill + o.height)),
      0,
    ) || 210;
  return item.elevation >= maxDoor - 1;
}

/** Check whether an item can sit at its position. Pure function – safe to call from UI and agent. */
export function checkPlacement(
  plan: Plan,
  item: PlacedItem,
  opts: PlacementOptions = {},
): PlacementResult {
  const issues: PlacementIssue[] = [];
  if (!(item.w > 0 && item.d > 0 && item.h > 0)) {
    issues.push({
      type: "invalid",
      message: "Размеры должны быть положительными",
    });
    return { ok: false, issues };
  }
  const poly = itemPolygon(item);
  const thin = THIN_KINDS.has(item.kind);
  const above = isAboveDoors(item, plan);
  const wallMap = new Map(plan.walls.map((w) => [w.id, w]));

  // Walls: an item may touch but not penetrate a wall (1.5 cm tolerance for snapping against the face).
  for (const w of plan.walls) {
    if (item.elevation >= w.height) continue;
    if (polygonsOverlap(poly, wallPolygon(w), 1.5)) {
      // Allow items sitting inside a niche opening of this wall.
      const inNiche = plan.openings.some(
        (o) =>
          o.wallId === w.id &&
          o.type === "niche" &&
          polygonsOverlap(poly, nichePolygon(w, o), 0.5),
      );
      if (!inNiche)
        issues.push({
          type: "wall_overlap",
          message: `Пересекает стену ${w.label ?? w.id}`,
          withId: w.id,
        });
    }
  }

  // Other items (rugs are ignored, and items on different levels are fine).
  if (!thin) {
    for (const other of plan.items) {
      if (other.id === item.id || other.id === opts.ignoreItemId) continue;
      if (THIN_KINDS.has(other.kind)) continue;
      const vSep =
        item.elevation >= other.elevation + other.h - 0.5 ||
        other.elevation >= item.elevation + item.h - 0.5;
      if (vSep) continue;
      if (polygonsOverlap(poly, itemPolygon(other), 0.5)) {
        issues.push({
          type: "item_overlap",
          message: `Пересекается с «${other.name}»`,
          withId: other.id,
        });
      }
    }
  }

  // Door swings and passages.
  if (!thin && !above) {
    for (const o of plan.openings) {
      const w = wallMap.get(o.wallId);
      if (!w) continue;
      if (o.type === "window" || o.type === "niche") continue;
      if (item.elevation >= o.sill + o.height) continue;
      if (
        (o.type === "door" || o.type === "double_door") &&
        polygonsOverlap(poly, doorSwingPolygon(w, o), 1)
      ) {
        issues.push({
          type: "door_swing",
          message: `Мешает открыванию двери ${o.label ?? o.id}`,
          withId: o.id,
        });
      } else if (
        polygonsOverlap(
          poly,
          openingClearancePolygon(w, o, opts.clearanceDepth ?? 60),
          1,
        )
      ) {
        issues.push({
          type: "opening_blocked",
          message: `Перекрывает проход ${o.label ?? o.id}`,
          withId: o.id,
        });
      }
    }
  }

  // Must be inside some room (if rooms are defined), unless it sits inside a niche.
  if (plan.rooms.length > 0) {
    const c = { x: item.x, y: item.y };
    const inside = plan.rooms.some((r) => pointInPolygon(c, r.polygon));
    const inNiche = plan.openings.some((o) => {
      const w = wallMap.get(o.wallId);
      return w && o.type === "niche" && pointInPolygon(c, nichePolygon(w, o));
    });
    if (!inside && !inNiche)
      issues.push({
        type: "outside_room",
        message: "Центр предмета вне помещения",
      });
  }

  return { ok: issues.length === 0, issues };
}

/** Polygon of a niche recess: the opening span, from the wall's inner face to `depth` beyond the far face. */
export function nichePolygon(w: Wall, o: Opening): Vec2[] {
  const ow = openingWorld(w, o);
  const n = o.swing === "right" ? perpRight(ow.dir) : perpLeft(ow.dir);
  // The niche goes *away* from the room: into the wall and beyond by depth.
  const back = mul(n, -(w.thickness / 2 + (o.depth ?? 0)));
  const front = mul(n, w.thickness / 2);
  return [
    add(ow.start, front),
    add(ow.end, front),
    add(ow.end, back),
    add(ow.start, back),
  ];
}

export interface FreeSegmentsOptions {
  minLength?: number;
  /** Items below this elevation count as obstacles (default: everything on the floor). */
  maxDepthCap?: number;
}

/** Intervals [start,end] along the wall axis that are not covered by openings. */
function freeIntervals(
  w: Wall,
  openings: Opening[],
  margin = 3,
): Array<[number, number]> {
  const L = wallLength(w);
  const blocked = openings
    .filter((o) => o.wallId === w.id && o.type !== "window")
    .map(
      (o) =>
        [
          Math.max(0, o.offset - margin),
          Math.min(L, o.offset + o.width + margin),
        ] as [number, number],
    )
    .sort((a, b) => a[0] - b[0]);
  const free: Array<[number, number]> = [];
  let cur = 0;
  for (const [s, e] of blocked) {
    if (s > cur) free.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < L) free.push([cur, L]);
  return free;
}

/**
 * Wall faces that look into a room and are free of openings. Returned runs lie on the wall face.
 * `freeDepth` is measured from the run's midpoint along the inward normal until the first wall or item.
 */
export function findFreeWallSegments(
  plan: Plan,
  opts: FreeSegmentsOptions = {},
): FreeWallSegment[] {
  const minLength = opts.minLength ?? 20;
  const cap = opts.maxDepthCap ?? 400;
  const result: FreeWallSegment[] = [];
  const obstacles: Array<{ poly: Vec2[]; id: string }> = [
    ...plan.walls.map((w) => ({ poly: wallPolygon(w), id: w.id })),
    ...plan.items
      .filter((it) => isFloorObstacle(it))
      .map((it) => ({ poly: convexHull(itemPolygon(it)), id: it.id })),
  ];
  for (const w of plan.walls) {
    const d = wallDir(w);
    const L = wallLength(w);
    if (L < minLength) continue;
    for (const side of ["left", "right"] as const) {
      const n = side === "left" ? perpLeft(d) : perpRight(d);
      const probe = add(add(w.a, mul(d, L / 2)), mul(n, w.thickness / 2 + 5));
      const room = plan.rooms.find((r) => pointInPolygon(probe, r.polygon));
      if (!room) continue;
      const faceOffset = mul(n, w.thickness / 2);
      // Subtract spans of the face covered by other walls' slabs (corner overlaps, partition walls).
      const covered: Array<[number, number]> = [];
      for (const other of plan.walls) {
        if (other.id === w.id) continue;
        const poly = wallPolygon(other);
        const ts = poly.map((p) => dot(sub(sub(p, w.a), faceOffset), d));
        const t0 = Math.max(0, Math.min(...ts));
        const t1 = Math.min(L, Math.max(...ts));
        if (t1 - t0 <= 0.5) continue;
        const probeOnFace = add(
          add(w.a, mul(d, (t0 + t1) / 2)),
          add(faceOffset, mul(n, 0.5)),
        );
        if (pointInPolygon(probeOnFace, poly)) covered.push([t0, t1]);
      }
      for (const [s0, e0] of freeIntervals(w, plan.openings)) {
        // clip by covered spans
        const pieces: Array<[number, number]> = [[s0, e0]];
        for (const [c0, c1] of covered) {
          for (let i = pieces.length - 1; i >= 0; i--) {
            const [ps, pe] = pieces[i]!;
            if (c1 <= ps || c0 >= pe) continue;
            pieces.splice(i, 1);
            if (c0 > ps) pieces.push([ps, c0]);
            if (c1 < pe) pieces.push([c1, pe]);
          }
        }
        for (const [s, e] of pieces) {
          if (e - s < minLength) continue;
          const a = add(add(w.a, mul(d, s)), faceOffset);
          const b = add(add(w.a, mul(d, e)), faceOffset);
          const mid = add(
            add(w.a, mul(d, (s + e) / 2)),
            add(faceOffset, mul(n, 1)),
          );
          let depth = cap;
          for (const ob of obstacles) {
            if (ob.id === w.id) continue;
            const t = rayPolygon(mid, n, ob.poly);
            if (t !== null && t < depth) depth = t;
          }
          // Also respect door swings crossing this run.
          for (const o of plan.openings) {
            if (o.type !== "door" && o.type !== "double_door") continue;
            const ow = plan.walls.find((x) => x.id === o.wallId);
            if (!ow) continue;
            const swing = doorSwingPolygon(ow, o);
            const t = rayPolygon(mid, n, swing);
            if (t !== null && t < depth) depth = t;
          }
          result.push({
            wallId: w.id,
            wallLabel: w.label,
            a,
            b,
            length: e - s,
            inward: n,
            freeDepth: Math.max(0, Math.round(depth)),
            roomId: room.id,
          });
        }
      }
    }
  }
  return result.sort((x, y) => y.length - x.length);
}

/** Convenience: does a box of w×d fit at the given free segment, flush with the wall? */
export function itemPoseOnSegment(
  seg: FreeWallSegment,
  w: number,
  d: number,
  alongOffset = 0,
): { x: number; y: number; rotation: number } {
  const dir = { x: seg.b.x - seg.a.x, y: seg.b.y - seg.a.y };
  const L = Math.hypot(dir.x, dir.y) || 1;
  const u = { x: dir.x / L, y: dir.y / L };
  const start = {
    x: seg.a.x + u.x * alongOffset,
    y: seg.a.y + u.y * alongOffset,
  };
  const center = {
    x: start.x + u.x * (w / 2) + seg.inward.x * (d / 2),
    y: start.y + u.y * (w / 2) + seg.inward.y * (d / 2),
  };
  const rotation = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  return { x: center.x, y: center.y, rotation };
}

export function roomCentroid(plan: Plan): Vec2 {
  const r = plan.rooms[0];
  return r ? polygonCentroid(r.polygon) : { x: 0, y: 0 };
}
