import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, ChatMessage, Project, ReferenceKind, Render, ToolEvent, ViewPreset } from "@planner/shared";
import { describeProject } from "@planner/shared";
import { config } from "../config.js";
import { normalizeForVision } from "../images.js";
import { decodeDataUrl, getChat, getProject, getTranscript, newId, now, readUpload, saveChat, saveProject, saveTranscript, saveUpload, withProjectLock } from "../storage.js";
import { COMPACTION_PROMPT, SYSTEM_PROMPT } from "./prompt.js";
import { runTool, toolDefinitions, type ToolContext } from "./tools.js";

type Msg = Anthropic.Beta.Messages.BetaMessageParam;
type ContentParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolUnion = Anthropic.Beta.Messages.BetaToolUnion;

export interface TurnAttachment {
  dataUrl: string;
  kind: ReferenceKind;
  caption?: string;
}

export interface TurnInput {
  projectId: string;
  text: string;
  attachments?: TurnAttachment[];
  /** Existing references to show the model again in this turn. */
  referenceIds?: string[];
  /** Fresh 3D snapshots from the client, as data URLs. */
  snapshots?: Partial<Record<ViewPreset, string>>;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 10 * 60 * 1000 });
  return client;
}

let serverSideFallbackOk = config.anthropic.serverSideFallback;

const IMAGE_MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

async function imageBlock(data: Buffer, mediaType: string): Promise<ContentParam | null> {
  const norm = await normalizeForVision({ data, mediaType });
  if (!IMAGE_MEDIA.has(norm.mediaType)) return null;
  return { type: "image", source: { type: "base64", media_type: norm.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: norm.data.toString("base64") } };
}

/** Drop thinking blocks before persisting: the next request then replays no thinking, which keeps history edits safe. */
function stripThinking(messages: Msg[]): Msg[] {
  return messages
    .map((m) => {
      if (m.role !== "assistant" || typeof m.content === "string") return m;
      const content = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
      return { ...m, content };
    })
    .filter((m) => typeof m.content === "string" || m.content.length > 0);
}

function transcriptSize(messages: Msg[]): number {
  return JSON.stringify(messages).length;
}

async function compactTranscript(messages: Msg[]): Promise<Msg[]> {
  const anthropic = getClient();
  const textOnly: Msg[] = messages.map((m) => {
    if (typeof m.content === "string") return m;
    const content = m.content
      .map((b): ContentParam | null => {
        if (b.type === "image") return { type: "text", text: "[изображение]" };
        if (b.type === "tool_result") return { type: "tool_result", tool_use_id: b.tool_use_id, content: typeof b.content === "string" ? b.content.slice(0, 2000) : b.content?.filter((c) => c.type === "text").map((c) => ({ ...c, text: (c as { text: string }).text.slice(0, 2000) })) };
        return b;
      })
      .filter((b): b is ContentParam => b !== null);
    return { ...m, content };
  });
  const res = await anthropic.beta.messages.create({
    model: config.anthropic.model,
    max_tokens: 8000,
    system: "Ты сжимаешь историю работы ассистента по ремонту в сводку.",
    messages: [...textOnly, { role: "user", content: COMPACTION_PROMPT }],
  });
  const summary = res.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return [
    { role: "user", content: [{ type: "text", text: `Сводка предыдущей переписки (контекст сжат автоматически):\n${summary}` }] },
    { role: "assistant", content: [{ type: "text", text: "Принято, продолжаем с этого места." }] },
  ];
}

function serverTools(): ToolUnion[] {
  if (!config.anthropic.webSearch) return [];
  const allowed = config.anthropic.webSearchAllowedDomains;
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: config.anthropic.webSearchMaxUses, user_location: { type: "approximate", country: "RU", city: "Moscow", timezone: "Europe/Moscow" }, ...(allowed.length ? { allowed_domains: allowed } : {}) },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: config.anthropic.webFetchMaxUses, max_content_tokens: 20000 },
  ];
}

function toolResultContent(out: { text: string; images?: Array<{ data: Buffer; mediaType: string }> }): Anthropic.Beta.Messages.BetaToolResultBlockParam["content"] {
  if (!out.images?.length) return out.text;
  const blocks: Array<Anthropic.Beta.Messages.BetaTextBlockParam | Anthropic.Beta.Messages.BetaImageBlockParam> = [{ type: "text", text: out.text }];
  for (const img of out.images) {
    if (!IMAGE_MEDIA.has(img.mediaType)) continue;
    blocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: img.data.toString("base64") } });
  }
  return blocks;
}

