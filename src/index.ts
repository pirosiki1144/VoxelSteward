import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";

export const healthPayload = () => ({
  service: "voxel-steward",
  status: "ok",
});

const log = (level: "info" | "error", event: string, details = {}): void => {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };

  process.stdout.write(`${JSON.stringify(record)}\n`);
};

export const createHealthServer = (): Server =>
  createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(healthPayload()));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

const start = (): void => {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createHealthServer();

  server.listen(port, host, () => {
    log("info", "service.started", { host, port });
  });

  let stopping = false;

  process.on("SIGTERM", () => {
    if (stopping) return;
    stopping = true;
    log("info", "service.stopping", { signal: "SIGTERM" });

    server.close((error) => {
      if (error) {
        log("error", "service.stop_failed", { message: error.message });
        process.exitCode = 1;
        return;
      }

      log("info", "service.stopped");
    });
  });
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  start();
}
