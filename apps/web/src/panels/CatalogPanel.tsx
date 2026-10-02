import { useMemo, useState } from "react";
import { ExternalLink, MapPin, Trash2 } from "lucide-react";
import { PRODUCT_SOURCE_LABELS, type ItemKind, type Product } from "@planner/shared";
import { useStore } from "../store";

const STATUS_LABELS: Record<Product["status"], string> = { candidate: "кандидат", shortlisted: "в шорт-листе", chosen: "выбран", rejected: "отклонён" };

export function guessKind(title: string): ItemKind {
  const t = title.toLowerCase();
  if (/пуф|банкетк|табурет|скамь|скамей|стул|кресл/.test(t)) return "seating";
  if (/зеркал/.test(t)) return "mirror";
  if (/вешал|крюч/.test(t)) return "hooks";
  if (/полк|антресол/.test(t)) return "shelf";
  if (/ковр|ковёр|дорожк/.test(t)) return "rug";
  if (/бра|светил|лампа|люстр/.test(t)) return "lighting";
  if (/тумб|шкаф|комод|обувниц|стеллаж|галошниц/.test(t)) return "storage";
  if (/консол|стол/.test(t)) return "table";
  if (/растен|кашпо|цвет/.test(t)) return "plant";
  return "furniture";
}

export default function CatalogPanel() {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const setItemTemplate = useStore((s) => s.setItemTemplate);
  const toast = useStore((s) => s.toast);
  const [filter, setFilter] = useState<Product["status"] | "all">("all");
  const catalog = project?.catalog ?? [];
  const placed = useMemo(() => new Set((project?.plan.items ?? []).map((i) => i.productId).filter(Boolean)), [project]);
  const list = catalog.filter((p) => filter === "all" || p.status === filter).slice().reverse();

  const place = (p: Product) => {
    const dims = p.dims ?? {};
    const kind = guessKind(p.title);
    const w = dims.w ?? 50;
    const d = dims.d ?? (kind === "mirror" || kind === "hooks" ? 5 : 40);
    const h = dims.h ?? 45;
    if (!p.dims?.w || !p.dims?.d || !p.dims?.h) toast("У товара известны не все размеры — поставлены значения по умолчанию, поправьте в свойствах", "info");
    setItemTemplate({ name: p.title.slice(0, 40), kind, w, d, h, elevation: kind === "mirror" ? 60 : kind === "hooks" ? 160 : kind === "shelf" ? 180 : 0, productId: p.id, imageUrl: p.imageUrl });
    toast("Кликните на плане, куда поставить предмет (R — повернуть)");
  };

  return (
    <div className="catalog">
      <div className="panel-head">
        <strong>Каталог</strong>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Product["status"] | "all")}>
          <option value="all">все ({catalog.length})</option>
          {(Object.keys(STATUS_LABELS) as Product["status"][]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]} ({catalog.filter((p) => p.status === s).length})
            </option>
          ))}
        </select>
      </div>
      {list.length === 0 && <div className="empty">Пока пусто. Попросите агента: «найди узкую обувницу до 25 см глубиной» — найденные товары появятся здесь с размерами и ценами.</div>}
      <div className="cards">
        {list.map((p) => (
          <div key={p.id} className={`card status-${p.status}`}>
            <div className="card-img">{p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="noimg">нет фото</div>}</div>
            <div className="card-body">
              <div className="card-title" title={p.title}>
                {p.title}
              </div>
              <div className="card-meta">
                <span className="pill">{PRODUCT_SOURCE_LABELS[p.source]}</span>
                {p.price ? <strong>{p.price.toLocaleString("ru-RU")} ₽</strong> : <span className="muted">цена ?</span>}
              </div>
              <div className="card-dims">
                {p.dims ? (
                  <>
                    {p.dims.w ?? "?"}×{p.dims.d ?? "?"}×{p.dims.h ?? "?"} см <span className={`conf conf-${p.dimsConfidence}`}>{{ exact: "точно", estimated: "примерно", unknown: "неизв." }[p.dimsConfidence]}</span>
                  </>
                ) : (
                  <span className="muted">размеры неизвестны</span>
                )}
                {placed.has(p.id) && <span className="pill ok">на плане</span>}
              </div>
              {p.notes && <div className="card-notes">{p.notes}</div>}
              <div className="card-actions">
                <select
                  value={p.status}
                  onChange={(e) =>
                    update((pr) => {
                      const x = pr.catalog.find((c) => c.id === p.id);
                      if (x) x.status = e.target.value as Product["status"];
                    })
                  }
                >
                  {(Object.keys(STATUS_LABELS) as Product["status"][]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <button title="Поставить на план" onClick={() => place(p)}>
                  <MapPin size={14} /> на план
                </button>
                <a className="btn" href={p.url} target="_blank" rel="noreferrer noopener" title="Открыть страницу товара">
                  <ExternalLink size={14} />
                </a>
                <button
                  className="icon danger"
                  title="Удалить из каталога"
                  onClick={() =>
                    update((pr) => {
                      pr.catalog = pr.catalog.filter((c) => c.id !== p.id);
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