function summarizeToolInput(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "search_products":
      return `Поиск: ${String(i.query ?? "")}`;
    case "fetch_page_info":
      return `Читаю ${String(i.url ?? "")}`;
    case "add_product":
      return `В каталог: ${String(i.title ?? "")}`;
    case "place_item":
      return `Ставлю «${String(i.name ?? "")}» в (${i.x_cm},${i.y_cm})`;
    case "move_item":
      return `Двигаю ${String(i.item_id ?? "")}`;
    case "generate_render":
      return `Рендер: ${String(i.view ?? "")}`;
    case "update_brief":
      return "Обновляю бриф";
    case "web_search":
      return `Веб-поиск: ${String(i.query ?? "")}`;
    case "web_fetch":
      return `Открываю ${String(i.url ?? "")}`;
    default:
      return name;
  }
}

/** Run one user turn of the agent, streaming events to the client. */
export async function runTurn(input: TurnInput, emit: (ev: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  await withProjectLock(input.projectId, async () => {
    const project = await getProject(input.projectId);
    if (!project) throw new Error("Проект не найден");

    // 1. Persist fresh snapshots and new attachments.
    const uploadedRefs: Array<{ id: string; caption?: string }> = [];
    for (const [view, dataUrl] of Object.entries(input.snapshots ?? {})) {
      if (!dataUrl) continue;
      try {
        const img = decodeDataUrl(dataUrl);
        const url = await saveUpload(`snapshots/${project.id}`, img.data, img.ext, `${view}-${Date.now()}`);
        project.snapshots[view as ViewPreset] = { url, at: now() };
      } catch {
        // ignore bad snapshot
      }
    }
    for (const att of input.attachments ?? []) {
      const img = decodeDataUrl(att.dataUrl);
      const url = await saveUpload("refs", img.data, img.ext);
      const id = newId("ref");
      project.references.push({ id, kind: att.kind, url, caption: att.caption, addedAt: now() });
      uploadedRefs.push({ id, caption: att.caption });
    }
    await saveProject(project);
    emit({ type: "project_updated", project });

    // 2. Build the user message: project state + images + text.
    const content: ContentParam[] = [{ type: "text", text: `<project_state>\n${describeProject(project)}\n</project_state>` }];
    const showRefs = [...uploadedRefs.map((r) => r.id), ...(input.referenceIds ?? [])];
    for (const id of showRefs) {
      const ref = project.references.find((r) => r.id === id);
      if (!ref) continue;
      const file = await readUpload(ref.url);
      if (!file) continue;
      const block = await imageBlock(file.data, file.mediaType);
      if (!block) continue;
      content.push({ type: "text", text: `Изображение ${ref.id} (${ref.kind})${ref.caption ? `: ${ref.caption}` : ""}` });
      content.push(block);
    }
    const userText = input.text.trim() || "(сообщение без текста — посмотри приложенные изображения)";
    content.push({ type: "text", text: userText });

    let transcript = await getTranscript<Msg>(project.id);
    if (transcript.length >= config.anthropic.compactionMessages || transcriptSize(transcript) > config.anthropic.compactionChars) {
      emit({ type: "status", text: "Сжимаю историю диалога…" });
      transcript = await compactTranscript(transcript);
    }
    const messages: Msg[] = [...transcript, { role: "user", content }];

    // 3. Agent loop.
    const anthropic = getClient();
    const tools: ToolUnion[] = [...toolDefinitions(), ...serverTools()];
    const events: ToolEvent[] = [];
    let assistantText = "";
    let jsonRetries = 0;
    let compactedOnce = false;

    const ctx: ToolContext = {
      project,
      async save() {
        await saveProject(project);
        emit({ type: "project_updated", project });
      },
      status(text) {
        emit({ type: "status", text });
      },
      onRender(render: Render) {
        emit({ type: "render", render });
      },
    };

    for (let iteration = 0; iteration < config.anthropic.maxIterations; iteration++) {
      if (signal?.aborted) break;
      const params: Anthropic.Beta.Messages.MessageCreateParamsStreaming = {
        stream: true,
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: config.anthropic.effort },
        tools,
        messages,
        cache_control: { type: "ephemeral" },
        ...(serverSideFallbackOk ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      };

      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        const stream = anthropic.beta.messages.stream(params, { signal });
        let textBlockOpen = false;
        for await (const event of stream) {
          if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use" || event.content_block.type === "server_tool_use") {
              emit({ type: "status", text: `Вызываю ${event.content_block.name}…` });
            }
            textBlockOpen = event.content_block.type === "text";
            if (textBlockOpen && assistantText && !assistantText.endsWith("\n")) {
              assistantText += "\n\n";
              emit({ type: "text_delta", text: "\n\n" });
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              assistantText += event.delta.text;
              emit({ type: "text_delta", text: event.delta.text });
            } else if (event.delta.type === "thinking_delta" && event.delta.thinking) {
              emit({ type: "thinking_delta", text: event.delta.thinking });
            }
          }
        }
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError && serverSideFallbackOk && /fallback/i.test(err.message)) {
          serverSideFallbackOk = false; // account/model does not accept the beta – retry without it
          iteration--;
          continue;
        }
        if (err instanceof Anthropic.APIError || isAuthSetupError(err) || signal?.aborted || jsonRetries++ >= 2) throw err;
        continue; // unparseable tool input with eager streaming – re-issue the turn
      }

      if (message.stop_reason === "refusal") {
        emit({ type: "error", message: `Модель отклонила запрос${message.stop_details?.type === "refusal" ? ` (${message.stop_details.category ?? "без категории"})` : ""}.` });
        break;
      }
      if (message.stop_reason === "model_context_window_exceeded" && !compactedOnce) {
        compactedOnce = true;
        emit({ type: "status", text: "Контекст переполнен — сжимаю историю…" });
        const compacted = await compactTranscript(messages.slice(0, -1));
        messages.splice(0, messages.length, ...compacted, { role: "user", content });
        continue;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens" && toolUses.length) {
        emit({ type: "error", message: "Ответ модели обрезан по max_tokens во время вызова инструмента. Попробуйте ещё раз." });
        break;
      }
      messages.push({ role: "assistant", content: message.content });
      if (message.stop_reason === "pause_turn") continue;
      if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

      // Execute all tool calls of this turn, then return all results in ONE user message.
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const ev: ToolEvent = { id: tu.id, name: tu.name, input: tu.input, summary: summarizeToolInput(tu.name, tu.input), status: "running" };
        events.push(ev);
        emit({ type: "tool_start", id: tu.id, name: tu.name, input: tu.input });
        const out = await runTool(tu.name, tu.input, ctx);
        ev.status = out.isError ? "error" : "done";
        ev.summary = out.text.split("\n")[0]?.slice(0, 200);
        emit({ type: "tool_result", id: tu.id, name: tu.name, summary: ev.summary ?? "", isError: out.isError });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: toolResultContent(out), ...(out.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }

    if (signal?.aborted) return; // client disconnected – nothing to persist beyond what tools already saved

    // 4. Persist transcript (thinking stripped) and UI chat.
    await saveTranscript(project.id, stripThinking(messages));
    const chat = await getChat(project.id);
    const userMsg: ChatMessage = { id: newId("msg"), role: "user", text: input.text, images: uploadedRefs.map((r) => project.references.find((x) => x.id === r.id)!.url), createdAt: now() };
    const assistantMsg: ChatMessage = { id: newId("msg"), role: "assistant", text: assistantText.trim(), events, createdAt: now() };
    chat.push(userMsg, assistantMsg);
    await saveChat(project.id, chat);
    emit({ type: "done", message: assistantMsg });
  });
}

/** The SDK throws a plain AnthropicError (not an APIError) when no credentials are configured at all. */
function isAuthSetupError(err: unknown): boolean {
  return err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError) && /authentication method|api key|apiKey/i.test(err.message);
}

/** Human-readable explanation for API failures. */
export function explainError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || isAuthSetupError(err)) return "Не удалось авторизоваться в Anthropic API: задайте ANTHROPIC_API_KEY в .env (или выполните `ant auth login`) и перезапустите сервер.";
  if (err instanceof Anthropic.RateLimitError) return "Лимит запросов Anthropic API исчерпан — повторите через минуту.";
  if (err instanceof Anthropic.BadRequestError) return `Anthropic API отклонил запрос: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `Нет связи с Anthropic API: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Ошибка Anthropic API ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export type { Project };
