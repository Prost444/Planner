import { describe, expect, it } from "vitest";
import { doorSwingPolygon, itemPolygon, polygonArea, polygonsOverlap, wallPolygon } from "./geometry.js";
import { seedHallwayPlan } from "./seed.js";
import { checkPlacement, findFreeWallSegments, itemPoseOnSegment, nichePolygon } from "./validate.js";
import type { PlacedItem } from "./types.js";

const base = (over: Partial<PlacedItem>): PlacedItem => ({
  id: "test",
  name: "test",
  kind: "furniture",
  x: 0,
  y: 0,
  rotation: 0,
  w: 40,
  d: 40,
  h: 40,
  elevation: 0,
  ...over,
});

describe("geometry", () => {
  it("computes polygon area", () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 126 }, { x: 0, y: 126 }])).toBe(240 * 126);
  });
  it("detects overlap of rotated rectangles", () => {
    const a = itemPolygon({ x: 0, y: 0, w: 40, d: 20, rotation: 0 });
    const b = itemPolygon({ x: 25, y: 0, w: 40, d: 20, rotation: 90 });
    expect(polygonsOverlap(a, b)).toBe(true);
    const c = itemPolygon({ x: 60, y: 0, w: 40, d: 20, rotation: 0 });
    expect(polygonsOverlap(a, c)).toBe(false);
  });
  it("does not treat touching rectangles as overlapping", () => {
    const a = itemPolygon({ x: 0, y: 0, w: 40, d: 20, rotation: 0 });
    const b = itemPolygon({ x: 40, y: 0, w: 40, d: 20, rotation: 0 });
    expect(polygonsOverlap(a, b)).toBe(false);
  });
  it("builds a door swing on the inner side of the wall", () => {
    const plan = seedHallwayPlan();
    const wall = plan.walls.find((w) => w.id === "wall_right")!;
    const door = plan.openings.find((o) => o.id === "op_bath")!;
    const swing = doorSwingPolygon(wall, door);
    // All swing points must be inside the hallway (x <= 245) and most strictly inside (x < 240).
    expect(swing.every((p) => p.x <= 245.5)).toBe(true);
    expect(swing.some((p) => p.x < 200)).toBe(true);
  });
});

describe("checkPlacement on the seed hallway", () => {
  const plan = seedHallwayPlan();

  it("accepts a 30×35 pouf under the coat hooks next to the bench", () => {
    const res = checkPlacement(plan, base({ id: "pouf", name: "Пуф", kind: "seating", x: 186, y: 18, w: 30, d: 35, h: 40 }));
    expect(res.issues).toEqual([]);
  });

  it("rejects a pouf along the left wall because the wardrobe doors swing there", () => {
    const res = checkPlacement(plan, base({ id: "pouf", name: "Пуф", kind: "seating", x: 15, y: 40, w: 30, d: 35, h: 40 }));
    expect(res.issues.some((i) => i.type === "door_swing" && i.withId === "op_wardrobe")).toBe(true);
  });

  it("rejects a cabinet that penetrates the top wall", () => {
    const res = checkPlacement(plan, base({ x: 60, y: -10, w: 60, d: 40 }));
    expect(res.issues.some((i) => i.type === "wall_overlap")).toBe(true);
  });

  it("rejects an item in the bathroom door swing", () => {
    const res = checkPlacement(plan, base({ x: 200, y: 85, w: 40, d: 40 }));
    expect(res.issues.some((i) => i.type === "door_swing")).toBe(true);
  });

  it("rejects an item that blocks the kitchen door passage", () => {
    const res = checkPlacement(plan, base({ x: 84, y: 100, w: 60, d: 40 }));
    expect(res.issues.some((i) => i.type === "opening_blocked" || i.type === "door_swing")).toBe(true);
  });

  it("rejects an item overlapping another item", () => {
    const res = checkPlacement(plan, base({ x: 222, y: 23, w: 30, d: 30 }));
    expect(res.issues.some((i) => i.type === "item_overlap" && i.withId === "it_bench")).toBe(true);
  });

  it("allows a shelf above the doors to span over door swings", () => {
    const res = checkPlacement(plan, base({ id: "shelf", kind: "shelf", x: 120, y: 30, w: 240, d: 40, h: 40, elevation: 215 }));
    expect(res.issues.filter((i) => i.type === "door_swing" || i.type === "opening_blocked")).toEqual([]);
  });

  it("rejects an item placed outside any room", () => {
    const res = checkPlacement(plan, base({ x: 400, y: 400 }));
    expect(res.issues.some((i) => i.type === "outside_room")).toBe(true);
  });

  it("accepts a slim organiser inside the 38×29 niche", () => {
    const wall = plan.walls.find((w) => w.id === "wall_top")!;
    const niche = plan.openings.find((o) => o.id === "op_niche_entry")!;
    const poly = nichePolygon(wall, niche);
    expect(polygonArea(poly)).toBeCloseTo(38 * (10 + 29), 0);
    const res = checkPlacement(plan, base({ id: "org", kind: "storage", x: 131 + 19, y: -14, w: 36, d: 28, h: 100 }));
    expect(res.issues.filter((i) => i.type === "wall_overlap")).toEqual([]);
  });

  it("ignores an item being moved when checking overlaps with itself", () => {
    const bench = plan.items.find((i) => i.id === "it_bench")!;
    const res = checkPlacement(plan, { ...bench, y: bench.y + 2 }, { ignoreItemId: bench.id });
    expect(res.issues.filter((i) => i.type === "item_overlap")).toEqual([]);
  });
});

describe("findFreeWallSegments", () => {
  const plan = seedHallwayPlan();
  it("finds the 71 cm mirror wall segment on the inner face of the entrance wall", () => {
    const segs = findFreeWallSegments(plan, { minLength: 20 });
    const top = segs.filter((s) => s.wallId === "wall_top" && s.roomId === "room_hall");
    expect(top.length).toBeGreaterThan(0);
    const mirrorRun = top.find((s) => s.a.x > 160);
    expect(mirrorRun).toBeDefined();
    expect(mirrorRun!.length).toBeGreaterThan(60);
    expect(mirrorRun!.length).toBeLessThan(75);
    expect(mirrorRun!.inward.y).toBeCloseTo(1, 5);
    // Free depth in front of the mirror wall is limited by the bathroom door swing (starts at y=46).
    expect(mirrorRun!.freeDepth).toBeGreaterThan(40);
    expect(mirrorRun!.freeDepth).toBeLessThan(50);
  });
  it("places an item flush against a segment", () => {
    const segs = findFreeWallSegments(plan, { minLength: 60 });
    const seg = segs.find((s) => s.wallId === "wall_top")!;
    const pose = itemPoseOnSegment(seg, 50, 30, 5);
    expect(pose.y).toBeCloseTo(15, 5);
    expect(pose.rotation).toBeCloseTo(0, 5);
    expect(pose.x).toBeCloseTo(seg.a.x + 5 + 25, 5);
  });
  it("wall polygons have the right area", () => {
    const w = plan.walls[0]!;
    expect(polygonArea(wallPolygon(w))).toBeCloseTo(250 * 10, 5);
  });
});
