import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config, describeConfig } from "./config.js";
import { registerRoutes } from "./routes.js";
import { ensureStorage } from "./storage.js";

async function main() {
  await ensureStorage();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 60 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await registerRoutes(app);

  // Serve the built web client in production (apps/web/dist).
  if (existsSync(config.publicDir)) {
    await app.register(fastifyStatic, { root: config.publicDir, prefix: "/", wildcard: false });
    const indexHtml = await readFile(path.join(config.publicDir, "index.html"), "utf8");
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/uploads/")) return reply.code(404).send({ error: "not found" });
      return reply.type("text/html; charset=utf-8").send(indexHtml);
    });
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ config: describeConfig(), dataDir: config.dataDir }, "planner server started");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
