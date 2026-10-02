import type { DimsConfidence, ProductDims, ProductSource } from "@planner/shared";

/** A product candidate before it gets an id and lands in the project catalog. */
export interface FoundProduct {
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
  snippet?: string;
  via: string;
}

export interface SearchOptions {
  sources?: ProductSource[];
  maxPrice?: number;
  limit?: number;
}

export interface SearchOutcome {
  products: FoundProduct[];
  notes: string[];
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}
