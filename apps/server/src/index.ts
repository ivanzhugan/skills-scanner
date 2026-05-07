import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import chokidar, { type FSWatcher } from "chokidar";
import type { AppState, HealthFinding, Manifest, Profile, Skill, SkillRoot } from "@skillset/shared";
import {
  applyProfile,
  buildManifestHealthFindings,
  createManifestStore,
  createProfile,
  mergeManifestIntoSkills,
  patchProfile,
  planProfile,
  undoLastApply,
  upsertProfile,
  type ManifestStore
} from "./manifest.js";
import { scanSkillRoots, type ScanResult } from "./scanner.js";

const DEFAULT_PORT = 4317;
const HOST = "127.0.0.1" as const;

export type StartServerOptions = {
  cwd?: string;
  port?: number;
  skillsetHome?: string;
};

export type StartedSkillSetServer = {
  server: Server;
  host: typeof HOST;
  port: number;
  url: string;
  state: AppState;
  close: () => Promise<void>;
};

type EventClient = {
  id: number;
  response: ServerResponse;
};

type RuntimeState = {
  cwd: string;
  roots: SkillRoot[];
  startedAt: string;
  scan: ScanResult;
  manifest: Manifest;
  manifestStore: ManifestStore;
  watcherErrors: string[];
};

let nextEventClientId = 1;

