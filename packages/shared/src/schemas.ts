import { z } from "zod";

export const Vec2Schema = z.object({ x: z.number().finite(), y: z.number().finite() });

export const WallSchema = z.object({
  id: z.string().min(1),
  a: Vec2Schema,
  b: Vec2Schema,
  thickness: z.number().positive().max(100),
  height: z.number().positive().max(1000),
  materialId: z.string().optional(),
  label: z.string().optional(),
});

export const OpeningSchema = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  type: z.enum(["door", "double_door", "window", "passage", "niche"]),
  offset: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  sill: z.number().min(0),
  hinge: z.enum(["start", "end"]).optional(),
  swing: z.enum(["left", "right"]).optional(),
  openAngle: z.number().min(0).max(180).optional(),
  depth: z.number().min(0).optional(),
  label: z.string().optional(),
});

export const RoomSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  polygon: z.array(Vec2Schema).min(3),
  floorMaterialId: z.string(),
  ceilingHeight: z.number().positive().optional(),
});

export const ItemKindSchema = z.enum(["furniture", "storage", "seating", "table", "decor", "lighting", "rug", "mirror", "hooks", "shelf", "appliance", "plant", "other"]);

export const PlacedItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: ItemKindSchema,
  productId: z.string().optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite(),
  w: z.number().positive(),
  d: z.number().positive(),
  h: z.number().positive(),
  elevation: z.number().min(0),
  color: z.string().optional(),
  imageUrl: z.string().optional(),
  note: z.string().optional(),
  locked: z.boolean().optional(),
});

export const ProductSourceSchema = z.enum(["ozon", "wildberries", "yandex_market", "avito", "lemana", "petrovich", "obi", "maxidom", "hoff", "divan", "ikea", "other"]);

export const ProductSchema = z.object({
  id: z.string().min(1),
  source: ProductSourceSchema,
  title: z.string(),
  url: z.string(),
  price: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  imageUrl: z.string().optional(),
  dims: z.object({ w: z.number().positive().optional(), d: z.number().positive().optional(), h: z.number().positive().optional() }).optional(),
  dimsConfidence: z.enum(["exact", "estimated", "unknown"]),
  rating: z.number().optional(),
  reviews: z.number().optional(),
  notes: z.string().optional(),
  status: z.enum(["candidate", "shortlisted", "rejected", "chosen"]),
  addedAt: z.string(),
  addedBy: z.enum(["agent", "user"]),
});

export const BriefSchema = z.object({
  style: z.string(),
  wishes: z.array(z.string()),
  constraints: z.array(z.string()),
  budget: z.number().nonnegative().optional(),
  notes: z.string(),
});

export const ReferenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["style", "photo", "product", "plan", "other"]),
  url: z.string(),
  caption: z.string().optional(),
  addedAt: z.string(),
});

export const ViewPresetSchema = z.enum(["top", "entrance", "corner_left", "corner_right", "custom"]);

export const RenderSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  view: ViewPresetSchema,
  prompt: z.string(),
  provider: z.string(),
  baseSnapshotUrl: z.string().optional(),
  createdAt: z.string(),
  note: z.string().optional(),
});

export const PlanSchema = z.object({
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  items: z.array(PlacedItemSchema),
  measurements: z.array(z.object({ id: z.string(), a: Vec2Schema, b: Vec2Schema, label: z.string().optional() })),
  labels: z.array(z.object({ id: z.string(), x: z.number(), y: z.number(), text: z.string() })),
  ceilingHeight: z.number().positive(),
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  plan: PlanSchema,
  brief: BriefSchema,
  catalog: z.array(ProductSchema),
  references: z.array(ReferenceSchema),
  renders: z.array(RenderSchema),
  snapshots: z.record(ViewPresetSchema, z.object({ url: z.string(), at: z.string() })).default({}),
});

export type ProjectInput = z.input<typeof ProjectSchema>;
