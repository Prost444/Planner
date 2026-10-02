import { fmtM2, openingWorld, polygonArea, wallLength } from "./geometry.js";
import { getMaterial } from "./materials.js";
import { PRODUCT_SOURCE_LABELS, type Project } from "./types.js";
import { findFreeWallSegments } from "./validate.js";

const r = (n: number) => Math.round(n * 10) / 10;
const pt = (p: { x: number; y: number }) => `(${r(p.x)},${r(p.y)})`;

/**
 * Compact, deterministic textual description of a project for the agent.
 * Everything the model needs to reason about dimensions is here, in centimetres.
 */
export function describeProject(project: Project, opts: { maxItems?: number; maxProducts?: number } = {}): string {
  const { plan, brief } = project;
  const wallMap = new Map(plan.walls.map((w) => [w.id, w]));
  const lines: string[] = [];
  lines.push(`# Проект «${project.name}» — все размеры в сантиметрах, координаты (x,y): x вправо, y вниз на плане`);
  lines.push(`Высота потолка: ${plan.ceilingHeight}.`);

  lines.push(`\n## Помещения`);
  for (const room of plan.rooms) {
    const area = polygonArea(room.polygon);
    lines.push(`- ${room.id} «${room.name}»: ${room.polygon.map(pt).join(" ")}; площадь ${fmtM2(area)}; пол: ${getMaterial(room.floorMaterialId, "floor").name}`);
  }
  if (plan.rooms.length === 0) lines.push("- (помещения не заданы)");

  lines.push(`\n## Стены (ось стены от a к b; помещение справа по ходу обхода, если стены обходятся по часовой стрелке)`);
  for (const w of plan.walls) {
    lines.push(`- ${w.id}${w.label ? ` «${w.label}»` : ""}: ${pt(w.a)}→${pt(w.b)}, длина ${r(wallLength(w))}, толщина ${w.thickness}, высота ${w.height}, отделка: ${getMaterial(w.materialId, "wall").name}`);
  }

  lines.push(`\n## Проёмы`);
  for (const o of plan.openings) {
    const w = wallMap.get(o.wallId);
    if (!w) continue;
    const ow = openingWorld(w, o);
    const kind: Record<string, string> = { door: "дверь", double_door: "двустворчатая дверь", window: "окно", passage: "проход", niche: "ниша" };
    const extra =
      o.type === "door" || o.type === "double_door"
        ? `, петли: ${o.hinge ?? "start"}, открывается в сторону «${o.swing ?? "left"}» от направления стены, угол ${o.openAngle ?? 90}°`
        : o.type === "niche"
          ? `, глубина ${o.depth ?? 0}`
          : o.type === "window"
            ? `, подоконник ${o.sill}`
            : "";
    lines.push(`- ${o.id}${o.label ? ` «${o.label}»` : ""} (${kind[o.type] ?? o.type}): стена ${o.wallId}, от начала стены ${r(o.offset)}, ширина ${o.width}, высота ${o.height}${extra}; координаты ${pt(ow.start)}–${pt(ow.end)}`);
  }

  lines.push(`\n## Предметы (центр, поворот, Ш×Г×В, низ над полом)`);
  const items = plan.items.slice(0, opts.maxItems ?? 60);
  for (const it of items) {
    lines.push(
      `- ${it.id} «${it.name}» [${it.kind}]: центр ${pt({ x: it.x, y: it.y })}, поворот ${r(it.rotation)}°, ${r(it.w)}×${r(it.d)}×${r(it.h)}, низ на ${r(it.elevation)}${it.productId ? `, товар ${it.productId}` : ""}${it.locked ? ", закреплён" : ""}${it.note ? ` — ${it.note}` : ""}`,
    );
  }
  if (plan.items.length === 0) lines.push("- (предметов нет)");

  const free = findFreeWallSegments(plan, { minLength: 20 });
  lines.push(`\n## Свободные участки стен (по внутренней грани; «глубина» — сколько см свободно перед стеной)`);
  for (const s of free.slice(0, 20)) {
    lines.push(`- ${s.wallId}${s.wallLabel ? ` «${s.wallLabel}»` : ""}: ${pt(s.a)}→${pt(s.b)}, длина ${r(s.length)}, глубина ${s.freeDepth}, нормаль внутрь (${r(s.inward.x)},${r(s.inward.y)})`);
  }
  if (free.length === 0) lines.push("- (нет)");

  if (plan.measurements.length) {
    lines.push(`\n## Замеры пользователя`);
    for (const m of plan.measurements) {
      const d = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
      lines.push(`- ${pt(m.a)}–${pt(m.b)}: ${r(d)}${m.label ? ` (${m.label})` : ""}`);
    }
  }
  if (plan.labels.length) {
    lines.push(`\n## Подписи на плане`);
    for (const l of plan.labels) lines.push(`- ${pt(l)}: ${l.text}`);
  }

  lines.push(`\n## Бриф`);
  lines.push(`Стиль: ${brief.style || "(не задан)"}`);
  if (brief.budget) lines.push(`Бюджет: ${brief.budget} ₽`);
  lines.push(`Пожелания:`);
  for (const w of brief.wishes) lines.push(`- ${w}`);
  lines.push(`Ограничения:`);
  for (const c of brief.constraints) lines.push(`- ${c}`);
  if (brief.notes) lines.push(`Заметки: ${brief.notes}`);

  lines.push(`\n## Каталог найденных товаров`);
  const products = project.catalog.slice(-(opts.maxProducts ?? 40));
  for (const p of products) {
    const dims = p.dims ? `${p.dims.w ?? "?"}×${p.dims.d ?? "?"}×${p.dims.h ?? "?"} (${p.dimsConfidence})` : "размеры неизвестны";
    lines.push(`- ${p.id} [${PRODUCT_SOURCE_LABELS[p.source]}] «${p.title}»: ${p.price ? `${p.price} ${p.currency ?? "RUB"}` : "цена ?"}, ${dims}, статус ${p.status}, ${p.url}`);
  }
  if (project.catalog.length === 0) lines.push("- (пусто)");

  lines.push(`\n## Референсы и фото (id, тип, подпись)`);
  for (const ref of project.references) lines.push(`- ${ref.id} (${ref.kind}): ${ref.caption ?? "без подписи"}`);
  if (project.references.length === 0) lines.push("- (нет)");

  if (project.renders.length) {
    lines.push(`\n## Сгенерированные рендеры`);
    for (const rd of project.renders.slice(-10)) lines.push(`- ${rd.id} (${rd.view}, ${rd.provider}): ${rd.url}`);
  }

  const snaps = Object.entries(project.snapshots);
  lines.push(`\n## Снимки 3D-сцены (доступные ракурсы для generate_render): ${snaps.length ? snaps.map(([k]) => k).join(", ") : "нет — попросите пользователя открыть 3D-вид"}`);
  return lines.join("\n");
}
