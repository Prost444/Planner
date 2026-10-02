export type MaterialCategory = "floor" | "wall";
export type MaterialPattern = "herringbone" | "planks" | "tiles" | "plain" | "concrete" | "carpet" | "hex";

export interface Material {
  id: string;
  name: string;
  category: MaterialCategory;
  /** Base colour (hex). */
  color: string;
  /** Secondary colour used for seams / grain. */
  accent?: string;
  pattern: MaterialPattern;
  /** Pattern scale in cm (plank length / tile size). */
  scale?: number;
}

export const MATERIALS: Material[] = [
  { id: "parquet_oak_herringbone", name: "Паркет дуб «ёлочка» (отциклёванный)", category: "floor", color: "#d9a35b", accent: "#b9833f", pattern: "herringbone", scale: 40 },
  { id: "parquet_oak_herringbone_dark", name: "Паркет «ёлочка», тёмный тон", category: "floor", color: "#9b6a3a", accent: "#7a5028", pattern: "herringbone", scale: 40 },
  { id: "parquet_walnut_planks", name: "Паркетная доска орех", category: "floor", color: "#7d5537", accent: "#5e3f28", pattern: "planks", scale: 120 },
  { id: "laminate_light", name: "Ламинат светлый дуб", category: "floor", color: "#e2c89a", accent: "#cdb183", pattern: "planks", scale: 130 },
  { id: "tile_terrazzo", name: "Керамогранит терраццо", category: "floor", color: "#d8d4cc", accent: "#b7b1a6", pattern: "tiles", scale: 60 },
  { id: "tile_black_white", name: "Плитка чёрно-белая", category: "floor", color: "#efefef", accent: "#2b2b2b", pattern: "tiles", scale: 20 },
  { id: "tile_hex_graphite", name: "Плитка гексагон графит", category: "floor", color: "#4a4d52", accent: "#2f3135", pattern: "hex", scale: 15 },
  { id: "concrete_micro", name: "Микроцемент", category: "floor", color: "#b9b6b0", pattern: "concrete" },
  { id: "carpet_wool", name: "Ковролин шерсть", category: "floor", color: "#c7b79a", pattern: "carpet" },
  { id: "paint_white", name: "Краска белая", category: "wall", color: "#f4f1ea", pattern: "plain" },
  { id: "paint_warm_grey", name: "Краска тёплый серый", category: "wall", color: "#d8d2c8", pattern: "plain" },
  { id: "paint_sage", name: "Краска шалфей", category: "wall", color: "#a9b59b", pattern: "plain" },
  { id: "paint_terracotta", name: "Краска терракота", category: "wall", color: "#c4714f", pattern: "plain" },
  { id: "paint_olive", name: "Краска олива", category: "wall", color: "#6f7a4a", pattern: "plain" },
  { id: "paint_navy", name: "Краска тёмно-синий", category: "wall", color: "#2f3e5c", pattern: "plain" },
  { id: "paint_mustard", name: "Краска горчица", category: "wall", color: "#d2a53c", pattern: "plain" },
  { id: "panels_oak", name: "Рейки / панели дуб", category: "wall", color: "#c89a63", accent: "#a87c48", pattern: "planks", scale: 6 },
  { id: "wallpaper_graphic", name: "Обои с графикой", category: "wall", color: "#e8e1d4", accent: "#8a7d6b", pattern: "tiles", scale: 30 },
  { id: "tile_white_wall", name: "Плитка белая «кабанчик»", category: "wall", color: "#f7f7f5", accent: "#cfcfcc", pattern: "tiles", scale: 20 },
];

export const DEFAULT_FLOOR_MATERIAL = "parquet_oak_herringbone";
export const DEFAULT_WALL_MATERIAL = "paint_white";

export function getMaterial(id: string | undefined, category: MaterialCategory): Material {
  const found = MATERIALS.find((m) => m.id === id);
  if (found) return found;
  return MATERIALS.find((m) => m.id === (category === "floor" ? DEFAULT_FLOOR_MATERIAL : DEFAULT_WALL_MATERIAL))!;
}

export const ITEM_KIND_LABELS: Record<string, string> = {
  furniture: "Мебель",
  storage: "Хранение",
  seating: "Сидение",
  table: "Стол / консоль",
  decor: "Декор",
  lighting: "Свет",
  rug: "Ковёр",
  mirror: "Зеркало",
  hooks: "Крючки / вешалка",
  shelf: "Полка / антресоль",
  appliance: "Техника",
  plant: "Растение",
  other: "Другое",
};

export const ITEM_KIND_COLORS: Record<string, string> = {
  furniture: "#b08968",
  storage: "#8d6e4f",
  seating: "#c9a27e",
  table: "#a47c5b",
  decor: "#c08ca3",
  lighting: "#f0c766",
  rug: "#9dafc2",
  mirror: "#9fc9d6",
  hooks: "#7f8c8d",
  shelf: "#a99e8f",
  appliance: "#b4b4b4",
  plant: "#7fa86f",
  other: "#bdbdbd",
};
