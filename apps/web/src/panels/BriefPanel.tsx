import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useStore } from "../store";

function ListEditor({ title, items, onChange, placeholder }: { title: string; items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...items, t]);
    setDraft("");
  };
  return (
    <div className="brief-list">
      <h4>{title}</h4>
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <span>{it}</span>
            <button className="icon" onClick={() => onChange(items.filter((_, j) => j !== i))} title="Удалить">
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="icon" onClick={add} title="Добавить">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

export default function BriefPanel() {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  if (!project) return null;
  const b = project.brief;
  return (
    <div className="brief">
      <div className="panel-head">
        <strong>Бриф</strong>
        <span className="muted">всё это агент держит в контексте</span>
      </div>
      <label className="field">
        <span>Стиль</span>
        <input value={b.style} onChange={(e) => update((p) => void (p.brief.style = e.target.value))} placeholder="mid-century modern, тёплое дерево…" />
      </label>
      <label className="field">
        <span>Бюджет, ₽</span>
        <input type="number" value={b.budget ?? ""} onChange={(e) => update((p) => void (p.brief.budget = e.target.value ? Number(e.target.value) : undefined))} placeholder="например 60000" />
      </label>
      <ListEditor title="Пожелания" items={b.wishes} onChange={(next) => update((p) => void (p.brief.wishes = next))} placeholder="добавить пожелание" />
      <ListEditor title="Ограничения и факты" items={b.constraints} onChange={(next) => update((p) => void (p.brief.constraints = next))} placeholder="например: розетка справа от двери" />
      <label className="field">
        <span>Заметки</span>
        <textarea rows={5} value={b.notes} onChange={(e) => update((p) => void (p.brief.notes = e.target.value))} />
      </label>
    </div>
  );
}
