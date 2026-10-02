import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Load .env from the repo root first, then from apps/server (later files do not override earlier ones).
dotenv.config({ path: path.resolve(here, "../../../.env") });
dotenv.config({ path: path.resolve(here, "../.env") });

const bool = (v: string | undefined, def: boolean) => (v === undefined || v === "" ? def : !["0", "false", "no", "off"].includes(v.toLowerCase()));
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export type ImageProviderName = "openai" | "gemini" | "mock";

const imageProvider = ((): ImageProviderName => {
  const explicit = process.env.IMAGE_PROVIDER?.toLowerCase();
  if (explicit === "openai" || explicit === "gemini" || explicit === "mock") return explicit;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "mock";
})();

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(here, "../data"),
  seedAssetsDir: path.resolve(here, "../seed-assets"),
  publicDir: path.resolve(here, "../../web/dist"),

  anthropic: {
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    effort: (process.env.ANTHROPIC_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh" | "max",
    maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 32000),
    eagerToolStreaming: bool(process.env.ANTHROPIC_EAGER_TOOL_STREAMING, true),
    serverSideFallback: bool(process.env.ANTHROPIC_SERVER_SIDE_FALLBACK, true),
    webSearch: bool(process.env.AGENT_WEB_SEARCH, true),
    webSearchMaxUses: Number(process.env.AGENT_WEB_SEARCH_MAX_USES ?? 8),
    webFetchMaxUses: Number(process.env.AGENT_WEB_FETCH_MAX_USES ?? 6),
    webSearchAllowedDomains: list(process.env.WEB_SEARCH_ALLOWED_DOMAINS),
    maxIterations: Number(process.env.AGENT_MAX_ITERATIONS ?? 40),
    compactionChars: Number(process.env.AGENT_COMPACTION_CHARS ?? 700_000),
    compactionMessages: Number(process.env.AGENT_COMPACTION_MESSAGES ?? 90),
  },

  images: {
    provider: imageProvider,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
    openaiQuality: process.env.OPENAI_IMAGE_QUALITY ?? "medium",
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image",
    geminiFallbackModel: process.env.GEMINI_IMAGE_FALLBACK_MODEL ?? "gemini-2.5-flash-image",
  },

  search: {
    tavilyApiKey: process.env.TAVILY_API_KEY,
    serpApiKey: process.env.SERPAPI_API_KEY,
    wildberries: bool(process.env.SEARCH_WILDBERRIES, true),
    timeoutMs: Number(process.env.SEARCH_TIMEOUT_MS ?? 12000),
  },
};

export function describeConfig() {
  return {
    model: config.anthropic.model,
    effort: config.anthropic.effort,
    anthropicKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    webSearch: config.anthropic.webSearch,
    imageProvider: config.images.provider,
    searchProviders: {
      wildberries: config.search.wildberries,
      tavily: Boolean(config.search.tavilyApiKey),
      serpapi: Boolean(config.search.serpApiKey),
      claudeWebSearch: config.anthropic.webSearch,
    },
  };
}
