import type { DimsConfidence, ProductDims, ProductSource } from "@planner/shared";

export interface ParsedDims {
  dims?: ProductDims;
  confidence: DimsConfidence;
  raw?: string;
}

const num = (s: string) => Number(s.replace(",", "."));
const toCm = (n: number, unit: string | undefined): number => {
  const u = (unit ?? "").toLowerCase();
  if (u.startsWith("мм") || u.startsWith("mm")) return n / 10;
  if (u === "м" || u === "m") return n * 100;
  return n;
};

/**
 * Extract furniture dimensions (cm) from free text: "30x35x40 см", "Ш 30 х Г 35 х В 40", "ширина 30 см, глубина 35 см, высота 40 см".
 * Heuristic — the agent must treat the result as `estimated` unless it comes from a product spec table.
 */
export function parseDims(text: string): ParsedDims {
  const t = text.replace(/\s+/g, " ");
  const dims: ProductDims = {};
  let confidence: DimsConfidence = "unknown";

  const labelled: Array<[RegExp, keyof ProductDims]> = [
    [/(?:ширина|width|ш\.?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm|м|m)?(?![а-яa-z])/i, "w"],
    [/(?:глубина|depth|г\.?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm|м|m)?(?![а-яa-z])/i, "d"],
    [/(?:высота|height|в\.?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm|м|m)?(?![а-яa-z])/i, "h"],
    [/(?:длина|length|д\.?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm|м|m)?(?![а-яa-z])/i, "w"],
  ];
  for (const [re, key] of labelled) {
    const m = re.exec(t);
    if (m && dims[key] === undefined) {
      const val = toCm(num(m[1]!), m[2]);
      if (val > 1 && val < 1000) {
        dims[key] = val;
        confidence = "exact";
      }
    }
  }

  if (dims.w === undefined || dims.d === undefined || dims.h === undefined) {
    const triple = /(\d+(?:[.,]\d+)?)\s*[xх×\*]\s*(\d+(?:[.,]\d+)?)(?:\s*[xх×\*]\s*(\d+(?:[.,]\d+)?))?\s*(мм|mm|см|cm|м|m)?(?![а-яa-z])/i.exec(t);
    if (triple) {
      const unit = triple[4];
      const a = toCm(num(triple[1]!), unit);
      const b = toCm(num(triple[2]!), unit);
      const c = triple[3] ? toCm(num(triple[3]!), unit) : undefined;
      const plausible = (n: number | undefined) => n === undefined || (n > 1 && n < 1000);
      if (plausible(a) && plausible(b) && plausible(c)) {
        // Order in RU listings is usually Ш×Г×В or Д×Ш×В. We assume Ш(w)×Г(d)×В(h).
        if (dims.w === undefined) dims.w = a;
        if (dims.d === undefined) dims.d = b;
        if (c !== undefined && dims.h === undefined) dims.h = c;
        if (confidence === "unknown") confidence = "estimated";
      }
    }
  }
  const has = dims.w !== undefined || dims.d !== undefined || dims.h !== undefined;
  return has ? { dims, confidence, raw: t.slice(0, 200) } : { confidence: "unknown" };
}

export function sourceFromUrl(url: string): ProductSource {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "other";
  }
  if (host.endsWith("ozon.ru")) return "ozon";
  if (host.endsWith("wildberries.ru") || host.endsWith("wb.ru")) return "wildberries";
  if (host.endsWith("market.yandex.ru")) return "yandex_market";
  if (host.endsWith("avito.ru")) return "avito";
  if (host.endsWith("lemanapro.ru") || host.endsWith("leroymerlin.ru")) return "lemana";
  if (host.endsWith("petrovich.ru")) return "petrovich";
  if (host.endsWith("obi.ru")) return "obi";
  if (host.endsWith("maxidom.ru")) return "maxidom";
  if (host.endsWith("hoff.ru")) return "hoff";
  if (host.endsWith("divan.ru")) return "divan";
  if (host.includes("ikea")) return "ikea";
  return "other";
}

export const SOURCE_DOMAINS: Record<ProductSource, string[]> = {
  ozon: ["ozon.ru"],
  wildberries: ["wildberries.ru"],
  yandex_market: ["market.yandex.ru"],
  avito: ["avito.ru"],
  lemana: ["lemanapro.ru"],
  petrovich: ["petrovich.ru"],
  obi: ["obi.ru"],
  maxidom: ["maxidom.ru"],
  hoff: ["hoff.ru"],
  divan: ["divan.ru"],
  ikea: [],
  other: [],
};
