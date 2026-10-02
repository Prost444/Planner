import { z } from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import {
  checkPlacement,
  describeProject,
  findFreeWallSegments,
  getMaterial,
  MATERIALS,
  openingWorld,
  polygonArea,
  PRODUCT_SOURCE_LABELS,
  wallLength,
  type ItemKind,
  type Opening,
  type PlacedItem,
  type PlacementIssue,
  type Product,
  type ProductSource,
  type Project,
  type Render,
  type ViewPreset,
  type Wall,
} from "@planner/shared";
import { config } from "../config.js";
import { normalizeForVision, type ImageBytes } from "../images.js";
import { sourceFromUrl } from "../market/dims.js";
import { fetchPageMeta } from "../market/pagemeta.js";
import { searchProducts } from "../market/search.js";
import { fetchWithTimeout } from "../market/types.js";
import { getImageProvider, type RenderRequest } from "../render/providers.js";
import { newId, now, readUpload, saveUpload } from "../storage.js";

export interface ToolOutput {
  text: string;
  images?: ImageBytes[];
  isError?: boolean;
}

export interface ToolContext {
  project: Project;
  /** Persist the project and notify the client. */
  save(): Promise<void>;
  status(text: string): void;
  onRender(render: Render): void;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  mutates?: boolean;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>;
}

const def = <S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> => t;

const r1 = (n: number) => Math.round(n * 10) / 10;
const issuesText = (issues: PlacementIssue[]) => issues.map((i) => `- ${i.message}${i.withId ? ` (${i.withId})` : ""}`).join("\n");

const ItemKindSchema = z.enum(["furniture", "storage", "seating", "table", "decor", "lighting", "rug", "mirror", "hooks", "shelf", "appliance", "plant", "other"]);
const SourceSchema = z.enum(["ozon", "wildberries", "yandex_market", "avito", "lemana", "petrovich", "obi", "maxidom", "hoff", "divan", "ikea", "other"]);
const ViewSchema = z.enum(["top", "entrance", "corner_left", "corner_right", "custom"]);

function findItem(p: Project, id: string): PlacedItem {
  const it = p.plan.items.find((i) => i.id === id);
  if (!it) throw new Error(`Предмет ${id} не найден`);
  return it;
}
function findWall(p: Project, id: string): Wall {
  const w = p.plan.walls.find((i) => i.id === id);
  if (!w) throw new Error(`Стена ${id} не найдена`);
  return w;
}
function findOpening(p: Project, id: string): Opening {
  const o = p.plan.openings.find((i) => i.id === id);
  if (!o) throw new Error(`Проём ${id} не найден`);
  return o;
}
function findProduct(p: Project, id: string): Product {
  const pr = p.catalog.find((i) => i.id === id);
  if (!pr) throw new Error(`Товар ${id} не найден в каталоге`);
  return pr;
}

async function fetchRemoteImage(url: string): Promise<ImageBytes | null> {
  try {
    if (url.startsWith("/uploads/")) {
      const local = await readUpload(url);
      return local ? { data: local.data, mediaType: local.mediaType } : null;
    }
    const res = await fetchWithTimeout(url, { headers: { accept: "image/*" } }, 8000);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 12_000_000) return null;
    return { data: buf, mediaType: ct };
  } catch {
    return null;
  }
}

/** Cache a product picture locally (keeps catalog cards working when CDNs block hotlinking). */
async function cacheProductImage(url: string | undefined): Promise<string | undefined> {
  if (!url || url.startsWith("/uploads/")) return url;
  const img = await fetchRemoteImage(url);
  if (!img) return url;
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[img.mediaType] ?? "bin";
  return saveUpload("products", img.data, ext);
}

function placementSummary(it: PlacedItem) {
  return `${it.id} «${it.name}» центр (${r1(it.x)},${r1(it.y)}), поворот ${r1(it.rotation)}°, ${r1(it.w)}×${r1(it.d)}×${r1(it.h)}, низ на ${r1(it.elevation)}`;
}

