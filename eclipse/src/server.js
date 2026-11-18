import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { gnRouter } from "./games-gn.js";
import { c6xRouter } from "./games-c6x.js";
import { jellyfinRouter } from "./jellyfin.js";
import { initEngines, engineStatus, handleEngineRequest, handleEngineUpgrade } from "./engines.js";
import { handleShellUpgrade, shellStatus } from "./shell.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "127.0.0.1";

// Wisp: the TCP-over-WebSocket backend Scramjet and Ultraviolet talk to.
logging.set_level(logging.WARN);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_private_ips: false,
  allow_loopback_ips: false,
  dns_servers: (process.env.WISP_DNS || "1.1.1.1,1.0.0.1").split(","),
});

await initEngines();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");

const staticOpts = { maxAge: "1h" };
const vendor = (p) => path.join(root, "node_modules", p);
app.use("/scram/", express.static(scramjetPath, staticOpts));
app.use("/epoxy/", express.static(epoxyPath, staticOpts));
app.use("/baremux/", express.static(baremuxPath, staticOpts));
// Our uv.config.js (in public/uv/) must win over the package's default one.
app.use("/uv/", express.static(path.join(root, "public/uv"), { maxAge: "10m" }));
app.use("/uv/", express.static(uvPath, staticOpts));
app.use("/vendor/hls/", express.static(vendor("hls.js/dist"), staticOpts));
app.use("/vendor/xterm/", express.static(vendor("@xterm/xterm"), staticOpts));
app.use("/vendor/xterm-fit/", express.static(vendor("@xterm/addon-fit/lib"), staticOpts));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/engines", (_req, res) => res.set("Cache-Control", "no-cache").json(engineStatus()));
app.get("/api/shell/status", (_req, res) => res.set("Cache-Control", "no-cache").json(shellStatus()));
app.use("/api/games/gn", gnRouter);
app.use("/api/games/c6x", c6xRouter);
app.use("/jf", jellyfinRouter);

// The service worker must be served from the root scope and never cached long.
app.get("/sw.js", (_req, res) => {
  res.set({ "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" });
  res.sendFile(path.join(root, "public/sw.js"));
});
app.use(express.static(path.join(root, "public"), { maxAge: "10m" }));
app.use((_req, res) => res.status(404).sendFile(path.join(root, "public/index.html")));

const server = createServer((req, res) => {
  if (handleEngineRequest(req, res)) return;
  app(req, res);
});

server.on("upgrade", (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  if (req.url.endsWith("/wisp/")) return wisp.routeRequest(req, socket, head);
  if (req.url.startsWith("/shell/ws")) return handleShellUpgrade(req, socket, head);
  if (handleEngineUpgrade(req, socket, head)) return;
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  const engines = Object.entries(engineStatus())
    .map(([k, v]) => `${k}:${v.ok ? "on" : "off"}`)
    .join(" ");
  console.log(`Eclipse listening on http://${HOST}:${PORT}  [${engines}]  shell:${shellStatus().enabled ? "on" : "off"}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