export async function startSkillSetServer(options: StartServerOptions = {}): Promise<StartedSkillSetServer> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const requestedPort = options.port ?? DEFAULT_PORT;
  const startedAt = new Date().toISOString();
  const roots = await detectSkillRoots(cwd);
  const manifestStore = createManifestStore(options.skillsetHome);
  const rawScan = await scanSkillRoots(roots);
  const manifest = await manifestStore.syncSkills(roots, rawScan.skills);
  const runtimeState: RuntimeState = {
    cwd,
    roots,
    startedAt,
    scan: mergeManifestIntoScan(manifest, rawScan),
    manifest,
    manifestStore,
    watcherErrors: []
  };
  const eventClients = new Map<number, EventClient>();
  const watcher = createSkillWatcher(runtimeState, eventClients);

  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, {
        runtimeState,
        getPort: () => addressPort(server),
        eventClients
      });
    } catch (error) {
      writeJson(response, 500, {
        error: "internal-server-error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const port = await listenWithFallback(server, requestedPort);
  const state: AppState = {
    status: "ok",
    host: HOST,
    port,
    cwd,
    roots,
    manifest: manifestStore.status,
    skillCount: runtimeState.scan.skills.length,
    healthFindingCount: runtimeState.scan.healthFindings.length,
    watcherErrors: runtimeState.watcherErrors,
    startedAt
  };

  broadcast(eventClients, "server.started", state);

  return {
    server,
    host: HOST,
    port,
    url: `http://${HOST}:${port}`,
    state,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        for (const client of eventClients.values()) {
          client.response.end();
        }
        void watcher.close().then(
          () => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          },
          (error) => rejectClose(error)
        );
      })
  };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    runtimeState: RuntimeState;
    getPort: () => number;
    eventClients: Map<number, EventClient>;
  }
) {
  const requestUrl = new URL(request.url ?? "/", `http://${HOST}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/state") {
    writeJson(response, 200, {
      status: "ok",
      host: HOST,
      port: context.getPort(),
      cwd: context.runtimeState.cwd,
      roots: context.runtimeState.roots,
      manifest: context.runtimeState.manifestStore.status,
      skillCount: context.runtimeState.scan.skills.length,
      healthFindingCount: context.runtimeState.scan.healthFindings.length,
      watcherErrors: context.runtimeState.watcherErrors,
      startedAt: context.runtimeState.startedAt
    } satisfies AppState);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/skills") {
    writeJson(response, 200, context.runtimeState.scan.skills satisfies Skill[]);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname.startsWith("/api/skills/")) {
    const skillId = decodeURIComponent(requestUrl.pathname.slice("/api/skills/".length));
    const skill = context.runtimeState.scan.skills.find((item) => item.id === skillId);
    if (!skill) {
      writeJson(response, 404, { error: "skill-not-found" });
      return;
    }
    writeJson(response, 200, skill satisfies Skill);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    writeJson(response, 200, context.runtimeState.scan.healthFindings satisfies HealthFinding[]);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/manifest") {
    writeJson(response, 200, context.runtimeState.manifest satisfies Manifest);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/profiles") {
    writeJson(response, 200, Object.values(context.runtimeState.manifest.profiles) satisfies Profile[]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/profiles") {
    const body = await readJsonBody(request);
    const profile = createProfile({
      name: readRequiredString(body, "name"),
      description: readOptionalString(body, "description"),
      skillIds: readOptionalStringArray(body, "skillIds")
    });
    context.runtimeState.manifest = upsertProfile(context.runtimeState.manifest, profile);
    await context.runtimeState.manifestStore.write(context.runtimeState.manifest);
    broadcast(context.eventClients, "manifest.changed", context.runtimeState.manifest);
    writeJson(response, 201, profile);
    return;
  }

  if (request.method === "PATCH" && requestUrl.pathname.startsWith("/api/profiles/")) {
    const profileId = decodeURIComponent(requestUrl.pathname.slice("/api/profiles/".length));
    const body = await readJsonBody(request);
    context.runtimeState.manifest = patchProfile(context.runtimeState.manifest, profileId, {
      name: readOptionalString(body, "name"),
      description: readOptionalString(body, "description"),
      skillIds: readOptionalStringArray(body, "skillIds")
    });
    await context.runtimeState.manifestStore.write(context.runtimeState.manifest);
    context.runtimeState.scan = mergeManifestIntoScan(context.runtimeState.manifest, context.runtimeState.scan);
    broadcast(context.eventClients, "manifest.changed", context.runtimeState.manifest);
    writeJson(response, 200, context.runtimeState.manifest.profiles[profileId]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname.endsWith("/plan") && requestUrl.pathname.startsWith("/api/profiles/")) {
    const profileId = decodeURIComponent(requestUrl.pathname.slice("/api/profiles/".length, -"/plan".length));
    const plan = await planProfile(
      context.runtimeState.manifest,
      profileId,
      context.runtimeState.scan.skills,
      context.runtimeState.manifestStore.status.activeDir
    );
    writeJson(response, 200, plan);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname.endsWith("/apply") && requestUrl.pathname.startsWith("/api/profiles/")) {
    const profileId = decodeURIComponent(requestUrl.pathname.slice("/api/profiles/".length, -"/apply".length));
    const result = await applyProfile(context.runtimeState.manifestStore, profileId, context.runtimeState.scan.skills);
    context.runtimeState.manifest = result.manifest;
    context.runtimeState.scan = mergeManifestIntoScan(context.runtimeState.manifest, context.runtimeState.scan);
    broadcast(context.eventClients, "apply.completed", result.plan);
    broadcast(context.eventClients, "manifest.changed", context.runtimeState.manifest);
    broadcast(context.eventClients, "skills.changed", context.runtimeState.scan.skills);
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/undo") {
    context.runtimeState.manifest = await undoLastApply(context.runtimeState.manifestStore, context.runtimeState.scan.skills);
    context.runtimeState.scan = mergeManifestIntoScan(context.runtimeState.manifest, context.runtimeState.scan);
    broadcast(context.eventClients, "manifest.changed", context.runtimeState.manifest);
    broadcast(context.eventClients, "skills.changed", context.runtimeState.scan.skills);
    writeJson(response, 200, context.runtimeState.manifest);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname.startsWith("/api/skills/") && requestUrl.pathname.endsWith("/visibility")) {
    const skillId = decodeURIComponent(
      requestUrl.pathname.slice("/api/skills/".length, -"/visibility".length)
    );
    const body = await readJsonBody(request);
    const visibility = readRequiredString(body, "visibility");
    if (visibility !== "visible" && visibility !== "quiet") {
      writeJson(response, 400, { error: "invalid-visibility" });
      return;
    }
    const record = context.runtimeState.manifest.skills[skillId];
    if (!record) {
      writeJson(response, 404, { error: "skill-not-found" });
      return;
    }
    context.runtimeState.manifest = {
      ...context.runtimeState.manifest,
      skills: {
        ...context.runtimeState.manifest.skills,
        [skillId]: {
          ...record,
          visibility
        }
      }
    };
    await context.runtimeState.manifestStore.write(context.runtimeState.manifest);
    context.runtimeState.scan = mergeManifestIntoScan(context.runtimeState.manifest, context.runtimeState.scan);
    broadcast(context.eventClients, "manifest.changed", context.runtimeState.manifest);
    broadcast(context.eventClients, "skills.changed", context.runtimeState.scan.skills);
    writeJson(response, 200, context.runtimeState.manifest.skills[skillId]);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/events") {
    handleEvents(response, context.eventClients);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    writeJson(response, 405, { error: "method-not-allowed" });
    return;
  }

  await serveFrontend(requestUrl.pathname, response);
}

function createSkillWatcher(runtimeState: RuntimeState, eventClients: Map<number, EventClient>): FSWatcher {
  const watcher = chokidar.watch(runtimeState.roots.map((root) => root.path), {
    ignoreInitial: true,
    persistent: true,
    depth: 4
  });
  let debounceTimer: NodeJS.Timeout | null = null;

  const scheduleScan = (eventName: string, changedPath: string) => {
    broadcast(eventClients, "scan.started", { eventName, path: changedPath });
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      void refreshScan(runtimeState, eventClients, eventName, changedPath);
    }, 150);
  };

  watcher
    .on("add", (path) => scheduleScan("add", path))
    .on("change", (path) => scheduleScan("change", path))
    .on("unlink", (path) => scheduleScan("unlink", path))
    .on("addDir", (path) => scheduleScan("addDir", path))
    .on("unlinkDir", (path) => scheduleScan("unlinkDir", path))
    .on("error", (error) => {
      const message = error instanceof Error ? error.message : "Unknown watcher error";
      runtimeState.watcherErrors.push(message);
      broadcast(eventClients, "error", { message });
    });

  return watcher;
}

async function refreshScan(
  runtimeState: RuntimeState,
  eventClients: Map<number, EventClient>,
  eventName: string,
  changedPath: string
) {
  runtimeState.roots = await detectSkillRoots(runtimeState.cwd);
  const rawScan = await scanSkillRoots(runtimeState.roots);
  runtimeState.manifest = await runtimeState.manifestStore.syncSkills(runtimeState.roots, rawScan.skills);
  runtimeState.scan = mergeManifestIntoScan(runtimeState.manifest, rawScan);
  broadcast(eventClients, "scan.completed", {
    eventName,
    path: changedPath,
    skillCount: runtimeState.scan.skills.length,
    healthFindingCount: runtimeState.scan.healthFindings.length
  });
  broadcast(eventClients, "skills.changed", runtimeState.scan.skills);
  broadcast(eventClients, "health.changed", runtimeState.scan.healthFindings);
  broadcast(eventClients, "manifest.changed", runtimeState.manifest);
}

function mergeManifestIntoScan(manifest: Manifest, scan: ScanResult): ScanResult {
  const skills = mergeManifestIntoSkills(manifest, scan.skills);
  const manifestFindings = buildManifestHealthFindings(manifest, skills);
  return {
    skills,
    healthFindings: mergeHealthFindings(scan.healthFindings, manifestFindings)
  };
}

function mergeHealthFindings(first: HealthFinding[], second: HealthFinding[]): HealthFinding[] {
  const findingsById = new Map<string, HealthFinding>();
  for (const finding of [...first, ...second]) {
    findingsById.set(finding.id, finding);
  }
  return [...findingsById.values()];
}

async function detectSkillRoots(cwd: string): Promise<SkillRoot[]> {
  const roots: Array<Omit<SkillRoot, "exists" | "writable">> = [
    {
      id: "global",
      label: "Personal skills",
      source: "global",
      path: join(homedir(), ".claude", "skills")
    },
    {
      id: "project",
      label: "This project",
      source: "project",
      path: join(cwd, ".claude", "skills")
    }
  ];

  return Promise.all(
    roots.map(async (root) => ({
      ...root,
      exists: await pathExists(root.path),
      writable: await pathWritable(root.path)
    }))
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function pathWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function handleEvents(response: ServerResponse, eventClients: Map<number, EventClient>) {
  const clientId = nextEventClientId++;
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": `http://${HOST}`
  });
  response.write(": connected\n\n");
  response.write(`event: connection.open\n`);
  response.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  eventClients.set(clientId, { id: clientId, response });
  response.on("close", () => {
    eventClients.delete(clientId);
  });
}