function suggestSegments(project: Project, w: number, d: number): string {
  const segs = findFreeWallSegments(project.plan, { minLength: Math.min(w, d) }).filter((s) => s.length >= Math.min(w, d) && s.freeDepth >= Math.min(w, d));
  if (!segs.length) return "Свободных участков под такой размер нет — рассмотрите меньший предмет, навесной вариант или антресоль.";
  return (
    "Подходящие свободные участки стен:\n" +
    segs
      .slice(0, 6)
      .map((s) => `- ${s.wallId}${s.wallLabel ? ` «${s.wallLabel}»` : ""}: (${r1(s.a.x)},${r1(s.a.y)})→(${r1(s.b.x)},${r1(s.b.y)}), длина ${r1(s.length)}, свободно перед стеной ${s.freeDepth}`)
      .join("\n")
  );
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const getProjectState = def({
  name: "get_project_state",
  description: "Полное актуальное состояние проекта: стены, проёмы, предметы, свободные участки стен, бриф, каталог, референсы. Все размеры в см.",
  schema: z.object({}),
  async run(_input, ctx) {
    return { text: describeProject(ctx.project) };
  },
});

export const updateBrief = def({
  name: "update_brief",
  description: "Сохранить в бриф пожелания, ограничения, стиль, бюджет и заметки. Вызывай каждый раз, когда пользователь сообщает что-то важное о квартире или своих предпочтениях.",
  schema: z.object({
    style: z.string().optional().describe("Стиль интерьера одной фразой"),
    add_wishes: z.array(z.string()).optional().describe("Новые пожелания"),
    add_constraints: z.array(z.string()).optional().describe("Новые ограничения / факты о помещении"),
    remove_entries: z.array(z.string()).optional().describe("Точный текст записей, которые надо удалить"),
    budget_rub: z.number().optional(),
    notes: z.string().optional().describe("Свободные заметки (заменяют старые)"),
  }),
  mutates: true,
  async run(input, ctx) {
    const b = ctx.project.brief;
    if (input.style !== undefined) b.style = input.style;
    if (input.budget_rub !== undefined) b.budget = input.budget_rub;
    if (input.notes !== undefined) b.notes = input.notes;
    for (const w of input.add_wishes ?? []) if (!b.wishes.includes(w)) b.wishes.push(w);
    for (const c of input.add_constraints ?? []) if (!b.constraints.includes(c)) b.constraints.push(c);
    if (input.remove_entries?.length) {
      const rm = new Set(input.remove_entries);
      b.wishes = b.wishes.filter((x) => !rm.has(x));
      b.constraints = b.constraints.filter((x) => !rm.has(x));
    }
    await ctx.save();
    return { text: `Бриф обновлён. Стиль: ${b.style || "—"}. Пожеланий: ${b.wishes.length}, ограничений: ${b.constraints.length}.` };
  },
});

export const searchProductsTool = def({
  name: "search_products",
  description:
    "Поиск товаров на маркетплейсах (Wildberries через API; Ozon, Яндекс Маркет, Авито, Лемана ПРО, Петрович и др. — через поисковый провайдер, если настроен). Найденные товары автоматически добавляются в каталог как candidate. Если для источника нет провайдера, инструмент скажет об этом — тогда используй web_search.",
  schema: z.object({
    query: z.string().describe("Поисковый запрос по-русски, с размерами если важны, например «пуф 30x35 см велюр горчичный»"),
    sources: z.array(SourceSchema).optional().describe("Где искать; по умолчанию основные маркетплейсы"),
    max_price_rub: z.number().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  mutates: true,
  async run(input, ctx) {
    ctx.status(`Ищу: ${input.query}`);
    const out = await searchProducts(input.query, { sources: input.sources as ProductSource[] | undefined, maxPrice: input.max_price_rub, limit: input.limit });
    const added: Product[] = [];
    for (const f of out.products) {
      const key = f.url.replace(/[?#].*$/, "");
      let existing = ctx.project.catalog.find((p) => p.url.replace(/[?#].*$/, "") === key);
      if (!existing) {
        existing = {
          id: newId("prod"),
          source: f.source,
          title: f.title,
          url: f.url,
          price: f.price,
          currency: f.currency ?? "RUB",
          imageUrl: f.imageUrl,
          dims: f.dims,
          dimsConfidence: f.dimsConfidence,
          rating: f.rating,
          reviews: f.reviews,
          notes: f.snippet,
          status: "candidate",
          addedAt: now(),
          addedBy: "agent",
        };
        ctx.project.catalog.push(existing);
      }
      added.push(existing);
    }
    if (added.length) await ctx.save();
    const lines = added.map((p) => {
      const dims = p.dims ? `${p.dims.w ?? "?"}×${p.dims.d ?? "?"}×${p.dims.h ?? "?"} (${p.dimsConfidence})` : "размеры неизвестны";
      return `- ${p.id} [${PRODUCT_SOURCE_LABELS[p.source]}] «${p.title}» — ${p.price ? `${p.price} ₽` : "цена ?"}, ${dims}${p.rating ? `, рейтинг ${p.rating}${p.reviews ? ` (${p.reviews})` : ""}` : ""}, ${p.url}`;
    });
    return {
      text: [`Найдено ${added.length} товаров по запросу «${input.query}».`, ...lines, ...out.notes.map((n) => `Примечание: ${n}`), added.length ? "Уточни размеры через fetch_page_info перед расстановкой, если они estimated/unknown." : ""].filter(Boolean).join("\n"),
    };
  },
});

export const fetchPageInfo = def({
  name: "fetch_page_info",
  description: "Открыть страницу товара и вытащить название, цену, картинку, размеры (Ш×Г×В) и характеристики. Для Wildberries использует официальный JSON карточки. Некоторые сайты блокируют ботов — тогда вернётся ошибка, и нужно опираться на web_fetch/web_search.",
  schema: z.object({ url: z.string().url() }),
  async run(input, ctx) {
    ctx.status(`Читаю страницу ${new URL(input.url).hostname}`);
    const m = await fetchPageMeta(input.url);
    const dims = m.dims ? `${m.dims.w ?? "?"}×${m.dims.d ?? "?"}×${m.dims.h ?? "?"} см (${m.dimsConfidence})` : "не найдены";
    const specs = m.specs ? Object.entries(m.specs).slice(0, 25).map(([k, v]) => `${k}: ${v}`).join("; ") : "";
    return {
      text: [
        `URL: ${m.url} [${PRODUCT_SOURCE_LABELS[m.source]}]`,
        m.error ? `Ошибка: ${m.error}` : "",
        m.title ? `Название: ${m.title}` : "",
        m.price ? `Цена: ${m.price} ${m.currency ?? "RUB"}` : "",
        `Размеры: ${dims}`,
        m.imageUrl ? `Картинка: ${m.imageUrl}` : "",
        specs ? `Характеристики: ${specs}` : "",
        m.description ? `Описание: ${m.description.slice(0, 600)}` : "",
        !m.specs && m.textExcerpt ? `Текст страницы: ${m.textExcerpt.slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      isError: Boolean(m.error) && !m.title,
    };
  },
});

export const addProduct = def({
  name: "add_product",
  description: "Зарегистрировать найденный товар в каталоге проекта (после web_search/web_fetch). Указывай размеры в см и честную уверенность.",
  schema: z.object({
    title: z.string(),
    url: z.string().url(),
    source: SourceSchema.optional().describe("Если не указан — определяется по домену"),
    price_rub: z.number().optional(),
    image_url: z.string().optional(),
    width_cm: z.number().positive().optional(),
    depth_cm: z.number().positive().optional(),
    height_cm: z.number().positive().optional(),
    dims_confidence: z.enum(["exact", "estimated", "unknown"]).optional(),
    notes: z.string().optional().describe("Почему подходит / материал / цвет"),
    status: z.enum(["candidate", "shortlisted", "rejected", "chosen"]).optional(),
  }),
  mutates: true,
  async run(input, ctx) {
    const key = input.url.replace(/[?#].*$/, "");
    let p = ctx.project.catalog.find((x) => x.url.replace(/[?#].*$/, "") === key);
    const dims = input.width_cm || input.depth_cm || input.height_cm ? { w: input.width_cm, d: input.depth_cm, h: input.height_cm } : undefined;
    if (!p) {
      p = {
        id: newId("prod"),
        source: input.source ?? sourceFromUrl(input.url),
        title: input.title,
        url: input.url,
        price: input.price_rub,
        currency: "RUB",
        imageUrl: await cacheProductImage(input.image_url),
        dims,
        dimsConfidence: input.dims_confidence ?? (dims ? "estimated" : "unknown"),
        notes: input.notes,
        status: input.status ?? "candidate",
        addedAt: now(),
        addedBy: "agent",
      };
      ctx.project.catalog.push(p);
    } else {
      p.title = input.title || p.title;
      if (input.price_rub !== undefined) p.price = input.price_rub;
      if (input.image_url) p.imageUrl = await cacheProductImage(input.image_url);
      if (dims) p.dims = { ...(p.dims ?? {}), ...dims };
      if (input.dims_confidence) p.dimsConfidence = input.dims_confidence;
      if (input.notes) p.notes = input.notes;
      if (input.status) p.status = input.status;
    }
    await ctx.save();
    return { text: `Товар ${p.id} сохранён: «${p.title}», ${p.price ? `${p.price} ₽` : "цена ?"}, размеры ${p.dims ? `${p.dims.w ?? "?"}×${p.dims.d ?? "?"}×${p.dims.h ?? "?"}` : "неизвестны"} (${p.dimsConfidence}).` };
  },
});

export const updateProduct = def({
  name: "update_product",
  description: "Изменить статус (shortlisted/chosen/rejected), размеры, цену, картинку или заметку товара из каталога.",
  schema: z.object({
    product_id: z.string(),
    status: z.enum(["candidate", "shortlisted", "rejected", "chosen"]).optional(),
    price_rub: z.number().optional(),
    image_url: z.string().optional(),
    width_cm: z.number().positive().optional(),
    depth_cm: z.number().positive().optional(),
    height_cm: z.number().positive().optional(),
    dims_confidence: z.enum(["exact", "estimated", "unknown"]).optional(),
    notes: z.string().optional(),
  }),
  mutates: true,
  async run(input, ctx) {
    const p = findProduct(ctx.project, input.product_id);
    if (input.status) p.status = input.status;
    if (input.price_rub !== undefined) p.price = input.price_rub;
    if (input.image_url) p.imageUrl = await cacheProductImage(input.image_url);
    if (input.width_cm || input.depth_cm || input.height_cm) p.dims = { ...(p.dims ?? {}), ...(input.width_cm ? { w: input.width_cm } : {}), ...(input.depth_cm ? { d: input.depth_cm } : {}), ...(input.height_cm ? { h: input.height_cm } : {}) };
    if (input.dims_confidence) p.dimsConfidence = input.dims_confidence;
    if (input.notes) p.notes = input.notes;
    // keep linked items in sync with exact dims
    if (p.dims && p.dimsConfidence === "exact") {
      for (const it of ctx.project.plan.items) {
        if (it.productId === p.id) {
          if (p.dims.w) it.w = p.dims.w;
          if (p.dims.d) it.d = p.dims.d;
          if (p.dims.h) it.h = p.dims.h;
        }
      }
    }
    await ctx.save();
    return { text: `Товар ${p.id} обновлён: статус ${p.status}, размеры ${p.dims ? `${p.dims.w ?? "?"}×${p.dims.d ?? "?"}×${p.dims.h ?? "?"}` : "—"} (${p.dimsConfidence}).` };
  },
});

const placementFields = {
  x_cm: z.number().describe("Центр предмета по x"),
  y_cm: z.number().describe("Центр предмета по y"),
  rotation_deg: z.number().optional().describe("Поворот по часовой; 0 — ширина вдоль оси x. У стены сверху/снизу — 0 или 180, у стен слева/справа — 90 или 270"),
  elevation_cm: z.number().min(0).optional().describe("Высота низа над полом (навесные полки, антресоль)"),
};

export const placeItem = def({
  name: "place_item",
  description:
    "Поставить предмет на план. Если указан product_id, размеры берутся из каталога (можно переопределить). Инструмент проверяет пересечения со стенами, другими предметами, зонами открывания дверей и проходами; при конфликтах предмет НЕ ставится, а возвращается список проблем и подсказки по свободным участкам. Координаты — центр предмета.",
  schema: z.object({
    name: z.string(),
    kind: ItemKindSchema,
    product_id: z.string().optional(),
    width_cm: z.number().positive().optional(),
    depth_cm: z.number().positive().optional(),
    height_cm: z.number().positive().optional(),
    ...placementFields,
    color: z.string().optional().describe("hex-цвет для схемы, например #c9a27e"),
    note: z.string().optional(),
    force: z.boolean().optional().describe("Поставить несмотря на конфликты (только если пользователь настаивает)"),
  }),
  mutates: true,
  async run(input, ctx) {
    const product = input.product_id ? findProduct(ctx.project, input.product_id) : undefined;
    const w = input.width_cm ?? product?.dims?.w;
    const d = input.depth_cm ?? product?.dims?.d;
    const h = input.height_cm ?? product?.dims?.h;
    if (!w || !d || !h) return { text: "Нужны все три размера (ширина, глубина, высота) — у товара они не известны. Уточни через fetch_page_info или задай вручную.", isError: true };
    const item: PlacedItem = {
      id: newId("it"),
      name: input.name,
      kind: input.kind as ItemKind,
      productId: product?.id,
      x: input.x_cm,
      y: input.y_cm,
      rotation: input.rotation_deg ?? 0,
      w,
      d,
      h,
      elevation: input.elevation_cm ?? 0,
      color: input.color,
      imageUrl: product?.imageUrl,
      note: input.note,
    };
    const res = checkPlacement(ctx.project.plan, item);
    if (!res.ok && !input.force) {
      return { text: `Не поставлено — конфликты:\n${issuesText(res.issues)}\n${suggestSegments(ctx.project, w, d)}`, isError: true };
    }
    ctx.project.plan.items.push(item);
    if (product && product.status === "candidate") product.status = "shortlisted";
    await ctx.save();
    return { text: `Поставлено: ${placementSummary(item)}${res.ok ? "" : `\nВнимание, конфликты проигнорированы (force):\n${issuesText(res.issues)}`}` };
  },
});

export const moveItem = def({
  name: "move_item",
  description: "Переместить/повернуть существующий предмет. Проверяет конфликты так же, как place_item.",
  schema: z.object({
    item_id: z.string(),
    x_cm: z.number().optional(),
    y_cm: z.number().optional(),
    rotation_deg: z.number().optional(),
    elevation_cm: z.number().min(0).optional(),
    force: z.boolean().optional(),
  }),
  mutates: true,
  async run(input, ctx) {
    const it = findItem(ctx.project, input.item_id);
    if (it.locked) return { text: `Предмет ${it.id} закреплён пользователем (${it.note ?? "без заметки"}) — двигать нельзя без разрешения.`, isError: true };
    const moved: PlacedItem = { ...it, x: input.x_cm ?? it.x, y: input.y_cm ?? it.y, rotation: input.rotation_deg ?? it.rotation, elevation: input.elevation_cm ?? it.elevation };
    const res = checkPlacement(ctx.project.plan, moved, { ignoreItemId: it.id });
    if (!res.ok && !input.force) return { text: `Не перемещено — конфликты:\n${issuesText(res.issues)}\n${suggestSegments(ctx.project, it.w, it.d)}`, isError: true };
    Object.assign(it, moved);
    await ctx.save();
    return { text: `Перемещено: ${placementSummary(it)}${res.ok ? "" : "\n(конфликты проигнорированы по force)"}` };
  },
});

export const updateItem = def({
  name: "update_item",
  description: "Изменить название, тип, размеры, цвет, заметку или привязку к товару у предмета.",
  schema: z.object({
    item_id: z.string(),
    name: z.string().optional(),
    kind: ItemKindSchema.optional(),
    product_id: z.string().optional(),
    width_cm: z.number().positive().optional(),
    depth_cm: z.number().positive().optional(),
    height_cm: z.number().positive().optional(),
    color: z.string().optional(),
    note: z.string().optional(),
  }),
  mutates: true,
  async run(input, ctx) {
    const it = findItem(ctx.project, input.item_id);
    const next: PlacedItem = { ...it };
    if (input.name) next.name = input.name;
    if (input.kind) next.kind = input.kind as ItemKind;
    if (input.product_id) {
      const p = findProduct(ctx.project, input.product_id);
      next.productId = p.id;
      next.imageUrl = p.imageUrl;
    }
    if (input.width_cm) next.w = input.width_cm;
    if (input.depth_cm) next.d = input.depth_cm;
    if (input.height_cm) next.h = input.height_cm;
    if (input.color) next.color = input.color;
    if (input.note !== undefined) next.note = input.note;
    const res = checkPlacement(ctx.project.plan, next, { ignoreItemId: it.id });
    Object.assign(it, next);
    await ctx.save();
    return { text: `Обновлено: ${placementSummary(it)}${res.ok ? "" : `\nВнимание, после изменения есть конфликты:\n${issuesText(res.issues)}`}` };
  },
});

export const removeItem = def({
  name: "remove_item",
  description: "Убрать предмет с плана.",
  schema: z.object({ item_id: z.string() }),
  mutates: true,
  async run(input, ctx) {
    const it = findItem(ctx.project, input.item_id);
    if (it.locked) return { text: `Предмет ${it.id} закреплён — удалять нельзя без разрешения пользователя.`, isError: true };
    ctx.project.plan.items = ctx.project.plan.items.filter((i) => i.id !== it.id);
    await ctx.save();
    return { text: `Удалён ${it.id} «${it.name}».` };
  },
});

export const checkFit = def({
  name: "check_fit",
  description: "Проверить, встанет ли предмет заданных размеров в точку плана (без изменения проекта). Возвращает конфликты или подтверждение.",
  schema: z.object({
    width_cm: z.number().positive(),
    depth_cm: z.number().positive(),
    height_cm: z.number().positive().optional(),
    kind: ItemKindSchema.optional(),
    ...placementFields,
  }),
  async run(input, ctx) {
    const probe: PlacedItem = { id: "probe", name: "probe", kind: (input.kind as ItemKind) ?? "furniture", x: input.x_cm, y: input.y_cm, rotation: input.rotation_deg ?? 0, w: input.width_cm, d: input.depth_cm, h: input.height_cm ?? 50, elevation: input.elevation_cm ?? 0 };
    const res = checkPlacement(ctx.project.plan, probe);
    return { text: res.ok ? `Помещается: центр (${input.x_cm},${input.y_cm}), ${input.width_cm}×${input.depth_cm}, поворот ${probe.rotation}°.` : `Конфликты:\n${issuesText(res.issues)}\n${suggestSegments(ctx.project, input.width_cm, input.depth_cm)}` };
  },
});

export const freeWallSegments = def({
  name: "find_free_wall_segments",
  description: "Список свободных участков стен (внутренняя грань) с длиной, нормалью внутрь помещения и свободной глубиной перед стеной. Используй для выбора места под мебель.",
  schema: z.object({ min_length_cm: z.number().positive().optional() }),
  async run(input, ctx) {
    const segs = findFreeWallSegments(ctx.project.plan, { minLength: input.min_length_cm ?? 20 });
    if (!segs.length) return { text: "Свободных участков нет." };
    return {
      text: segs
        .map(
          (s) =>
            `- ${s.wallId}${s.wallLabel ? ` «${s.wallLabel}»` : ""} (${s.roomId}): (${r1(s.a.x)},${r1(s.a.y)})→(${r1(s.b.x)},${r1(s.b.y)}), длина ${r1(s.length)}, нормаль внутрь (${r1(s.inward.x)},${r1(s.inward.y)}), свободная глубина ${s.freeDepth}. Центр предмета Ш×Г у стены: середина участка + нормаль×(Г/2); поворот = угол направления участка.`,
        )
        .join("\n"),
    };
  },
});

export const listMaterials = def({
  name: "list_materials",
  description: "Доступные материалы отделки пола и стен (id, название).",
  schema: z.object({ category: z.enum(["floor", "wall"]).optional() }),
  async run(input) {
    return { text: MATERIALS.filter((m) => !input.category || m.category === input.category).map((m) => `- ${m.id} (${m.category}): ${m.name}`).join("\n") };
  },
});

export const setMaterial = def({
  name: "set_material",
  description: "Назначить материал полу помещения (target=floor, id помещения) или стене (target=wall, id стены). Для всех стен сразу передай id='all'.",
  schema: z.object({ target: z.enum(["floor", "wall"]), id: z.string(), material_id: z.string() }),
  mutates: true,
  async run(input, ctx) {
    const mat = MATERIALS.find((m) => m.id === input.material_id && m.category === input.target);
    if (!mat) return { text: `Материал ${input.material_id} для ${input.target} не найден. Вызови list_materials.`, isError: true };
    if (input.target === "floor") {
      const rooms = input.id === "all" ? ctx.project.plan.rooms : ctx.project.plan.rooms.filter((r) => r.id === input.id);
      if (!rooms.length) return { text: `Помещение ${input.id} не найдено`, isError: true };
      for (const r of rooms) r.floorMaterialId = mat.id;
    } else {
      const walls = input.id === "all" ? ctx.project.plan.walls : [findWall(ctx.project, input.id)];
      for (const w of walls) w.materialId = mat.id;
    }
    await ctx.save();
    return { text: `Материал «${mat.name}» назначен (${input.target}: ${input.id}).` };
  },
});

export const addWall = def({
  name: "add_wall",
  description: "Добавить стену по оси от (ax,ay) к (bx,by). Только по явной просьбе пользователя.",
  schema: z.object({ ax: z.number(), ay: z.number(), bx: z.number(), by: z.number(), thickness_cm: z.number().positive().optional(), height_cm: z.number().positive().optional(), label: z.string().optional() }),
  mutates: true,
  async run(input, ctx) {
    const w: Wall = { id: newId("wall"), a: { x: input.ax, y: input.ay }, b: { x: input.bx, y: input.by }, thickness: input.thickness_cm ?? 10, height: input.height_cm ?? ctx.project.plan.ceilingHeight, label: input.label, materialId: "paint_white" };
    ctx.project.plan.walls.push(w);
    await ctx.save();
    return { text: `Стена ${w.id} добавлена, длина ${r1(wallLength(w))}.` };
  },
});

export const updateWall = def({
  name: "update_wall",
  description: "Изменить координаты концов, толщину, высоту или подпись стены (например, чтобы выровнять стену). Только по явной просьбе пользователя. Проёмы на стене остаются с теми же отступами.",
  schema: z.object({ wall_id: z.string(), ax: z.number().optional(), ay: z.number().optional(), bx: z.number().optional(), by: z.number().optional(), thickness_cm: z.number().positive().optional(), height_cm: z.number().positive().optional(), label: z.string().optional() }),
  mutates: true,
  async run(input, ctx) {
    const w = findWall(ctx.project, input.wall_id);
    if (input.ax !== undefined) w.a.x = input.ax;
    if (input.ay !== undefined) w.a.y = input.ay;
    if (input.bx !== undefined) w.b.x = input.bx;
    if (input.by !== undefined) w.b.y = input.by;
    if (input.thickness_cm) w.thickness = input.thickness_cm;
    if (input.height_cm) w.height = input.height_cm;
    if (input.label) w.label = input.label;
    await ctx.save();
    return { text: `Стена ${w.id}: (${r1(w.a.x)},${r1(w.a.y)})→(${r1(w.b.x)},${r1(w.b.y)}), толщина ${w.thickness}, высота ${w.height}.` };
  },
});

export const removeWall = def({
  name: "remove_wall",
  description: "Удалить стену вместе с её проёмами. Только по явной просьбе пользователя.",
  schema: z.object({ wall_id: z.string() }),
  mutates: true,
  async run(input, ctx) {
    findWall(ctx.project, input.wall_id);
    ctx.project.plan.walls = ctx.project.plan.walls.filter((w) => w.id !== input.wall_id);
    ctx.project.plan.openings = ctx.project.plan.openings.filter((o) => o.wallId !== input.wall_id);
    await ctx.save();
    return { text: `Стена ${input.wall_id} удалена.` };
  },
});

const openingFields = {
  type: z.enum(["door", "double_door", "window", "passage", "niche"]).optional(),
  offset_cm: z.number().min(0).optional().describe("Отступ от начала стены (точка a) до начала проёма"),
  width_cm: z.number().positive().optional(),
  height_cm: z.number().positive().optional(),
  sill_cm: z.number().min(0).optional(),
  hinge: z.enum(["start", "end"]).optional(),
  swing: z.enum(["left", "right"]).optional().describe("Сторона стены, в которую открывается дверь, относительно направления a→b"),
  open_angle_deg: z.number().min(0).max(180).optional(),
  depth_cm: z.number().min(0).optional().describe("Глубина ниши"),
  label: z.string().optional(),
};

export const addOpening = def({
  name: "add_opening",
  description: "Добавить проём (дверь, окно, проход, нишу) на стену. Только по явной просьбе пользователя.",
  schema: z.object({ wall_id: z.string(), ...openingFields, type: z.enum(["door", "double_door", "window", "passage", "niche"]), offset_cm: z.number().min(0), width_cm: z.number().positive() }),
  mutates: true,
  async run(input, ctx) {
    const w = findWall(ctx.project, input.wall_id);
    if (input.offset_cm + input.width_cm > wallLength(w) + 0.5) return { text: `Проём выходит за пределы стены (длина ${r1(wallLength(w))}).`, isError: true };
    const o: Opening = {
      id: newId("op"),
      wallId: w.id,
      type: input.type,
      offset: input.offset_cm,
      width: input.width_cm,
      height: input.height_cm ?? (input.type === "window" ? 140 : 205),
      sill: input.sill_cm ?? (input.type === "window" ? 90 : 0),
      hinge: input.hinge,
      swing: input.swing,
      openAngle: input.open_angle_deg,
      depth: input.depth_cm,
      label: input.label,
    };
    ctx.project.plan.openings.push(o);
    await ctx.save();
    const ow = openingWorld(w, o);
    return { text: `Проём ${o.id} добавлен: (${r1(ow.start.x)},${r1(ow.start.y)})–(${r1(ow.end.x)},${r1(ow.end.y)}).` };
  },
});

export const updateOpening = def({
  name: "update_opening",
  description: "Изменить параметры проёма (ширина, положение, сторона открывания и т.п.). Только по явной просьбе пользователя.",
  schema: z.object({ opening_id: z.string(), ...openingFields }),
  mutates: true,
  async run(input, ctx) {
    const o = findOpening(ctx.project, input.opening_id);
    if (input.type) o.type = input.type;
    if (input.offset_cm !== undefined) o.offset = input.offset_cm;
    if (input.width_cm) o.width = input.width_cm;
    if (input.height_cm) o.height = input.height_cm;
    if (input.sill_cm !== undefined) o.sill = input.sill_cm;
    if (input.hinge) o.hinge = input.hinge;
    if (input.swing) o.swing = input.swing;
    if (input.open_angle_deg !== undefined) o.openAngle = input.open_angle_deg;
    if (input.depth_cm !== undefined) o.depth = input.depth_cm;
    if (input.label) o.label = input.label;
    await ctx.save();
    return { text: `Проём ${o.id} обновлён.` };
  },
});

export const removeOpening = def({
  name: "remove_opening",
  description: "Удалить проём. Только по явной просьбе пользователя.",
  schema: z.object({ opening_id: z.string() }),
  mutates: true,
  async run(input, ctx) {
    findOpening(ctx.project, input.opening_id);
    ctx.project.plan.openings = ctx.project.plan.openings.filter((o) => o.id !== input.opening_id);
    await ctx.save();
    return { text: `Проём ${input.opening_id} удалён.` };
  },
});

export const addLabel = def({
  name: "add_label",
  description: "Подписать зону на плане (например «зона обуви», «вешалка»).",
  schema: z.object({ x_cm: z.number(), y_cm: z.number(), text: z.string() }),
  mutates: true,
  async run(input, ctx) {
    ctx.project.plan.labels.push({ id: newId("lb"), x: input.x_cm, y: input.y_cm, text: input.text });
    await ctx.save();
    return { text: "Подпись добавлена." };
  },
});

export const getReferenceImage = def({
  name: "get_reference_image",
  description: "Получить изображение референса/фото пользователя по id (из списка референсов), чтобы его рассмотреть. Также принимает id рендера.",
  schema: z.object({ reference_id: z.string() }),
  async run(input, ctx) {
    const ref = ctx.project.references.find((r) => r.id === input.reference_id);
    const rend = ctx.project.renders.find((r) => r.id === input.reference_id);
    const url = ref?.url ?? rend?.url;
    if (!url) return { text: `Референс ${input.reference_id} не найден.`, isError: true };
    const img = await readUpload(url);
    if (!img) return { text: `Файл ${url} отсутствует на диске.`, isError: true };
    const norm = await normalizeForVision({ data: img.data, mediaType: img.mediaType });
    return { text: `${input.reference_id}${ref?.caption ? `: ${ref.caption}` : ""}`, images: [norm] };
  },
});

export const generateRender = def({
  name: "generate_render",
  description:
    "Сгенерировать фотореалистичную визуализацию выбранного ракурса на основе снимка 3D-сцены (геометрия и расстановка сохраняются), референсов стиля и картинок выбранных товаров. Возвращает URL картинки — вставь его в ответ как ![описание](url).",
  schema: z.object({
    view: ViewSchema.describe("Ракурс: должен быть среди доступных снимков 3D-сцены"),
    prompt: z.string().describe("Что изменить/подчеркнуть: стиль, материалы, свет, конкретные предметы. По-русски или по-английски"),
    style_reference_ids: z.array(z.string()).optional().describe("id референсов стиля; по умолчанию — все референсы типа style (до 4)"),
    product_ids: z.array(z.string()).optional().describe("Товары из каталога, чьи картинки нужно учесть (до 6)"),
  }),
  mutates: true,
  async run(input, ctx) {
    const snap = ctx.project.snapshots[input.view as ViewPreset];
    const available = Object.keys(ctx.project.snapshots);
    if (!snap) return { text: `Снимка ракурса «${input.view}» нет. Доступны: ${available.join(", ") || "ни одного — попросите пользователя открыть 3D-вид и отправить сообщение ещё раз"}.`, isError: true };
    const base = await readUpload(snap.url);
    if (!base) return { text: "Снимок не найден на диске — попросите пользователя переснять 3D-вид.", isError: true };
    ctx.status("Собираю референсы для рендера");

    const req: RenderRequest = { prompt: "", images: [{ data: base.data, mediaType: base.mediaType, role: "base", label: "IMAGE 1: 3D block-out of the real room (geometry, camera and furniture positions are ground truth)" }], size: "1536x1024" };
    const styleRefs = (input.style_reference_ids?.length ? ctx.project.references.filter((r) => input.style_reference_ids!.includes(r.id)) : ctx.project.references.filter((r) => r.kind === "style")).slice(0, 4);
    for (const ref of styleRefs) {
      const img = await readUpload(ref.url);
      if (img) req.images.push({ data: img.data, mediaType: img.mediaType, role: "style", label: `Style reference${ref.caption ? `: ${ref.caption}` : ""}` });
    }
    const products = (input.product_ids ?? []).map((id) => ctx.project.catalog.find((p) => p.id === id)).filter((p): p is Product => Boolean(p)).slice(0, 6);
    const productLines: string[] = [];
    for (const p of products) {
      const img = p.imageUrl ? await fetchRemoteImage(p.imageUrl) : null;
      const placed = ctx.project.plan.items.find((it) => it.productId === p.id);
      const dims = p.dims ? `${p.dims.w ?? "?"}×${p.dims.d ?? "?"}×${p.dims.h ?? "?"} cm` : "size unknown";
      const where = placed ? ` placed at the block-out box «${placed.name}» (centre ${r1(placed.x)},${r1(placed.y)} cm)` : "";
      productLines.push(`- «${p.title}», ${dims}${where}${img ? " — see its product photo among the input images" : ""}`);
      if (img) req.images.push({ data: img.data, mediaType: img.mediaType, role: "product", label: `Product photo: ${p.title}` });
    }

    const plan = ctx.project.plan;
    const room = plan.rooms[0];
    const floor = room ? getMaterial(room.floorMaterialId, "floor").name : "parquet";
    const wallMat = plan.walls[0] ? getMaterial(plan.walls[0].materialId, "wall").name : "white paint";
    const items = plan.items.map((it) => `- ${it.name}: ${r1(it.w)}×${r1(it.d)}×${r1(it.h)} cm${it.elevation ? `, mounted ${r1(it.elevation)} cm above floor` : ""}${it.note ? ` (${it.note})` : ""}`).join("\n");
    req.prompt = [
      `Photorealistic interior visualization of a small apartment entrance hall, rendered from EXACTLY the camera, geometry and layout of IMAGE 1 (a 3D block-out of the real room).`,
      `Keep every wall, door (position, size, swing), niche and the floor plan exactly as in IMAGE 1. Do not add or remove doors, windows or walls. Each coloured box in the block-out is a placeholder for the real object listed below – render the real object at the same position and the same size.`,
      room ? `Room facts: ${room.name}, ${(polygonArea(room.polygon) / 10000).toFixed(2)} m², ceiling ${plan.ceilingHeight} cm. Floor: ${floor}. Walls: ${wallMat}.` : "",
      `Objects (W×D×H):\n${items}`,
      productLines.length ? `Real products to use:\n${productLines.join("\n")}` : "",
      `Style: ${ctx.project.brief.style || "warm contemporary"}. ${input.prompt}`,
      styleRefs.length ? `The style reference images show the desired mood, palette and materials – borrow their look, not their layout.` : "",
      `Realistic materials and lighting (warm artificial light plus soft ambient), eye-level realism, no people, no text, no watermarks, no floating objects.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    ctx.status(`Генерирую рендер (${getImageProvider().name})`);
    const provider = getImageProvider();
    const result = await provider.generate(req);
    const url = await saveUpload(`renders/${ctx.project.id}`, result.data, result.mediaType === "image/jpeg" ? "jpg" : "png");
    const render: Render = { id: newId("rnd"), url, view: input.view as ViewPreset, prompt: req.prompt, provider: result.provider, baseSnapshotUrl: snap.url, createdAt: now(), note: result.note };
    ctx.project.renders.push(render);
    await ctx.save();
    ctx.onRender(render);
    return { text: `Рендер готов: ${render.id} → ${url}${result.note ? `\nПримечание: ${result.note}` : ""}\nВставь в ответ: ![Визуализация: ${input.view}](${url})` };
  },
});

export const ALL_TOOLS: ToolDef[] = [
  getProjectState,
  updateBrief,
  searchProductsTool,
  fetchPageInfo,
  addProduct,
  updateProduct,
  placeItem,
  moveItem,
  updateItem,
  removeItem,
  checkFit,
  freeWallSegments,
  listMaterials,
  setMaterial,
  addWall,
  updateWall,
  removeWall,
  addOpening,
  updateOpening,
  removeOpening,
  addLabel,
  getReferenceImage,
  generateRender,
] as ToolDef[];

export function toolDefinitions(): Anthropic.Beta.Messages.BetaTool[] {
  return ALL_TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.schema) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      ...(config.anthropic.eagerToolStreaming ? { eager_input_streaming: true } : {}),
    };
  });
}

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Неизвестный инструмент ${name}`, isError: true };
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { text: JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }), isError: true };
  }
  try {
    return await tool.run(parsed.data, ctx);
  } catch (e) {
    return { text: `Ошибка инструмента ${name}: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}
