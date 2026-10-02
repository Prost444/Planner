import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ChatMessage, Project, ProjectSummary } from "@planner/shared";
import { ProjectSchema, seedHallwayProject } from "@planner/shared";
import { config } from "./config.js";

const projectsDir = () => path.join(config.dataDir, "projects");
const chatsDir = () => path.join(config.dataDir, "chats");
export const uploadsDir = () => path.join(config.dataDir, "uploads");

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${nanoid(8)}`;

export async function ensureStorage(): Promise<void> {
  for (const d of [projectsDir(), chatsDir(), uploadsDir(), path.join(uploadsDir(), "seed"), path.join(uploadsDir(), "refs"), path.join(uploadsDir(), "snapshots"), path.join(uploadsDir(), "renders"), path.join(uploadsDir(), "products")]) {
    await fs.mkdir(d, { recursive: true });
  }
  // copy seed assets (the user's screenshots) so the seed project can reference them
  if (existsSync(config.seedAssetsDir)) {
    for (const f of await fs.readdir(config.seedAssetsDir)) {
      const target = path.join(uploadsDir(), "seed", f);
      if (!existsSync(target)) await fs.copyFile(path.join(config.seedAssetsDir, f), target);
    }
  }
  if ((await listProjects()).length === 0) {
    await saveProject(seedHallwayProject(newId("prj"), now()));
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const files = (await fs.readdir(projectsDir())).filter((f) => f.endsWith(".json"));
  const out: ProjectSummary[] = [];
  for (const f of files) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(projectsDir(), f), "utf8")) as Project;
      out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt });
    } catch {
      // skip broken files
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<Project | null> {
  const file = path.join(projectsDir(), `${safeId(id)}.json`);
  if (!existsSync(file)) return null;
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  const parsed = ProjectSchema.safeParse(raw);
  return parsed.success ? (parsed.data as Project) : (raw as Project);
}

export async function saveProject(project: Project): Promise<Project> {
  project.updatedAt = now();
  const file = path.join(projectsDir(), `${safeId(project.id)}.json`);
  const tmp = `${file}.${nanoid(4)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2));
  await fs.rename(tmp, file);
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(path.join(projectsDir(), `${safeId(id)}.json`), { force: true });
  await fs.rm(path.join(chatsDir(), `${safeId(id)}.ui.json`), { force: true });
  await fs.rm(path.join(chatsDir(), `${safeId(id)}.transcript.json`), { force: true });
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("bad id");
  return id;
}

// ---- uploads -------------------------------------------------------------

export interface DecodedImage {
  data: Buffer;
  mediaType: string;
  ext: string;
}

const MEDIA_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function decodeDataUrl(dataUrl: string): DecodedImage {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw new Error("Ожидается data URL с base64");
  const mediaType = m[1]!.toLowerCase();
  const ext = MEDIA_EXT[mediaType];
  if (!ext) throw new Error(`Неподдерживаемый тип изображения: ${mediaType}`);
  return { data: Buffer.from(m[2]!, "base64"), mediaType, ext };
}

/** Save bytes under uploads/<subdir>/ and return the public URL. */
export async function saveUpload(subdir: string, data: Buffer, ext: string, name?: string): Promise<string> {
  const dir = path.join(uploadsDir(), subdir);
  await fs.mkdir(dir, { recursive: true });
  const file = `${name ?? nanoid(10)}.${ext}`;
  await fs.writeFile(path.join(dir, file), data);
  return `/uploads/${subdir}/${file}`;
}

/** Resolve a public /uploads URL to a file on disk (rejects traversal). */
export function uploadPath(url: string): string | null {
  if (!url.startsWith("/uploads/")) return null;
  const rel = url.slice("/uploads/".length).split("?")[0]!;
  const abs = path.resolve(uploadsDir(), rel);
  if (!abs.startsWith(path.resolve(uploadsDir()) + path.sep)) return null;
  return abs;
}

export async function readUpload(url: string): Promise<DecodedImage | null> {
  const abs = uploadPath(url);
  if (!abs || !existsSync(abs)) return null;
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mediaType = Object.entries(MEDIA_EXT).find(([, e]) => e === ext || (ext === "jpeg" && e === "jpg"))?.[0];
  if (!mediaType) return null;
  return { data: await fs.readFile(abs), mediaType, ext };
}

export function uploadStream(url: string) {
  const abs = uploadPath(url);
  return abs && existsSync(abs) ? createReadStream(abs) : null;
}

// ---- chat ----------------------------------------------------------------

export async function getChat(id: string): Promise<ChatMessage[]> {
  const file = path.join(chatsDir(), `${safeId(id)}.ui.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(await fs.readFile(file, "utf8")) as ChatMessage[];
}

export async function saveChat(id: string, messages: ChatMessage[]): Promise<void> {
  await fs.writeFile(path.join(chatsDir(), `${safeId(id)}.ui.json`), JSON.stringify(messages, null, 2));
}

export async function getTranscript<T>(id: string): Promise<T[]> {
  const file = path.join(chatsDir(), `${safeId(id)}.transcript.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(await fs.readFile(file, "utf8")) as T[];
}

export async function saveTranscript<T>(id: string, messages: T[]): Promise<void> {
  await fs.writeFile(path.join(chatsDir(), `${safeId(id)}.transcript.json`), JSON.stringify(messages));
}

export async function clearChat(id: string): Promise<void> {
  await fs.rm(path.join(chatsDir(), `${safeId(id)}.ui.json`), { force: true });
  await fs.rm(path.join(chatsDir(), `${safeId(id)}.transcript.json`), { force: true });
}

// ---- per-project lock (agent turn vs. client autosave) -------------------

const locks = new Map<string, Promise<void>>();
const busy = new Set<string>();

export function isBusy(id: string): boolean {
  return busy.has(id);
}

export async function withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  locks.set(id, prev.then(() => next));
  await prev;
  busy.add(id);
  try {
    return await fn();
  } finally {
    busy.delete(id);
    release();
    if (locks.get(id) === next) locks.delete(id);
  }
}
