import { useState } from "react";
import { Camera, Loader2, Sparkles } from "lucide-react";
import { VIEW_PRESET_LABELS, type Render, type ViewPreset } from "@planner/shared";
import { useStore } from "../store";

export default function RendersPanel() {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const uploadSnapshotsNow = useStore((s) => s.uploadSnapshotsNow);
  const setRightTab = useStore((s) => s.setRightTab);
  const serverInfo = useStore((s) => s.serverInfo);
  const [open, setOpen] = useState<Render | null>(null);
  const [busy, setBusy] = useState(false);
  if (!project) return null;
  const renders = project.renders.slice().reverse();
  const snaps = Object.entries(project.snapshots) as Array<[ViewPreset, { url: string; at: string }]>;

  const toReference = (r: Render) => {
    update((p) => {
      p.references.push({ id: `ref_${Math.random().toString(36).slice(2, 10)}`, kind: "style", url: r.url, caption: `Рендер (${VIEW_PRESET_LABELS[r.view]})`, addedAt: new Date().toISOString() });
    });
    useStore.getState().toast("Добавлено в референсы");
  };

  return (
    <div className="renders">
      <div className="panel-head">
        <strong>Рендеры</strong>
        {serverInfo && <span className="muted">{serverInfo.imageProvider === "mock" ? "генерация не настроена" : serverInfo.imageProvider}</span>}
      </div>
      {serverInfo?.imageProvider === "mock" && (
        <div className="banner">
          Чтобы агент делал фотореалистичные картинки, задайте <code>OPENAI_API_KEY</code> или <code>GEMINI_API_KEY</code> в <code>.env</code>. Пока вместо рендера будет возвращаться снимок 3D-сцены.
        </div>
      )}
      <section>
        <h4>
          Снимки 3D-сцены <span className="muted">(основа для рендера)</span>
        </h4>
        <div className="snaps">
          {snaps.length === 0 && <div className="empty">Снимков ещё нет — они делаются автоматически при отправке сообщения, либо нажмите кнопку.</div>}
          {snaps.map(([view, s]) => (
            <a key={view} href={s.url} target="_blank" rel="noreferrer noopener" className="snap" title={new Date(s.at).toLocaleString("ru-RU")}>
              <img src={s.url} alt={view} />
              <span>{VIEW_PRESET_LABELS[view]}</span>
            </a>
          ))}
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            try {
              await uploadSnapshotsNow();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Camera size={14} />} Обновить снимки
        </button>
      </section>
      <section>
        <h4>Визуализации</h4>
        {renders.length === 0 && (
          <div className="empty">
            Попросите агента: «сгенерируй рендер от входа».{" "}
            <button className="link" onClick={() => setRightTab("chat")}>
              <Sparkles size={12} /> в чат
            </button>
          </div>
        )}
        <div className="render-grid">
          {renders.map((r) => (
            <div key={r.id} className="render-card">
              <img src={r.url} alt={r.view} onClick={() => setOpen(r)} />
              <div className="render-meta">
                <span>{VIEW_PRESET_LABELS[r.view]}</span>
                <span className="muted">{r.provider}</span>
              </div>
              <div className="row">
                <button onClick={() => toReference(r)}>В референсы</button>
                <a className="btn" href={r.url} target="_blank" rel="noreferrer noopener">
                  Открыть
                </a>
              </div>
              {r.note && <div className="muted small">{r.note}</div>}
            </div>
          ))}
        </div>
      </section>
      {open && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <img src={open.url} alt="" />
          <div className="lightbox-caption">
            {VIEW_PRESET_LABELS[open.view]} · {open.provider} · {new Date(open.createdAt).toLocaleString("ru-RU")}
          </div>
        </div>
      )}
    </div>
  );
}
