import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Camera, ImagePlus, Loader2, Send, Trash2, X } from "lucide-react";
import type { ChatMessage, ReferenceKind, ToolEvent } from "@planner/shared";
import { fileToDataUrl } from "../api";
import { useStore } from "../store";

const KIND_LABELS: Record<ReferenceKind, string> = { style: "Референс стиля", photo: "Фото квартиры", plan: "План / чертёж", product: "Товар", other: "Другое" };

const QUICK_PROMPTS = [
  "Найди пуф 30×35 см в стиле mid-century до 6000 ₽ и поставь его под вешалку",
  "Предложи, как организовать хранение обуви и верхней одежды в этой прихожей, с конкретными товарами и ценами",
  "Замени скамейку на советскую винтажную тумбу с Авито — подбери 3 варианта по размеру",
  "Что можно разместить в нише 38×29 см у входа, не перекрыв выключатель?",
  "Сгенерируй рендер от входа в стиле mid-century с отциклёванным паркетом",
];

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
        img: ({ src, alt }) => (
          <a href={src} target="_blank" rel="noreferrer noopener">
            <img src={src} alt={alt ?? ""} className="chat-img" />
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function EventChips({ events }: { events: ToolEvent[] }) {
  const [open, setOpen] = useState(false);
  if (!events.length) return null;
  return (
    <div className="chat-events">
      <button className="link" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Действия агента: {events.length}
      </button>
      {open && (
        <ul>
          {events.map((e) => (
            <li key={e.id} className={`ev ev-${e.status}`}>
              <code>{e.name}</code> {e.summary ?? ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  return (
    <div className={`msg msg-${m.role}`}>
      {m.images?.length ? (
        <div className="msg-images">
          {m.images.map((src, i) => (
            <a key={i} href={src} target="_blank" rel="noreferrer noopener">
              <img src={src} alt="" />
            </a>
          ))}
        </div>
      ) : null}
      {m.role === "assistant" ? <Markdown text={m.text || "…"} /> : <div className="msg-text">{m.text}</div>}
      {m.events && <EventChips events={m.events} />}
    </div>
  );
}

export default function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const streaming = useStore((s) => s.streaming);
  const busy = useStore((s) => s.agentBusy);
  const send = useStore((s) => s.sendMessage);
  const clear = useStore((s) => s.clearChat);
  const attachSnapshots = useStore((s) => s.attachSnapshots);
  const setAttachSnapshots = useStore((s) => s.setAttachSnapshots);
  const selectedRefIds = useStore((s) => s.selectedRefIds);
  const serverInfo = useStore((s) => s.serverInfo);
  const capture = useStore((s) => s.capture);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Array<{ dataUrl: string; kind: ReferenceKind; caption?: string }>>([]);
  const [showThinking, setShowThinking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, streaming?.text, streaming?.events.length, streaming?.status]);

  const submit = async () => {
    if (busy || (!text.trim() && !attachments.length)) return;
    const t = text;
    const a = attachments;
    setText("");
    setAttachments([]);
    await send(t, a);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const next = [...attachments];
    for (const f of Array.from(files)) {
      try {
        next.push({ dataUrl: await fileToDataUrl(f), kind: "style", caption: f.name.replace(/\.[^.]+$/, "") });
      } catch (e) {
        useStore.getState().toast((e as Error).message, "error");
      }
    }
    setAttachments(next);
  };

  return (
    <div className="chat">
      <div className="panel-head">
        <div>
          <strong>Агент-дизайнер</strong>
          {serverInfo && <span className="muted"> · {serverInfo.model}</span>}
        </div>
        <button className="icon" title="Очистить историю" onClick={() => window.confirm("Очистить историю чата?") && clear()}>
          <Trash2 size={16} />
        </button>
      </div>
      {serverInfo && !serverInfo.anthropicKeyPresent && (
        <div className="banner warn">
          Ключ Anthropic не задан: добавьте <code>ANTHROPIC_API_KEY</code> в <code>.env</code> и перезапустите сервер. Редактор и 3D работают без ключа.
        </div>
      )}
      <div className="chat-list" ref={listRef}>
        {chat.length === 0 && !streaming && (
          <div className="chat-empty">
            <p>Агент видит ваш план с точными размерами, бриф и каталог. Попросите его найти мебель, проверить, что она встанет, расставить её и показать рендер.</p>
            <div className="quick">
              {QUICK_PROMPTS.map((q) => (
                <button key={q} onClick={() => setText(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {streaming && (
          <div className="msg msg-assistant streaming">
            {streaming.status && (
              <div className="status">
                <Loader2 size={14} className="spin" /> {streaming.status}
              </div>
            )}
            {streaming.events.length > 0 && (
              <ul className="live-events">
                {streaming.events.slice(-6).map((e) => (
                  <li key={e.id} className={`ev ev-${e.status}`}>
                    {e.status === "running" ? <Loader2 size={12} className="spin" /> : e.status === "error" ? "⚠" : "✓"} {e.summary ?? e.name}
                  </li>
                ))}
              </ul>
            )}
            {streaming.thinking && (
              <div className="thinking">
                <button className="link" onClick={() => setShowThinking((v) => !v)}>
                  {showThinking ? "▾" : "▸"} размышления
                </button>
                {showThinking && <pre>{streaming.thinking}</pre>}
              </div>
            )}
            {streaming.text && <Markdown text={streaming.text} />}
            {!streaming.text && !streaming.status && !streaming.events.length && (
              <div className="status">
                <Loader2 size={14} className="spin" /> Думаю…
              </div>
            )}
          </div>
        )}
      </div>
      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((a, i) => (
              <div key={i} className="att">
                <img src={a.dataUrl} alt="" />
                <select value={a.kind} onChange={(e) => setAttachments((list) => list.map((x, j) => (j === i ? { ...x, kind: e.target.value as ReferenceKind } : x)))}>
                  {(Object.keys(KIND_LABELS) as ReferenceKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <button className="icon" onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={text}
          placeholder="Например: подбери узкую обувницу до 25 см глубиной на стену слева от входа"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={3}
          disabled={busy}
        />
        <div className="composer-row">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
          <button className="icon" title="Прикрепить референсы / фото" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImagePlus size={16} />
          </button>
          <label className={`chk ${!capture ? "muted" : ""}`} title="Перед отправкой снимаются 4 ракурса 3D-сцены: по ним агент делает рендеры">
            <input type="checkbox" checked={attachSnapshots} onChange={(e) => setAttachSnapshots(e.target.checked)} /> <Camera size={14} /> снимки 3D
          </label>
          {selectedRefIds.length > 0 && <span className="pill">+{selectedRefIds.length} реф.</span>}
          <span className="spacer" />
          <button className="primary" onClick={() => void submit()} disabled={busy || (!text.trim() && !attachments.length)}>
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Отправить
          </button>
        </div>
      </div>
    </div>
  );
}
