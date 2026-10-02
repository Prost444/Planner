import { create } from "zustand";
import type { AgentEvent, ChatMessage, Opening, OpeningType, PlacedItem, Project, ProjectSummary, ReferenceKind, ToolEvent, ViewPreset } from "@planner/shared";
import { api } from "./api";

export type EditorMode = "select" | "wall" | "room" | "opening" | "item" | "ruler" | "label" | "pan";
export type SelectionType = "wall" | "opening" | "item" | "room" | "label" | "measurement";
export interface Selection {
  type: SelectionType;
  id: string;
}
export type RightTab = "chat" | "catalog" | "brief" | "renders" | "refs" | "inspector";

/** Template for the item placement tool (generic furniture or a catalog product). */
export interface ItemTemplate {
  name: string;
  kind: PlacedItem["kind"];
  w: number;
  d: number;
  h: number;
  elevation?: number;
  color?: string;
  productId?: string;
  imageUrl?: string;
}

export interface StreamingState {
  text: string;
  thinking: string;
  status: string;
  events: ToolEvent[];
}

export type CaptureFn = (views: ViewPreset[]) => Promise<Partial<Record<ViewPreset, string>>>;

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

interface State {
  projects: ProjectSummary[];
  project: Project | null;
  baseUpdatedAt: string | null;
  dirty: boolean;
  saving: boolean;
  serverInfo: { model: string; anthropicKeyPresent: boolean; imageProvider: string; searchProviders: Record<string, boolean> } | null;

  view: "2d" | "3d";
  mode: EditorMode;
  openingType: OpeningType;
  itemTemplate: ItemTemplate | null;
  wallThickness: number;
  selection: Selection | null;
  showDims: boolean;
  showLabels3d: boolean;
  rightTab: RightTab;
  history: Project[];
  future: Project[];

  chat: ChatMessage[];
  streaming: StreamingState | null;
  agentBusy: boolean;
  attachSnapshots: boolean;
  selectedRefIds: string[];
  capture: CaptureFn | null;
  toasts: Toast[];

