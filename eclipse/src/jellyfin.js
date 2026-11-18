// Same-origin reverse proxy to a Jellyfin server, so the browser client has
// no CORS issues and the Jellyfin host never has to be reachable from the
// viewer's network. The target is fixed server-side (JELLYFIN_URL) so this
// can't be abused as an open proxy.
//
// JELLYFIN_URL unset (or "stub") = stub mode: the client shows a
// "not configured" screen. Set it in /etc/henws-hub.env, e.g.
//   JELLYFIN_URL=http://192.168.1.20:8096
import express from "express";
import { Readable } from "node:stream";

const RAW = (process.env.JELLYFIN_URL || "stub").trim();
const STUB = !RAW || RAW === "stub";
const TARGET = STUB ? null : RAW.replace(/\/+$/, "");

const PASS_REQ = ["accept", "content-type", "range", "authorization", "x-emby-authorization", "x-emby-token", "x-mediabrowser-token", "if-none-match", "if-modified-since"];
const PASS_RES = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"];

export const jellyfinRouter = express.Router();

jellyfinRouter.get("/__config", (_req, res) => {
  res.json({ configured: !STUB, server: STUB ? "stub (set JELLYFIN_URL)" : new URL(TARGET).host });
});

jellyfinRouter.use(express.raw({ type: () => true, limit: "2mb" }), async (req, res) => {
  if (STUB) {
    return res.status(503).json({ error: "Jellyfin is not configured on this server (JELLYFIN_URL is a stub)." });
  }
  const headers = {};
  for (const h of PASS_REQ) if (req.headers[h]) headers[h] = req.headers[h];
  headers["accept-encoding"] = "identity"; // keep content-length/range valid when piping
  const hasBody = !["GET", "HEAD"].includes(req.method) && req.body?.length;
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  try {
    const upstream = await fetch(TARGET + req.url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: ac.signal,
    });
    res.status(upstream.status);
    for (const h of PASS_RES) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body || req.method === "HEAD") return res.end();
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: `Jellyfin unreachable: ${e.message}` });
    else res.destroy();
  }
});
