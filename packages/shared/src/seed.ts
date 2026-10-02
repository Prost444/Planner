import type { Brief, Plan, Project, Reference } from "./types.js";

/**
 * Seed project: the user's hallway, reconstructed from Planner 5D screenshots.
 * Inner hallway rectangle 240 × 126 cm, origin at the top-left inner corner.
 * Walls are drawn clockwise, so the room is on the "right" side of each wall.
 * Everything here is editable in the UI – it is a starting point, not a survey.
 */
export function seedHallwayPlan(): Plan {
  const T = 10; // wall thickness
  const H = 270; // ceiling
  const o = T / 2;
  return {
    ceilingHeight: H,
    walls: [
      { id: "wall_top", a: { x: -o, y: -o }, b: { x: 240 + o, y: -o }, thickness: T, height: H, label: "Стена входа (верх)", materialId: "paint_white" },
      { id: "wall_right", a: { x: 240 + o, y: -o }, b: { x: 240 + o, y: 126 + o }, thickness: T, height: H, label: "Стена справа (ванная)", materialId: "paint_white" },
      { id: "wall_bottom", a: { x: 240 + o, y: 126 + o }, b: { x: -o, y: 126 + o }, thickness: T, height: H, label: "Стена напротив входа (низ)", materialId: "paint_white" },
      { id: "wall_left", a: { x: -o, y: 126 + o }, b: { x: -o, y: -o }, thickness: T, height: H, label: "Стена слева (гардеробная ниша)", materialId: "paint_white" },
      // wardrobe niche enclosure behind the left wall
      { id: "wall_niche_top", a: { x: -68, y: 3 }, b: { x: -o, y: 3 }, thickness: T, height: H, label: "Ниша, верх", materialId: "paint_white" },
      { id: "wall_niche_left", a: { x: -68, y: 3 }, b: { x: -68, y: 123 }, thickness: T, height: H, label: "Ниша, торец", materialId: "paint_white" },
      { id: "wall_niche_bottom", a: { x: -o, y: 123 }, b: { x: -68, y: 123 }, thickness: T, height: H, label: "Ниша, низ", materialId: "paint_white" },
    ],
    openings: [
      { id: "op_entrance", wallId: "wall_top", type: "door", offset: 34 + o, width: 97, height: 205, sill: 0, hinge: "start", swing: "left", openAngle: 70, label: "Входная дверь" },
      { id: "op_niche_entry", wallId: "wall_top", type: "niche", offset: 34 + 97 + o, width: 38, height: 240, sill: 0, depth: 29, swing: "right", label: "Ниша у входа 38×29" },
      { id: "op_bath", wallId: "wall_right", type: "door", offset: 46 + o, width: 75, height: 205, sill: 0, hinge: "start", swing: "right", openAngle: 80, label: "Дверь в ванную" },
      { id: "op_bedroom", wallId: "wall_bottom", type: "door", offset: 240 + o - 229, width: 97, height: 205, sill: 0, hinge: "start", swing: "left", openAngle: 70, label: "Дверь в комнату (спальня)" },
      { id: "op_kitchen", wallId: "wall_bottom", type: "door", offset: 240 + o - 128, width: 88, height: 205, sill: 0, hinge: "end", swing: "left", openAngle: 70, label: "Дверь на кухню" },
      { id: "op_wardrobe", wallId: "wall_left", type: "double_door", offset: 126 + o - 118, width: 110, height: 205, sill: 0, hinge: "start", swing: "right", openAngle: 90, label: "Двери в гардеробную нишу" },
    ],
    rooms: [
      {
        id: "room_hall",
        name: "Прихожая",
        polygon: [
          { x: 0, y: 0 },
          { x: 240, y: 0 },
          { x: 240, y: 126 },
          { x: 0, y: 126 },
        ],
        floorMaterialId: "parquet_oak_herringbone",
      },
      {
        id: "room_wardrobe",
        name: "Гардеробная ниша",
        polygon: [
          { x: -63, y: 8 },
          { x: -10, y: 8 },
          { x: -10, y: 118 },
          { x: -63, y: 118 },
        ],
        floorMaterialId: "parquet_oak_herringbone",
      },
    ],
    items: [
      { id: "it_mirror", name: "Зеркало (существующее)", kind: "mirror", x: 207, y: 1.5, rotation: 0, w: 50, d: 3, h: 120, elevation: 70, color: "#9fc9d6", note: "На 71-см участке стены у входа" },
      { id: "it_switch", name: "Выключатель", kind: "other", x: 178, y: 0.5, rotation: 0, w: 8, d: 1, h: 8, elevation: 95, color: "#eeeeee", locked: true, note: "Должен остаться доступным" },
      { id: "it_bench", name: "Скамейка (существующая)", kind: "seating", x: 222.5, y: 23, rotation: 90, w: 45, d: 35, h: 45, elevation: 0, color: "#b08968", note: "Заменить на советскую тумбу" },
      { id: "it_hooks", name: "Вешалка с крючками (существующая)", kind: "hooks", x: 238.5, y: 23, rotation: 90, w: 40, d: 3, h: 15, elevation: 165, color: "#7f8c8d" },
      { id: "it_doormat", name: "Коврик у входа", kind: "rug", x: 82, y: 28, rotation: 0, w: 70, d: 45, h: 1, elevation: 0, color: "#4a4a4a" },
      { id: "it_mezzanine", name: "Антресоль (существующая)", kind: "shelf", x: 120, y: 96, rotation: 0, w: 240, d: 60, h: 55, elevation: 215, color: "#e9e4da", note: "Над дверями в комнату и кухню; хотим использовать для хранения" },
    ],
    measurements: [],
    labels: [{ id: "lb_entry", x: 82, y: -30, text: "Вход" }],
  };
}