  init(): Promise<void>;
  openProject(id: string): Promise<void>;
  createProject(template: "hallway" | "empty", name?: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Apply a mutation to the project; records undo history and schedules autosave. */
  update(mutate: (p: Project) => void, opts?: { record?: boolean }): void;
  undo(): void;
  redo(): void;
  flushSave(): Promise<void>;

  setView(v: "2d" | "3d"): void;
  setMode(m: EditorMode): void;
  setOpeningType(t: OpeningType): void;
  setItemTemplate(t: ItemTemplate | null): void;
  setWallThickness(t: number): void;
  select(s: Selection | null): void;
  setShowDims(v: boolean): void;
  setShowLabels3d(v: boolean): void;
  setRightTab(t: RightTab): void;
  setCapture(fn: CaptureFn | null): void;
  toggleRef(id: string): void;
  setAttachSnapshots(v: boolean): void;
  toast(text: string, kind?: "info" | "error"): void;
  dismissToast(id: number): void;

  deleteSelection(): void;
  rotateSelection(deg: number): void;

  sendMessage(text: string, attachments: Array<{ dataUrl: string; kind: ReferenceKind; caption?: string }>): Promise<void>;
  clearChat(): Promise<void>;
  uploadSnapshotsNow(): Promise<void>;
  addReference(dataUrl: string, kind: ReferenceKind, caption?: string): Promise<void>;
  deleteReference(refId: string): Promise<void>;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 1;

export const useStore = create<State>((set, get) => ({
  projects: [],
  project: null,
  baseUpdatedAt: null,
  dirty: false,
  saving: false,
  serverInfo: null,

  view: "2d",
  mode: "select",
  openingType: "door",
  itemTemplate: null,
  wallThickness: 10,
  selection: null,
  showDims: true,
  showLabels3d: true,
  rightTab: "chat",
  history: [],
  future: [],

  chat: [],
  streaming: null,
  agentBusy: false,
  attachSnapshots: true,
  selectedRefIds: [],
  capture: null,
  toasts: [],

  async init() {
    try {
      const [projects, info] = await Promise.all([api.listProjects(), api.health().catch(() => null)]);
      set({ projects, serverInfo: info ? { model: info.model, anthropicKeyPresent: info.anthropicKeyPresent, imageProvider: info.imageProvider, searchProviders: info.searchProviders } : null });
      const last = localStorage.getItem("planner:lastProject");
      const pick = projects.find((p) => p.id === last) ?? projects[0];
      if (pick) await get().openProject(pick.id);
    } catch (e) {
      get().toast(`Не удалось связаться с сервером: ${(e as Error).message}`, "error");
    }
  },

  async openProject(id) {
    await get().flushSave();
    const [project, chat] = await Promise.all([api.getProject(id), api.getChat(id).catch(() => [])]);
    localStorage.setItem("planner:lastProject", id);
    set({ project, baseUpdatedAt: project.updatedAt, chat, history: [], future: [], selection: null, dirty: false, streaming: null, selectedRefIds: [] });
  },

  async createProject(template, name) {
    const p = await api.createProject({ template, name });
    set({ projects: [{ id: p.id, name: p.name, updatedAt: p.updatedAt }, ...get().projects] });
    await get().openProject(p.id);
  },

  async deleteProject(id) {
    await api.deleteProject(id);
    const projects = get().projects.filter((p) => p.id !== id);
    set({ projects });
    if (get().project?.id === id) {
      set({ project: null, chat: [] });
      if (projects[0]) await get().openProject(projects[0].id);
    }
  },

  update(mutate, opts = {}) {
    const { project, agentBusy } = get();
    if (!project) return;
    if (agentBusy) {
      get().toast("Агент сейчас работает с проектом — подождите окончания ответа", "info");
      return;
    }
    const record = opts.record ?? true;
    const next = clone(project);
    mutate(next);
    set({ project: next, dirty: true, history: record ? [...get().history.slice(-60), project] : get().history, future: record ? [] : get().future });
    scheduleSave();
  },

  undo() {
    const { history, project } = get();
    const prev = history[history.length - 1];
    if (!prev || !project) return;
    set({ project: prev, history: history.slice(0, -1), future: [project, ...get().future].slice(0, 60), dirty: true });
    scheduleSave();
  },

  redo() {
    const { future, project } = get();
    const next = future[0];
    if (!next || !project) return;
    set({ project: next, future: future.slice(1), history: [...get().history, project], dirty: true });
    scheduleSave();
  },

  async flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const { project, dirty, baseUpdatedAt, agentBusy } = get();
    if (!project || !dirty || agentBusy) return;
    set({ saving: true });
    try {
      const saved = await api.saveProject(project, baseUpdatedAt ?? project.updatedAt);
      // keep local edits made while saving; only refresh the version marker
      set((s) => ({ saving: false, dirty: s.project !== project, baseUpdatedAt: saved.updatedAt, project: s.project === project ? { ...project, updatedAt: saved.updatedAt } : s.project, projects: s.projects.map((p) => (p.id === saved.id ? { ...p, name: saved.name, updatedAt: saved.updatedAt } : p)) }));
      if (get().dirty) scheduleSave();
    } catch (e) {
      const err = e as { status?: number; project?: Project; message: string };
      set({ saving: false });
      if (err.status === 409 && err.project) {
        set({ project: err.project, baseUpdatedAt: err.project.updatedAt, dirty: false, history: [], future: [] });
        get().toast("Проект обновился на сервере — загружена актуальная версия", "info");
      } else if (err.status === 409) {
        scheduleSave(2000);
      } else {
        get().toast(`Ошибка сохранения: ${err.message}`, "error");
      }
    }
  },

  setView: (view) => set({ view }),
  setMode: (mode) => set({ mode, selection: mode === "select" ? get().selection : null }),
  setOpeningType: (openingType) => set({ openingType, mode: "opening" }),
  setItemTemplate: (itemTemplate) => set({ itemTemplate, mode: itemTemplate ? "item" : "select", view: itemTemplate ? "2d" : get().view }),
  setWallThickness: (wallThickness) => set({ wallThickness }),
  select: (selection) => set({ selection, rightTab: selection ? "inspector" : get().rightTab === "inspector" ? "chat" : get().rightTab }),
  setShowDims: (showDims) => set({ showDims }),
  setShowLabels3d: (showLabels3d) => set({ showLabels3d }),
  setRightTab: (rightTab) => set({ rightTab }),
  setCapture: (capture) => set({ capture }),
  toggleRef: (id) => set((s) => ({ selectedRefIds: s.selectedRefIds.includes(id) ? s.selectedRefIds.filter((x) => x !== id) : [...s.selectedRefIds, id] })),
  setAttachSnapshots: (attachSnapshots) => set({ attachSnapshots }),
  toast: (text, kind = "info") => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  deleteSelection() {
    const sel = get().selection;
    if (!sel) return;
    get().update((p) => {
      switch (sel.type) {
        case "wall":
          p.plan.walls = p.plan.walls.filter((w) => w.id !== sel.id);
          p.plan.openings = p.plan.openings.filter((o) => o.wallId !== sel.id);
          break;
        case "opening":
          p.plan.openings = p.plan.openings.filter((o) => o.id !== sel.id);
          break;
        case "item":
          p.plan.items = p.plan.items.filter((i) => i.id !== sel.id);
          break;
        case "room":
          p.plan.rooms = p.plan.rooms.filter((r) => r.id !== sel.id);
          break;
        case "label":
          p.plan.labels = p.plan.labels.filter((l) => l.id !== sel.id);
          break;
        case "measurement":
          p.plan.measurements = p.plan.measurements.filter((m) => m.id !== sel.id);
          break;
      }
    });
    set({ selection: null });
  },

  rotateSelection(deg) {
    const sel = get().selection;
    if (!sel || sel.type !== "item") return;
    get().update((p) => {
      const it = p.plan.items.find((i) => i.id === sel.id);
      if (it) it.rotation = ((it.rotation + deg) % 360 + 360) % 360;
    });
  },

  async sendMessage(text, attachments) {
    const { project, agentBusy, capture, attachSnapshots, selectedRefIds } = get();
    if (!project || agentBusy) return;
    await get().flushSave();
    let snapshots: Partial<Record<ViewPreset, string>> = {};
    if (attachSnapshots && capture) {
      try {
        snapshots = await capture(["top", "entrance", "corner_left", "corner_right", "custom"]);
      } catch (e) {
        get().toast(`Не удалось снять 3D-вид: ${(e as Error).message}`, "error");
      }
    }
    const optimistic: ChatMessage = { id: `local_${Date.now()}`, role: "user", text, images: attachments.map((a) => a.dataUrl), createdAt: new Date().toISOString() };
    set({ agentBusy: true, chat: [...get().chat, optimistic], streaming: { text: "", thinking: "", status: "Думаю…", events: [] }, rightTab: "chat", selectedRefIds: [] });
    try {
      for await (const ev of api.chat(project.id, { text, attachments, referenceIds: selectedRefIds, snapshots })) {
        handleAgentEvent(ev, set, get);
      }
    } catch (e) {
      get().toast(`Ошибка чата: ${(e as Error).message}`, "error");
    } finally {
      const s = get();
      if (s.streaming) {
        // stream ended without a done event – keep what we have
        const partial: ChatMessage = { id: `local_${Date.now()}`, role: "assistant", text: s.streaming.text || "(ответ прерван)", events: s.streaming.events, createdAt: new Date().toISOString() };
        set({ chat: [...s.chat, partial], streaming: null });
      }
      set({ agentBusy: false });
      try {
        const fresh = await api.getProject(project.id);
        set({ project: fresh, baseUpdatedAt: fresh.updatedAt, dirty: false, history: [], future: [] });
      } catch {
        // ignore
      }
    }
  },

  async clearChat() {
    const p = get().project;
    if (!p) return;
    await api.clearChat(p.id);
    set({ chat: [] });
  },

  async uploadSnapshotsNow() {
    const { project, capture } = get();
    if (!project || !capture) {
      get().toast("3D-вид ещё не готов", "error");
      return;
    }
    const snaps = await capture(["top", "entrance", "corner_left", "corner_right", "custom"]);
    const fresh = await api.uploadSnapshots(project.id, snaps);
    set({ project: fresh, baseUpdatedAt: fresh.updatedAt, dirty: false });
    get().toast("Снимки 3D-сцены сохранены");
  },

  async addReference(dataUrl, kind, caption) {
    const p = get().project;
    if (!p) return;
    await get().flushSave();
    const fresh = await api.addReference(p.id, { dataUrl, kind, caption });
    set({ project: fresh, baseUpdatedAt: fresh.updatedAt, dirty: false });
  },

  async deleteReference(refId) {
    const p = get().project;
    if (!p) return;
    await get().flushSave();
    const fresh = await api.deleteReference(p.id, refId);
    set({ project: fresh, baseUpdatedAt: fresh.updatedAt, dirty: false });
  },
}));

function scheduleSave(delay = 800) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void useStore.getState().flushSave();
  }, delay);
}

