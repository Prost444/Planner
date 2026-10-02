/**
 * Core domain model. All lengths are in centimetres, all angles in degrees.
 * 2D coordinates: x grows to the right, y grows downwards (screen space),
 * so a top-down 2D plan and the 3D "top" camera look identical.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
  /** Material id from MATERIALS (paint / wallpaper / tiles). */
  materialId?: string;
  label?: string;
}

export type OpeningType = "door" | "double_door" | "window" | "passage" | "niche";

export interface Opening {
  id: string;
  wallId: string;
  type: OpeningType;
  /** Distance (cm) from wall.a along the wall to the start of the opening. */
  offset: number;
  width: number;
  height: number;
  /** Height of the bottom edge above the floor. 0 for doors/passages. */
  sill: number;
  /** For doors: which end of the opening carries the hinge, relative to wall direction a→b. */
  hinge?: "start" | "end";
  /** For doors: which side of the wall the leaf opens into. "left" is the left side of direction a→b. */
  swing?: "left" | "right";
  /** For doors: how far the leaf is open in degrees (0 = closed, 90 = fully open). */
  openAngle?: number;
  /** For niches: how deep the recess goes beyond the wall face (cm). */
  depth?: number;
  label?: string;
}

export interface Room {
  id: string;
  name: string;
  polygon: Vec2[];
  floorMaterialId: string;
  ceilingHeight?: number;
}

export type ItemKind =
  | "furniture"
  | "storage"
  | "seating"
  | "table"
  | "decor"
  | "lighting"
  | "rug"
  | "mirror"
  | "hooks"
  | "shelf"
  | "appliance"
  | "plant"
  | "other";

export interface PlacedItem {
  id: string;
  name: string;
  kind: ItemKind;
  productId?: string;
  /** Centre of the footprint. */
  x: number;
  y: number;
  /** Rotation around the centre, degrees, clockwise on screen. 0 = width along +x. */
  rotation: number;
  w: number;
  d: number;
  h: number;
  /** Height of the item's bottom face above the floor (wall-mounted / mezzanine items). */
  elevation: number;
  color?: string;
  imageUrl?: string;
  note?: string;
  locked?: boolean;
}

export type ProductSource =
  | "ozon"
  | "wildberries"
  | "yandex_market"
  | "avito"
  | "lemana"
  | "petrovich"
  | "obi"
  | "maxidom"
  | "hoff"
  | "divan"
  | "ikea"
  | "other";

export const PRODUCT_SOURCES: ProductSource[] = [
  "ozon",
  "wildberries",
  "yandex_market",
  "avito",
  "lemana",
  "petrovich",
  "obi",
  "maxidom",
  "hoff",
  "divan",
  "ikea",
  "other",
];

export const PRODUCT_SOURCE_LABELS: Record<ProductSource, string> = {
  ozon: "Ozon",
  wildberries: "Wildberries",
  yandex_market: "Яндекс Маркет",
  avito: "Авито",
  lemana: "Лемана ПРО",
  petrovich: "Петрович",
  obi: "OBI",
  maxidom: "Максидом",
  hoff: "Hoff",
  divan: "Divan.ru",
  ikea: "IKEA (параллельный импорт)",
  other: "Другое",
};

export interface ProductDims {
  w?: number;
  d?: number;
  h?: number;
}

export type DimsConfidence = "exact" | "estimated" | "unknown";

export interface Product {
  id: string;
  source: ProductSource;
  title: string;
  url: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  dims?: ProductDims;
  dimsConfidence: DimsConfidence;
  rating?: number;
  reviews?: number;
  notes?: string;
  status: "candidate" | "shortlisted" | "rejected" | "chosen";
  addedAt: string;
  addedBy: "agent" | "user";
}

export interface Brief {
  style: string;
  wishes: string[];
  constraints: string[];
  budget?: number;
  notes: string;
}

export type ReferenceKind = "style" | "photo" | "product" | "plan" | "other";

export interface Reference {
  id: string;
  kind: ReferenceKind;
  url: string;
  caption?: string;
  addedAt: string;
}

export type ViewPreset = "top" | "entrance" | "corner_left" | "corner_right" | "custom";

export const VIEW_PRESETS: ViewPreset[] = ["top", "entrance", "corner_left", "corner_right", "custom"];

export const VIEW_PRESET_LABELS: Record<ViewPreset, string> = {
  top: "Сверху",
  entrance: "От входа",
  corner_left: "Из левого угла",
  corner_right: "Из правого угла",
  custom: "Текущая камера",
};

export interface Render {
  id: string;
  url: string;
  view: ViewPreset;
  prompt: string;
  provider: string;
  baseSnapshotUrl?: string;
  createdAt: string;
  note?: string;
}

export interface Measurement {
  id: string;
  a: Vec2;
  b: Vec2;
  label?: string;
}

export interface TextLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface Plan {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: PlacedItem[];
  measurements: Measurement[];
  labels: TextLabel[];
  ceilingHeight: number;
}

export interface Snapshot {
  url: string;
  at: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  plan: Plan;
  brief: Brief;
  catalog: Product[];
  references: Reference[];
  renders: Render[];
  snapshots: Partial<Record<ViewPreset, Snapshot>>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

/** Chat transcript as shown in the UI (the raw Claude transcript lives on the server). */
export interface ToolEvent {
  id: string;
  name: string;
  input?: unknown;
  summary?: string;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[];
  events?: ToolEvent[];
  createdAt: string;
}

/** Server → client stream events during an agent turn. */
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; summary: string; isError?: boolean }
  | { type: "project_updated"; project: Project }
  | { type: "render"; render: Render }
  | { type: "status"; text: string }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };

export interface PlacementIssue {
  type: "wall_overlap" | "item_overlap" | "door_swing" | "opening_blocked" | "outside_room" | "invalid";
  message: string;
  withId?: string;
}

export interface PlacementResult {
  ok: boolean;
  issues: PlacementIssue[];
}

export interface FreeWallSegment {
  wallId: string;
  wallLabel?: string;
  /** Start / end points of the free run on the inner face of the wall. */
  a: Vec2;
  b: Vec2;
  length: number;
  /** Unit normal pointing from the wall into the room. */
  inward: Vec2;
  /** How far an object can protrude from the wall before hitting something (cm, capped). */
  freeDepth: number;
  /** Room this face belongs to. */
  roomId?: string;
}