export function seedHallwayBrief(): Brief {
  return {
    style: "mid-century modern: тёплое дерево, латунь, горчичный/оливковый акценты, лаконичные формы",
    wishes: [
      "Заменить мебель на более функциональную и стильную",
      "Отциклевать и сохранить существующий паркет «ёлочка»",
      "Выровнять неровную стену",
      "Использовать антресоль наверху для хранения",
      "Поставить пуф 30×35 см под шарфом на вешалке",
      "Вместо скамейки — советская винтажная тумба",
      "Позже сделать гардеробную в нише слева",
      "Организовать хранение обуви и верхней одежды",
    ],
    constraints: [
      "Планировку, выступы и двери не менять",
      "Площадь прихожей ≈ 3.5 м², ширина 240 см — маленькое пространство",
      "Ниша у входа: 38 см в длину и 29 см в глубину — шкаф туда не помещается",
      "Стена с зеркалом — 71 см (там зеркало, а не окно)",
      "Выключатель на стене при входе должен остаться доступным",
      "Слева — дверь в гардеробную нишу, справа — дверь в ванную, напротив входа — двери в спальню и на кухню",
      "Проходы к дверям не перекрывать, двери должны открываться",
    ],
    notes: "Размеры дверей: входная 97 см, в ванную 75 см, в спальню/кухню 88–97 см. Высота потолка 270 см (уточнить). Какая из нижних дверей ведёт в спальню, а какая на кухню — уточнить у пользователя.",
  };
}

export function seedHallwayReferences(now: string): Reference[] {
  return [
    { id: "ref_seed_1", kind: "photo", url: "/uploads/seed/hallway-3d-1.webp", caption: "Текущая модель прихожей в Planner 5D (вид 1)", addedAt: now },
    { id: "ref_seed_2", kind: "photo", url: "/uploads/seed/hallway-3d-2.webp", caption: "Текущая модель прихожей в Planner 5D (вид 2)", addedAt: now },
    { id: "ref_seed_3", kind: "photo", url: "/uploads/seed/hallway-3d-top.webp", caption: "Текущая модель, вид сверху", addedAt: now },
    { id: "ref_seed_4", kind: "plan", url: "/uploads/seed/hallway-plan-2d.webp", caption: "2D-план с размерами из Planner 5D", addedAt: now },
  ];
}

export function seedHallwayProject(id: string, now: string, withReferences = true): Project {
  return {
    id,
    name: "Прихожая — однушка",
    createdAt: now,
    updatedAt: now,
    plan: seedHallwayPlan(),
    brief: seedHallwayBrief(),
    catalog: [],
    references: withReferences ? seedHallwayReferences(now) : [],
    renders: [],
    snapshots: {},
  };
}

export function emptyProject(id: string, now: string, name = "Новый проект"): Project {
  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    plan: { ceilingHeight: 270, walls: [], openings: [], rooms: [], items: [], measurements: [], labels: [] },
    brief: { style: "", wishes: [], constraints: [], notes: "" },
    catalog: [],
    references: [],
    renders: [],
    snapshots: {},
  };
}
