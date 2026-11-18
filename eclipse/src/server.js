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
import { sendObf } from "./obf.js";

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

app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Frame-Options", "SAMEORIGIN");
  next();
});

const staticOpts = { maxAge: "1h" };
const vendor = (p) => path.join(root, "node_modules", p);
const file = (abs) => (_q, r) => r.sendFile(abs);
app.get("/assets/rt.js", file(path.join(scramjetPath, "scramjet.all.js")));
app.get("/assets/rs.js", file(path.join(scramjetPath, "scramjet.sync.js")));
app.get("/assets/rt.wasm", file(path.join(scramjetPath, "scramjet.wasm.wasm")));
app.get("/assets/vb.js", file(path.join(uvPath, "uv.bundle.js")));
app.get("/assets/vs.js", file(path.join(uvPath, "uv.sw.js")));
app.get("/assets/vh.js", file(path.join(uvPath, "uv.handler.js")));
app.get("/assets/vk.js", file(path.join(uvPath, "uv.client.js")));
app.get("/assets/vc.js", file(path.join(root, "public/uv/uv.config.js")));
app.get("/assets/mx.js", file(path.join(baremuxPath, "index.js")));
app.get("/assets/mw.js", file(path.join(baremuxPath, "worker.js")));
app.get("/assets/tp.mjs", file(path.join(epoxyPath, "index.mjs")));
app.use("/assets/s/", express.static(scramjetPath, staticOpts));
app.use("/assets/v/", express.static(path.join(root, "public/uv"), { maxAge: "10m" }));
app.use("/assets/v/", express.static(uvPath, staticOpts));
app.use("/assets/m/", express.static(baremuxPath, staticOpts));
app.use("/assets/t/", express.static(epoxyPath, staticOpts));
app.use("/assets/h/", express.static(vendor("hls.js/dist"), staticOpts));
app.use("/assets/x/", express.static(vendor("@xterm/xterm"), staticOpts));
app.use("/assets/xf/", express.static(vendor("@xterm/addon-fit/lib"), staticOpts));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/cfg", (_req, res) => sendObf(res, engineStatus(), 0));
app.get("/api/x/status", (_req, res) => sendObf(res, shellStatus(), 0));
app.use("/api/lib/a", gnRouter);
app.use("/api/lib/b", c6xRouter);
app.use("/svc/m", jellyfinRouter);

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
  if (req.url.endsWith("/svc/w/")) return wisp.routeRequest(req, socket, head);
  if (req.url.startsWith("/x/ws")) return handleShellUpgrade(req, socket, head);
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
