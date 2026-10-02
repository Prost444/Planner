import { config } from "../config.js";
import { parseDims } from "./dims.js";
import { fetchWithTimeout, type FoundProduct, type SearchOptions } from "./types.js";

/**
 * Wildberries has a public (undocumented) JSON search endpoint used by its own web client.
 * It changes from time to time, so everything here is defensive and best-effort.
 */

type WbProduct = {
  id: number;
  name?: string;
  brand?: string;
  salePriceU?: number;
  priceU?: number;
  rating?: number;
  reviewRating?: number;
  feedbacks?: number;
  sizes?: Array<{ price?: { product?: number; basic?: number } }>;
};

function basketHost(id: number): string {
  const vol = Math.floor(id / 100000);
  const ranges: Array<[number, string]> = [
    [143, "01"], [287, "02"], [431, "03"], [719, "04"], [1007, "05"], [1061, "06"], [1115, "07"], [1169, "08"], [1313, "09"], [1601, "10"],
    [1655, "11"], [1919, "12"], [2045, "13"], [2189, "14"], [2405, "15"], [2621, "16"], [2837, "17"], [3053, "18"], [3269, "19"], [3485, "20"],
    [3701, "21"], [3917, "22"], [4133, "23"], [4349, "24"], [4565, "25"], [4877, "26"], [5189, "27"], [5501, "28"], [5813, "29"], [6125, "30"],
  ];
  for (const [max, n] of ranges) if (vol <= max) return `basket-${n}.wbbasket.ru`;
  return "basket-31.wbbasket.ru";
}

export function wbImageUrl(id: number): string {
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  return `https://${basketHost(id)}/vol${vol}/part${part}/${id}/images/c516x688/1.webp`;
}

export function wbCardJsonUrl(id: number): string {
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  return `https://${basketHost(id)}/vol${vol}/part${part}/${id}/info/ru/card.json`;
}

function extractProducts(json: unknown): WbProduct[] {
  const j = json as { data?: { products?: WbProduct[] }; products?: WbProduct[] };
  return j?.data?.products ?? j?.products ?? [];
}

function price(p: WbProduct): number | undefined {
  const kop = p.sizes?.[0]?.price?.product ?? p.salePriceU ?? p.priceU;
  return typeof kop === "number" && kop > 0 ? Math.round(kop / 100) : undefined;
}

export async function searchWildberries(query: string, opts: SearchOptions = {}): Promise<{ products: FoundProduct[]; note?: string }> {
  const limit = opts.limit ?? 8;
  const q = encodeURIComponent(query);
  const endpoints = [
    `https://search.wb.ru/exactmatch/ru/common/v9/search?appType=1&curr=rub&dest=-1257786&lang=ru&query=${q}&resultset=catalog&sort=popular&spp=30&page=1`,
    `https://search.wb.ru/exactmatch/ru/common/v5/search?appType=1&curr=rub&dest=-1257786&query=${q}&resultset=catalog&sort=popular&spp=30&page=1`,
  ];
  let lastErr = "";
  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url, { headers: { accept: "application/json" } }, config.search.timeoutMs);
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const json = await res.json();
      const items = extractProducts(json);
      if (!items.length) {
        lastErr = "пустой ответ";
        continue;
      }
      const products: FoundProduct[] = [];
      for (const p of items) {
        if (!p.id) continue;
        const pr = price(p);
        if (opts.maxPrice && pr && pr > opts.maxPrice) continue;
        const parsed = parseDims(p.name ?? "");
        products.push({
          source: "wildberries",
          title: [p.brand, p.name].filter(Boolean).join(" · "),
          url: `https://www.wildberries.ru/catalog/${p.id}/detail.aspx`,
          price: pr,
          currency: "RUB",
          imageUrl: wbImageUrl(p.id),
          dims: parsed.dims,
          dimsConfidence: parsed.dims ? "estimated" : "unknown",
          rating: p.reviewRating ?? p.rating,
          reviews: p.feedbacks,
          via: "wildberries-api",
        });
        if (products.length >= limit) break;
      }
      return { products };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { products: [], note: `Wildberries API недоступен (${lastErr}) — используйте web_search.` };
}

/** Pull exact dimensions from the public card.json of a WB product, if reachable. */
export async function enrichWildberries(url: string): Promise<{ dims?: { w?: number; d?: number; h?: number }; description?: string; options?: Record<string, string> } | null> {
  const m = /catalog\/(\d+)\//.exec(url);
  if (!m) return null;
  const id = Number(m[1]);
  try {
    const res = await fetchWithTimeout(wbCardJsonUrl(id), { headers: { accept: "application/json" } }, config.search.timeoutMs);
    if (!res.ok) return null;
    const card = (await res.json()) as { description?: string; options?: Array<{ name: string; value: string }>; grouped_options?: Array<{ options: Array<{ name: string; value: string }> }> };
    const opts: Record<string, string> = {};
    for (const o of card.options ?? []) opts[o.name] = o.value;
    for (const g of card.grouped_options ?? []) for (const o of g.options ?? []) opts[o.name] = o.value;
    const dims: { w?: number; d?: number; h?: number } = {};
    const pick = (keys: string[]) => {
      for (const [k, v] of Object.entries(opts)) {
        const lk = k.toLowerCase();
        if (keys.some((x) => lk.includes(x))) {
          const n = Number(String(v).replace(",", ".").replace(/[^\d.]/g, ""));
          if (n > 0) return /мм/i.test(v) ? n / 10 : /\bм\b/i.test(v) && !/см/i.test(v) ? n * 100 : n;
        }
      }
      return undefined;
    };
    dims.w = pick(["ширина предмета", "ширина", "длина предмета", "длина"]);
    dims.d = pick(["глубина предмета", "глубина"]);
    dims.h = pick(["высота предмета", "высота"]);
    if (dims.w === undefined && dims.d === undefined && dims.h === undefined) {
      const parsed = parseDims(`${card.description ?? ""} ${Object.values(opts).join(" ")}`);
      return { dims: parsed.dims, description: card.description, options: opts };
    }
    return { dims, description: card.description, options: opts };
  } catch {
    return null;
  }
}