function handleAgentEvent(ev: AgentEvent, set: (partial: Partial<State> | ((s: State) => Partial<State>)) => void, get: () => State) {
  switch (ev.type) {
    case "text_delta":
      set((s) => (s.streaming ? { streaming: { ...s.streaming, text: s.streaming.text + ev.text, status: "" } } : {}));
      break;
    case "thinking_delta":
      set((s) => (s.streaming ? { streaming: { ...s.streaming, thinking: (s.streaming.thinking + ev.text).slice(-4000) } } : {}));
      break;
    case "status":
      set((s) => (s.streaming ? { streaming: { ...s.streaming, status: ev.text } } : {}));
      break;
    case "tool_start":
      set((s) => (s.streaming ? { streaming: { ...s.streaming, status: "", events: [...s.streaming.events, { id: ev.id, name: ev.name, input: ev.input, status: "running" }] } } : {}));
      break;
    case "tool_result":
      set((s) => (s.streaming ? { streaming: { ...s.streaming, events: s.streaming.events.map((e) => (e.id === ev.id ? { ...e, status: ev.isError ? "error" : "done", summary: ev.summary } : e)) } } : {}));
      break;
    case "project_updated":
      set({ project: ev.project, baseUpdatedAt: ev.project.updatedAt, dirty: false });
      break;
    case "render":
      get().toast("Готов новый рендер — смотрите вкладку «Рендеры»");
      break;
    case "done":
      set((s) => ({ chat: [...s.chat, ev.message], streaming: null }));
      break;
    case "error":
      get().toast(ev.message, "error");
      set((s) => (s.streaming ? { streaming: { ...s.streaming, status: `Ошибка: ${ev.message}` } } : {}));
      break;
  }
}

/** Convenience selectors */
export const selectProject = (s: State) => s.project;
export function findSelected(project: Project | null, sel: Selection | null): { item?: PlacedItem; opening?: Opening } {
  if (!project || !sel) return {};
  if (sel.type === "item") return { item: project.plan.items.find((i) => i.id === sel.id) };
  if (sel.type === "opening") return { opening: project.plan.openings.find((o) => o.id === sel.id) };
  return {};
}
