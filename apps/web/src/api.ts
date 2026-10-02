import type { AgentEvent, ChatMessage, Material, Project, ProjectSummary, ReferenceKind, ViewPreset } from "@planner/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
      else if (body?.error) msg = body.error;
      if (res.status === 409 && body?.project) throw Object.assign(new Error(msg), { status: 409, project: body.project as Project });
    } catch (e) {
      if ((e as { status?: number }).status === 409) throw e;
    }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<{ ok: boolean; model: string; anthropicKeyPresent: boolean; imageProvider: string; searchProviders: Record<string, boolean> }>(r)),
  materials: () => fetch("/api/materials").then((r) => json<Material[]>(r)),
  listProjects: () => fetch("/api/projects").then((r) => json<ProjectSummary[]>(r)),
  getProject: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<Project>(r)),
  createProject: (body: { name?: string; template?: "hallway" | "empty" }) =>
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<Project>(r)),
  saveProject: (project: Project, baseUpdatedAt: string) =>
    fetch(`/api/projects/${project.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-base-updated-at": baseUpdatedAt }, body: JSON.stringify(project) }).then((r) => json<Project>(r)),
  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  addReference: (id: string, body: { dataUrl: string; kind: ReferenceKind; caption?: string }) =>
    fetch(`/api/projects/${id}/references`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<Project>(r)),
  deleteReference: (id: string, refId: string) => fetch(`/api/projects/${id}/references/${refId}`, { method: "DELETE" }).then((r) => json<Project>(r)),
  uploadSnapshots: (id: string, snapshots: Partial<Record<ViewPreset, string>>) =>
    fetch(`/api/projects/${id}/snapshots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ snapshots }) }).then((r) => json<Project>(r)),
  getChat: (id: string) => fetch(`/api/projects/${id}/chat`).then((r) => json<ChatMessage[]>(r)),
  clearChat: (id: string) => fetch(`/api/projects/${id}/chat`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),

  /** POST a chat turn and iterate server-sent events. */
  async *chat(
    id: string,
    body: { text: string; attachments: Array<{ dataUrl: string; kind: ReferenceKind; caption?: string }>; referenceIds: string[]; snapshots: Partial<Record<ViewPreset, string>> },
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const res = await fetch(`/api/projects/${id}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!res.ok || !res.body) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        msg = j.message ?? j.error ?? msg;
      } catch {
        // ignore
      }
      yield { type: "error", message: msg };
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            yield JSON.parse(line.slice(5).trim()) as AgentEvent;
          } catch {
            // ignore malformed
          }
        }
      }
    }
  },
};

export function fileToDataUrl(file: File, maxSide = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 2_500_000 && /image\/(png|jpeg|webp)/.test(file.type)) return resolve(reader.result as string);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.onerror = () => reject(new Error("Не удалось прочитать изображение"));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
