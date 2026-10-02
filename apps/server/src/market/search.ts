import type { ProductSource } from "@planner/shared";
import { config } from "../config.js";
import { parseDims, SOURCE_DOMAINS, sourceFromUrl } from "./dims.js";
import { fetchWithTimeout, type FoundProduct, type SearchOptions, type SearchOutcome } from "./types.js";
import { searchWildberries } from "./wildberries.js";

const DEFAULT_SOURCES: ProductSource[] = ["wildberries", "ozon", "yandex_market", "avito", "lemana", "petrovich", "hoff", "divan"];

async function tavily(query: string, domains: string[], limit: number): Promise<FoundProduct[]> {
  const key = config.search.tavilyApiKey;
  if (!key) return [];
  const res = await fetchWithTimeout(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, query, include_domains: domains, max_results: limit, search_depth: "basic", include_images: false }),
    },
    config.search.timeoutMs,
  );
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const json = (await res.json()) as { results?: Array<{ title: string; url: string; content?: string }> };
  return (json.results ?? []).map((r) => {
    const parsed = parseDims(`${r.title} ${r.content ?? ""}`);
    const pm = /(\d[\d\s]{2,})\s*(?:₽|руб)/.exec(r.content ?? "");
    return {
      source: sourceFromUrl(r.url),
      title: r.title,
      url: r.url,
      price: pm ? Number(pm[1]!.replace(/\s/g, "")) : undefined,
      currency: "RUB",
      dims: parsed.dims,
      dimsConfidence: parsed.dims ? "estimated" : "unknown",
      snippet: r.content?.slice(0, 300),
      via: "tavily",
    } satisfies FoundProduct;
  });
}

async function serpapi(query: string, domains: string[], limit: number): Promise<FoundProduct[]> {
  const key = config.search.serpApiKey;
  if (!key) return [];
  const q = domains.length ? `${query} (${domains.map((d) => `site:${d}`).join(" OR ")})` : query;
  const url = `https://serpapi.com/search.json?engine=google&hl=ru&gl=ru&num=${limit}&q=${encodeURIComponent(q)}&api_key=${key}`;
  const res = await fetchWithTimeout(url, {}, config.search.timeoutMs);
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
  const json = (await res.json()) as { organic_results?: Array<{ title: string; link: string; snippet?: string; thumbnail?: string }> };
  return (json.organic_results ?? []).map((r) => {
    const parsed = parseDims(`${r.title} ${r.snippet ?? ""}`);
    const pm = /(\d[\d\s]{2,})\s*(?:₽|руб)/.exec(r.snippet ?? "");
    return {
      source: sourceFromUrl(r.link),
      title: r.title,
      url: r.link,
      price: pm ? Number(pm[1]!.replace(/\s/g, "")) : undefined,
      currency: "RUB",
      imageUrl: r.thumbnail,
      dims: parsed.dims,
      dimsConfidence: parsed.dims ? "estimated" : "unknown",
      snippet: r.snippet?.slice(0, 300),
      via: "serpapi",
    } satisfies FoundProduct;
  });
}

/**
 * Aggregated product search. Wildberries is queried directly; other marketplaces go through a web-search
 * provider if one is configured. When nothing is configured for a source, we say so, and the agent falls back
 * to Claude's built-in web_search tool.
 */
export async function searchProducts(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
  const sources = (opts.sources?.length ? opts.sources : DEFAULT_SOURCES).filter((s, i, a) => a.indexOf(s) === i);
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const notes: string[] = [];
  const products: FoundProduct[] = [];

  const tasks: Array<Promise<void>> = [];
  if (sources.includes("wildberries") && config.search.wildberries) {
    tasks.push(
      searchWildberries(query, { ...opts, limit }).then((r) => {
        products.push(...r.products);
        if (r.note) notes.push(r.note);
      }),
    );
  }
  const others = sources.filter((s) => s !== "wildberries");
  const domains = others.flatMap((s) => SOURCE_DOMAINS[s] ?? []);
  if (others.length) {
    if (config.search.tavilyApiKey) {
      tasks.push(
        tavily(query, domains, limit)
          .then((r) => void products.push(...r))
          .catch((e) => void notes.push(`Tavily: ${e instanceof Error ? e.message : String(e)}`)),
      );
    } else if (config.search.serpApiKey) {
      tasks.push(
        serpapi(query, domains, limit)
          .then((r) => void products.push(...r))
          .catch((e) => void notes.push(`SerpAPI: ${e instanceof Error ? e.message : String(e)}`)),
      );
    } else {
      notes.push(`Для ${others.join(", ")} не настроен поисковый провайдер (TAVILY_API_KEY / SERPAPI_API_KEY) — используйте встроенный web_search с запросами вида «${query} site:ozon.ru», затем fetch_page_info и add_product.`);
    }
  }
  await Promise.all(tasks);

  const seen = new Set<string>();
  const unique = products.filter((p) => {
    const key = p.url.replace(/[?#].*$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    if (opts.maxPrice && p.price && p.price > opts.maxPrice) return false;
    return true;
  });
  return { products: unique.slice(0, limit * 2), notes };
}
