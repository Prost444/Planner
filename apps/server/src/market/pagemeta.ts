import { config } from "../config.js";
import { parseDims, sourceFromUrl } from "./dims.js";
import { fetchWithTimeout } from "./types.js";
import { enrichWildberries } from "./wildberries.js";
import type { ProductSource, ProductDims, DimsConfidence } from "@planner/shared";

export interface PageMeta {
  url: string;
  source: ProductSource;
  title?: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  currency?: string;
  dims?: ProductDims;
  dimsConfidence: DimsConfidence;
  specs?: Record<string, string>;
  textExcerpt?: string;
  error?: string;
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

function meta(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i");
  const m = re.exec(html) ?? re2.exec(html);
  return m ? decode(m[1]!) : undefined;
}

function jsonLd(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      const arr = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const x of arr) if (x && typeof x === "object") out.push(x as Record<string, unknown>);
    } catch {
      // ignore malformed blocks
    }
  }
  return out;
}

function stripHtml(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

/** Fetch a product page and extract what we can: title, price, image, dimensions. Many marketplaces block bots – we report that honestly. */
export async function fetchPageMeta(url: string): Promise<PageMeta> {
  const source = sourceFromUrl(url);
  const base: PageMeta = { url, source, dimsConfidence: "unknown" };
  try {
    const res = await fetchWithTimeout(url, { redirect: "follow" }, config.search.timeoutMs);
    if (!res.ok) {
      base.error = `HTTP ${res.status}${res.status === 403 || res.status === 429 ? " — сайт блокирует автоматические запросы" : ""}`;
    } else {
      const html = (await res.text()).slice(0, 2_000_000);
      const titleTag = decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim();
      base.title = meta(html, "og:title") ?? (titleTag || undefined);
      base.description = meta(html, "og:description") ?? meta(html, "description");
      base.imageUrl = meta(html, "og:image");
      for (const ld of jsonLd(html)) {
        const type = String(ld["@type"] ?? "");
        if (/Product/i.test(type)) {
          base.title = (ld.name as string) ?? base.title;
          const img = ld.image;
          if (typeof img === "string") base.imageUrl = img;
          else if (Array.isArray(img) && typeof img[0] === "string") base.imageUrl = img[0];
          const offers = (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers) as Record<string, unknown> | undefined;
          if (offers) {
            const p = Number(offers.price ?? offers.lowPrice);
            if (p > 0) base.price = p;
            base.currency = (offers.priceCurrency as string) ?? "RUB";
          }
          const props = ld.additionalProperty as Array<{ name?: string; value?: string }> | undefined;
          if (Array.isArray(props)) {
            base.specs = {};
            for (const pr of props) if (pr.name && pr.value !== undefined) base.specs[pr.name] = String(pr.value);
          }
          if (typeof ld.description === "string") base.description = ld.description;
        }
      }
      const text = stripHtml(html);
      base.textExcerpt = text.slice(0, 1500);
      const parsed = parseDims([base.title, base.description, Object.entries(base.specs ?? {}).map(([k, v]) => `${k} ${v}`).join("; "), text.slice(0, 20000)].filter(Boolean).join(" \n "));
      base.dims = parsed.dims;
      base.dimsConfidence = parsed.dims ? (base.specs ? "exact" : parsed.confidence) : "unknown";
      if (!base.price) {
        const pm = /(\d[\d\s]{2,})\s*(?:₽|руб)/.exec(text);
        if (pm) base.price = Number(pm[1]!.replace(/\s/g, ""));
        base.currency = "RUB";
      }
    }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  if (source === "wildberries") {
    const wb = await enrichWildberries(url);
    if (wb?.dims && (wb.dims.w || wb.dims.d || wb.dims.h)) {
      base.dims = wb.dims;
      base.dimsConfidence = "exact";
      base.specs = { ...(base.specs ?? {}), ...(wb.options ?? {}) };
      base.description = base.description ?? wb.description;
      base.error = undefined;
    }
  }
  return base;
}
