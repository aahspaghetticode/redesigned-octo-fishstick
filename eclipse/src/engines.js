// Server-side proxy engines and the engine status endpoint.
//
//  Scramjet, Ultraviolet  - run in the browser's service worker; the server
//                           only serves their files and the Wisp socket.
//  Rammerhead             - runs in this process (sessions in data/).
//  Corrosion              - runs in this process under /svc/c/.
//  Womginx                - a separate nginx instance on its own subdomain
//                           (see deploy/womginx). WOMGINX_URL points at it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBlockedUrl } from "./netguard.js";

const DATA = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const flag = (name, def = true) => !/^(0|false|no|off)$/i.test(process.env[name] ?? String(def));

const state = {
  rammerhead: { ok: false, reason: "disabled" },
  corrosion: { ok: false, reason: "disabled" },
  womginx: { ok: false, reason: "WOMGINX_URL is not set" },
};

let rh = null;
let rhApi = null;
let corrosion = null;

const forwardedProto = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();

export async function initEngines() {
  if (flag("ENGINE_RAMMERHEAD")) {
    try {
      const { default: rhConfig } = await import("@rubynetwork/rh/src/config.js");
      const { default: RammerheadJSMemCache } = await import("@rubynetwork/rh/src/classes/RammerheadJSMemCache.js");
      // Work out the public origin from the reverse proxy headers instead of
      // the upstream default (which logs every socket and needs a cookie).
      rhConfig.getServerInfo = (req) => {
        const proto = forwardedProto(req) || "http";
        const u = new URL(`${proto}://${req.headers.host || "localhost"}`);
        const port = Number(u.port || (proto === "https" ? 443 : 80));
        return { hostname: u.hostname, port, crossDomainPort: port, protocol: proto + ":" };
      };
      rhConfig.jsCache = new RammerheadJSMemCache(64 * 1024 * 1024);
      const sessions = path.join(DATA, "rammerhead-sessions");
      fs.mkdirSync(sessions, { recursive: true });
      rhConfig.fileCacheSessionConfig.saveDirectory = sessions;
      rhApi = await import("@rubynetwork/rammerhead");
      rh = rhApi.createRammerhead({ logLevel: process.env.RAMMERHEAD_LOG || "error", reverseProxy: true });
      state.rammerhead = { ok: true };
    } catch (e) {
      state.rammerhead = { ok: false, reason: `failed to start: ${e.message}` };
      console.error("[engines] rammerhead:", e);
    }
  }

  if (flag("ENGINE_CORROSION")) {
    try {
      const { default: Corrosion } = await import("corrosion");
      corrosion = new Corrosion({ prefix: "/svc/c/", codec: "xor", title: false, ws: true, cookie: true });
      state.corrosion = { ok: true };
    } catch (e) {
      state.corrosion = { ok: false, reason: `failed to start: ${e.message}` };
      console.error("[engines] corrosion:", e);
    }
  }

  const wg = (process.env.WOMGINX_URL || "").trim().replace(/\/+$/, "");
  if (wg) state.womginx = { ok: true, url: wg };
}

export function engineStatus() {
  // Client-facing ids are opaque codes (e1..e5) so engine names never appear
  // in the /api/cfg response or the always-loaded client code.
  return {
    e1: { ok: true },
    e2: { ok: true },
    e3: state.rammerhead,
    e4: state.corrosion,
    e5: state.womginx,
  };
}

// Pull the destination URL out of a Rammerhead path: /<32-char id>[flags]/<url>
function rammerheadTarget(url) {
  const m = /^\/[a-z0-9]{32}[^/]*\/(.+)$/.exec(url);
  return m ? m[1] : null;
}

function corrosionTarget(url) {
  try {
    return corrosion.url.unwrap(url, { flags: true, leftovers: true }).value;
  } catch {
    return null;
  }
}

function deny(res) {
  res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
  res.end("Eclipse: that address points at a private network and can't be opened.");
}

/** Returns true if the request was handled by a server-side engine. */
export function handleEngineRequest(req, res) {
  if (rh && rhApi.shouldRouteRh(req)) {
    const { pathname, searchParams } = new URL(req.url, "http://x");
    if (pathname === "/editsession") {
      // Only allow turning URL shuffling off. Dropping httpProxy stops a session
      // from being chained through an internal host.
      req.url = `/editsession?id=${encodeURIComponent(searchParams.get("id") || "")}&enableShuffling=0`;
      rhApi.routeRhRequest(rh, req, res);
      return true;
    }
    const target = rammerheadTarget(req.url);
    // Eclipse turns shuffling off for its sessions; shuffled URLs can't be
    // checked against the private-network guard, so they're refused.
    if (target && target.startsWith("_rhs")) {
      deny(res);
      return true;
    }
    (target ? isBlockedUrl(target) : Promise.resolve(false)).then((blocked) =>
      blocked ? deny(res) : rhApi.routeRhRequest(rh, req, res)
    );
    return true;
  }
  if (corrosion && req.url.startsWith("/svc/c/")) {
    // Corrosion builds absolute URLs from socket.encrypted; behind Caddy the
    // socket is plain HTTP, so mark it as TLS when the edge says so.
    if (forwardedProto(req) === "https") req.socket.encrypted = true;
    const target = corrosionTarget(req.url);
    (target ? isBlockedUrl(target) : Promise.resolve(false)).then((blocked) =>
      blocked ? deny(res) : corrosion.request(req, res)
    );
    return true;
  }
  return false;
}

/** Returns true if the upgrade was handled by a server-side engine. */
export function handleEngineUpgrade(req, socket, head) {
  if (rh && rhApi.shouldRouteRh(req)) {
    const target = rammerheadTarget(req.url);
    if (target && target.startsWith("_rhs")) {
      socket.destroy();
      return true;
    }
    (target ? isBlockedUrl(target.replace(/^ws/, "http")) : Promise.resolve(false)).then((blocked) =>
      blocked ? socket.destroy() : rhApi.routeRhUpgrade(rh, req, socket, head)
    );
    return true;
  }
  if (corrosion && req.url.startsWith("/svc/c/")) {
    const target = corrosionTarget(req.url);
    (target ? isBlockedUrl(target.replace(/^ws/, "http")) : Promise.resolve(false)).then((blocked) =>
      blocked ? socket.destroy() : corrosion.upgrade(req, socket, head)
    );
    return true;
  }
  return false;
}
