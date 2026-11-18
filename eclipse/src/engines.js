// Server-side proxy engines and the engine status endpoint.
//
//  Scramjet, Ultraviolet  - run in the browser's service worker; the server
//                           only serves their files and the Wisp socket.
//  Corrosion              - runs in this process under /svc/c/.
import { isBlockedUrl } from "./netguard.js";

const flag = (name, def = true) => !/^(0|false|no|off)$/i.test(process.env[name] ?? String(def));

const state = {
  corrosion: { ok: false, reason: "disabled" },
};

let corrosion = null;

const forwardedProto = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();

export async function initEngines() {
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
}

export function engineStatus() {
  // Client-facing ids are opaque codes so engine names never appear in the
  // /api/cfg response or the always-loaded client code.
  return {
    e1: { ok: true },
    e2: { ok: true },
    e4: state.corrosion,
  };
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
  if (corrosion && req.url.startsWith("/svc/c/")) {
    const target = corrosionTarget(req.url);
    (target ? isBlockedUrl(target.replace(/^ws/, "http")) : Promise.resolve(false)).then((blocked) =>
      blocked ? socket.destroy() : corrosion.upgrade(req, socket, head)
    );
    return true;
  }
  return false;
}