function broadcast(eventClients: Map<number, EventClient>, event: string, data: unknown) {
  for (const client of eventClients.values()) {
    client.response.write(`event: ${event}\n`);
    client.response.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

async function serveFrontend(pathname: string, response: ServerResponse) {
  const webDist = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = resolve(webDist, `.${normalizedPath}`);

  if (candidate.startsWith(webDist)) {
    try {
      const fileStat = await stat(candidate);
      if (fileStat.isFile()) {
        const body = await readFile(candidate);
        response.writeHead(200, { "Content-Type": contentTypeFor(candidate) });
        response.end(body);
        return;
      }
    } catch {
      // Fall through to index fallback.
    }
  }

  try {
    const index = await readFile(join(webDist, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(index);
  } catch {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(placeholderHtml());
  }
}

function placeholderHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SkillSet</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f5f2; color: #20201d; }
      main { max-width: 760px; margin: 12vh auto; padding: 0 24px; }
      .status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid #c9d8ca; border-radius: 999px; background: #edf6ef; color: #276238; font-size: 14px; }
      h1 { margin: 18px 0 10px; font-size: 42px; letter-spacing: 0; }
      p { font-size: 17px; line-height: 1.55; color: #5c5b55; }
      code { background: #e8e4da; padding: 2px 5px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <div class="status">Live · Local server running</div>
      <h1>SkillSet</h1>
      <p>The local server is running. Build the React app with <code>npm run build -w @skillset/web</code> to replace this placeholder.</p>
    </main>
  </body>
</html>`;
}

function contentTypeFor(path: string) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function writeJson(response: ServerResponse, statusCode: number, data: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data, null, 2));
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      if (!raw.trim()) {
        resolveBody({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          resolveBody(parsed as Record<string, unknown>);
          return;
        }
        rejectBody(new Error("JSON body must be an object."));
      } catch (error) {
        rejectBody(error);
      }
    });
    request.on("error", rejectBody);
  });
}

function readRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function readOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function readOptionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function addressPort(server: Server): number {
  const address = server.address();
  if (typeof address === "object" && address) {
    return address.port;
  }
  throw new Error("Server is not listening on a TCP port.");
}

function listenWithFallback(server: Server, requestedPort: number): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    let port = requestedPort;

    const tryListen = () => {
      server.once("error", onError);
      server.listen(port, HOST, () => {
        server.off("error", onError);
        resolveListen(port);
      });
    };

    const onError = (error: NodeJS.ErrnoException) => {
      server.off("error", onError);
      if (error.code === "EADDRINUSE") {
        port += 1;
        tryListen();
        return;
      }
      rejectListen(error);
    };

    tryListen();
  });
}
