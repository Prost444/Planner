import { config } from "../config.js";
import { toJpeg, toPng, type ImageBytes } from "../images.js";

export type RenderImageRole = "base" | "style" | "product" | "photo";

export interface RenderRequest {
  prompt: string;
  images: Array<ImageBytes & { role: RenderImageRole; label?: string }>;
  /** Landscape by default – matches the 3D viewport. */
  size?: "1024x1024" | "1536x1024" | "1024x1536";
}

export interface RenderResult {
  data: Buffer;
  mediaType: "image/png" | "image/jpeg";
  provider: string;
  note?: string;
}

export interface ImageProvider {
  name: string;
  generate(req: RenderRequest): Promise<RenderResult>;
}

/** Without an image API key we return the 3D snapshot itself so the pipeline stays testable. */
export const mockProvider: ImageProvider = {
  name: "mock",
  async generate(req) {
    const base = req.images.find((i) => i.role === "base") ?? req.images[0];
    if (!base) throw new Error("Нет базового изображения для рендера");
    const png = await toPng(base);
    return {
      data: png.data,
      mediaType: png.mediaType === "image/jpeg" ? "image/jpeg" : "image/png",
      provider: "mock",
      note: "Генерация изображений не настроена (нет OPENAI_API_KEY / GEMINI_API_KEY) — возвращён снимок 3D-сцены без стилизации.",
    };
  },
};

export const openaiProvider: ImageProvider = {
  name: "openai",
  async generate(req) {
    const key = config.images.openaiApiKey;
    if (!key) throw new Error("OPENAI_API_KEY не задан");
    const form = new FormData();
    form.set("model", config.images.openaiModel);
    form.set("prompt", req.prompt);
    form.set("n", "1");
    form.set("size", req.size ?? "1536x1024");
    form.set("quality", config.images.openaiQuality);
    if (config.images.openaiModel.startsWith("gpt-image")) form.set("input_fidelity", "high");
    const ordered = [...req.images].sort((a, b) => (a.role === "base" ? -1 : b.role === "base" ? 1 : 0)).slice(0, 10);
    for (const [i, img] of ordered.entries()) {
      const png = await toPng(img);
      form.append("image[]", new Blob([new Uint8Array(png.data)], { type: png.mediaType }), `${img.role}-${i}.${png.mediaType === "image/jpeg" ? "jpg" : "png"}`);
    }
    const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) throw new Error(`OpenAI images: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI images: пустой ответ");
    return { data: Buffer.from(b64, "base64"), mediaType: "image/png", provider: `openai:${config.images.openaiModel}` };
  },
};

async function geminiCall(model: string, req: RenderRequest, key: string): Promise<Response> {
  const parts: Array<Record<string, unknown>> = [{ text: req.prompt }];
  for (const img of [...req.images].sort((a, b) => (a.role === "base" ? -1 : b.role === "base" ? 1 : 0)).slice(0, 8)) {
    const jpg = await toJpeg(img, 1280);
    parts.push({ text: `[${img.label ?? img.role}]` });
    parts.push({ inlineData: { mimeType: jpg.mediaType, data: jpg.data.toString("base64") } });
  }
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
  });
}

export const geminiProvider: ImageProvider = {
  name: "gemini",
  async generate(req) {
    const key = config.images.geminiApiKey;
    if (!key) throw new Error("GEMINI_API_KEY не задан");
    let res = await geminiCall(config.images.geminiModel, req, key);
    let model = config.images.geminiModel;
    if (res.status === 404 && config.images.geminiFallbackModel && config.images.geminiFallbackModel !== model) {
      model = config.images.geminiFallbackModel;
      res = await geminiCall(model, req, key);
    }
    if (!res.ok) throw new Error(`Gemini: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string }; text?: string }> } }> };
    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      const inline = part.inlineData ?? (part.inline_data ? { mimeType: part.inline_data.mime_type, data: part.inline_data.data } : undefined);
      if (inline?.data) {
        return { data: Buffer.from(inline.data, "base64"), mediaType: inline.mimeType === "image/jpeg" ? "image/jpeg" : "image/png", provider: `gemini:${model}` };
      }
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(" ");
    throw new Error(`Gemini не вернул изображение${text ? `: ${text.slice(0, 200)}` : ""}`);
  },
};

export function getImageProvider(): ImageProvider {
  switch (config.images.provider) {
    case "openai":
      return openaiProvider;
    case "gemini":
      return geminiProvider;
    default:
      return mockProvider;
  }
}
