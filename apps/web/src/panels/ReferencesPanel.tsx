import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import type { ReferenceKind } from "@planner/shared";
import { fileToDataUrl } from "../api";
import { useStore } from "../store";

const KIND_LABELS: Record<ReferenceKind, string> = { style: "стиль", photo: "фото", plan: "план", product: "товар", other: "другое" };

export default function ReferencesPanel() {
  const project = useStore((s) => s.project);
  const addReference = useStore((s) => s.addReference);
  const deleteReference = useStore((s) => s.deleteReference);
  const selected = useStore((s) => s.selectedRefIds);
  const toggleRef = useStore((s) => s.toggleRef);
  const [kind, setKind] = useState<ReferenceKind>("style");
  const fileRef = useRef<HTMLInputElement>(null);
  if (!project) return null;
  return (
    <div className="refs">
      <div className="panel-head">
        <strong>Референсы и фото</strong>
      </div>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as ReferenceKind)}>
          {(Object.keys(KIND_LABELS) as ReferenceKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            for (const f of Array.from(e.target.files ?? [])) {
              await addReference(await fileToDataUrl(f), kind, f.name.replace(/\.[^.]+$/, ""));
            }
            e.target.value = "";
          }}
        />
        <button onClick={() => fileRef.current?.click()}>
          <ImagePlus size={14} /> Загрузить
        </button>
      </div>
      <p className="muted small">Отметьте референсы, которые нужно показать агенту в следующем сообщении. Референсы «стиль» используются при генерации рендеров автоматически.</p>
      <div className="ref-grid">
        {project.references.map((r) => (
          <div key={r.id} className={`ref ${selected.includes(r.id) ? "selected" : ""}`}>
            <a href={r.url} target="_blank" rel="noreferrer noopener">
              <img src={r.url} alt={r.caption ?? ""} loading="lazy" />
            </a>
            <div className="ref-meta">
              <label className="chk">
                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleRef(r.id)} /> показать
              </label>
              <span className="pill">{KIND_LABELS[r.kind]}</span>
              <button className="icon danger" onClick={() => window.confirm("Удалить референс?") && deleteReference(r.id)}>
                <Trash2 size={12} />
              </button>
            </div>
            {r.caption && <div className="small">{r.caption}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
