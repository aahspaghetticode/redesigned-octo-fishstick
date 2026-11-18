// Stops the server-side proxy engines (Rammerhead, Corrosion) from being
// pointed at the VPS itself or its private network (SSRF). Scramjet and
// Ultraviolet go through Wisp, which has the same protection built in.
import dns from "node:dns/promises";
import net from "node:net";

const cache = new Map(); // hostname -> { blocked, at }
const TTL = 60_000;

function v4ToInt(ip) {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKS = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
].map(([base, bits]) => [v4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, mask]) => (n & mask) === (base & mask));
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateIp(mapped[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

/** True if the hostname is, or resolves to, a loopback/private/link-local address. */
export async function isBlockedHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.blocked;
  let blocked;
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    blocked = addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address));
  } catch {
    blocked = false; // unresolvable: let the engine report the DNS error itself
  }
  cache.set(host, { blocked, at: Date.now() });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return blocked;
}

/** True if the URL string targets a blocked host. Unparseable URLs are allowed through. */
export async function isBlockedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^(https?|wss?):$/.test(u.protocol)) return false;
  return isBlockedHost(u.hostname);
}
