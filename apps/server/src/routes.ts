import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Project, ViewPreset } from "@planner/shared";
import { MATERIALS, ProjectSchema, emptyProject, seedHallwayProject } from "@planner/shared";
import { explainError, runTurn } from "./agent/agent.js";
import { describeConfig } from "./config.js";
import { clearChat, decodeDataUrl, deleteProject, getChat, getProject, isBusy, listProjects, newId, now, saveProject, saveUpload, uploadStream, withProjectLock } from "./storage.js";

const ChatBody = z.object({
  text: z.string().default(""),
  attachments: z.array(z.object({ dataUrl: z.string(), kind: z.enum(["style", "photo", "product", "plan", "other"]).default("style"), caption: z.string().optional() })).default([]),
  referenceIds: z.array(z.string()).default([]),
  snapshots: z.record(z.string(), z.string()).default({}),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({ ok: true, ...describeConfig() }));
  app.get("/api/materials", async () => MATERIALS);

  app.get("/api/projects", async () => listProjects());

  app.post("/api/projects", async (req) => {
    const body = (req.body ?? {}) as { name?: string; template?: "hallway" | "empty" };
    const id = newId("prj");
    const project = body.template === "hallway" ? seedHallwayProject(id, now()) : emptyProject(id, now(), body.name);
    if (body.name) project.name = body.name;
    await saveProject(project);
    return project;
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await getProject(id);
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });

  app.put("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isBusy(id)) return reply.code(409).send({ error: "agent_busy", message: "Агент сейчас меняет проект — подождите завершения ответа." });
    const parsed = ProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_project", issues: parsed.error.issues.slice(0, 10) });
    if (parsed.data.id !== id) return reply.code(400).send({ error: "id_mismatch" });
    const existing = await getProject(id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    const incoming = parsed.data as Project;
    const baseUpdatedAt = (req.headers["x-base-updated-at"] as string | undefined) ?? incoming.updatedAt;
    if (existing.updatedAt !== baseUpdatedAt) return reply.code(409).send({ error: "stale", message: "Проект изменился на сервере", project: existing });
    return withProjectLock(id, () => saveProject(incoming));
  });

  app.delete("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    await deleteProject(id);
    return { ok: true };
  });

  app.post("/api/projects/:id/references", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ dataUrl: z.string(), kind: z.enum(["style", "photo", "product", "plan", "other"]).default("style"), caption: z.string().optional() }).parse(req.body);
    const p = await getProject(id);
    if (!p) return reply.code(404).send({ error: "not found" });
    const img = decodeDataUrl(body.dataUrl);
    const url = await saveUpload("refs", img.data, img.ext);
    p.references.push({ id: newId("ref"), kind: body.kind, url, caption: body.caption, addedAt: now() });
    await saveProject(p);
    return p;
  });

  app.delete("/api/projects/:id/references/:refId", async (req, reply) => {
    const { id, refId } = req.params as { id: string; refId: string };
    const p = await getProject(id);
    if (!p) return reply.code(404).send({ error: "not found" });
    p.references = p.references.filter((r) => r.id !== refId);
    await saveProject(p);
    return p;
  });

  app.post("/api/projects/:id/snapshots", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ snapshots: z.record(z.string(), z.string()) }).parse(req.body);
    const p = await getProject(id);
    if (!p) return reply.code(404).send({ error: "not found" });
    for (const [view, dataUrl] of Object.entries(body.snapshots)) {
      const img = decodeDataUrl(dataUrl);
      const url = await saveUpload(`snapshots/${p.id}`, img.data, img.ext, `${view}-${Date.now()}`);
      p.snapshots[view as ViewPreset] = { url, at: now() };
    }
    await saveProject(p);
    return p;
  });

  app.get("/api/projects/:id/chat", async (req) => {
    const { id } = req.params as { id: string };
    return getChat(id);
  });

  app.delete("/api/projects/:id/chat", async (req) => {
    const { id } = req.params as { id: string };
    await clearChat(id);
    return { ok: true };
  });

  /** Server-sent events stream of one agent turn. */
  app.post("/api/projects/:id/chat", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ChatBody.parse(req.body);
    if (isBusy(id)) return reply.code(409).send({ error: "agent_busy", message: "Агент уже отвечает на предыдущее сообщение." });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.flushHeaders?.();
    const send = (data: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const ping = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": ping\n\n");
    }, 15000);
    const ctrl = new AbortController();
    // ServerResponse "close" before we end the response means the client went away.
    // (IncomingMessage "close" fires as soon as the request body is consumed, so it must not be used here.)
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) ctrl.abort();
    });

    try {
      await runTurn(
        { projectId: id, text: body.text, attachments: body.attachments, referenceIds: body.referenceIds, snapshots: body.snapshots as Partial<Record<ViewPreset, string>> },
        send,
        ctrl.signal,
      );
    } catch (err) {
      req.log.error(err);
      send({ type: "error", message: explainError(err) });
    } finally {
      clearInterval(ping);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
    return reply;
  });

  app.get("/uploads/*", async (req, reply) => {
    const rest = (req.params as { "*": string })["*"];
    const stream = uploadStream(`/uploads/${rest}`);
    if (!stream) return reply.code(404).send({ error: "not found" });
    const ext = rest.split(".").pop()?.toLowerCase();
    const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[ext ?? ""] ?? "application/octet-stream";
    reply.header("content-type", type).header("cache-control", "public, max-age=31536000, immutable");
    return reply.send(stream);
  });
}
