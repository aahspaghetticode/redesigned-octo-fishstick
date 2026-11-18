import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const CACHE_DIR =
  process.env.CACHE_DIR || fileURLToPath(new URL("../data/cache", import.meta.url));

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

/** Fetch the first URL in `urls` that answers 200, with a timeout. */
export async function fetchFirst(urls, timeoutMs = 15000) {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.ok) return res;
      lastErr = new Error(`${url} -> HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no urls");
}

/**
 * Disk-backed cache. Returns {body: Buffer, type: string}.
 * Fresh entries (younger than ttlMs) are served from disk; stale ones are
 * refetched, and served stale if the refetch fails.
 */
export async function cached(key, ttlMs, loader) {
  const hash = crypto.createHash("sha1").update(key).digest("hex");
  const file = path.join(CACHE_DIR, hash);
  const meta = file + ".json";
  let stat = null;
  try {
    stat = await fs.stat(file);
  } catch {}
  if (stat && Date.now() - stat.mtimeMs < ttlMs) {
    return { body: await fs.readFile(file), type: JSON.parse(await fs.readFile(meta, "utf8")).type };
  }
  try {
    const { body, type } = await loader();
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, body);
    await fs.writeFile(meta, JSON.stringify({ key, type }));
    return { body, type };
  } catch (e) {
    if (stat) {
      return { body: await fs.readFile(file), type: JSON.parse(await fs.readFile(meta, "utf8")).type };
    }
    throw e;
  }
}
