// Classroom 6x catalog adapter. Classroom 6x publishes no machine-readable
// catalog, so the list is built from the site's sitemap(s) and refreshed
// every few hours. Covers and the embedded game URL are read lazily from each
// game page (og:image / first game iframe). Games are played through Scramjet.
//
// Extra or corrected entries can be added in data/c6x-extra.json:
//   [{ "name": "...", "url": "https://...", "cover": "https://..." }]
import express from "express";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cached, fetchFirst } from "./cache.js";

const HOUR = 3600 * 1000;
const BASE = new URL(process.env.CLASSROOM6X_URL || "https://classroom6x.com/");
const EXTRA_FILE = fileURLToPath(new URL("../data/c6x-extra.json", import.meta.url));

// Paths on the site that are not games.
const NON_GAME =
  /^\/(?:$|category|categories|tag|tags|page|pages|author|search|about|contact|privacy|terms|dmca|cookie|blog|news|sitemap|feed|wp-|login|register|new|popular|hot|top|all|faq)(?:[\/.?-]|$)/i;

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const sameSite = (u) => {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return h === BASE.hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
};

const titleFromSlug = (p) =>
  decodeURIComponent(p.replace(/\/+$/, "").split("/").pop() || "")
    .replace(/\.(html?|php)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(unblocked|classroom ?6x)\b/gi, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

async function readSitemap(url, depth = 0, seen = new Set()) {
  if (depth > 2 || seen.has(url) || seen.size > 25) return [];
  seen.add(url);
  const xml = await (await fetchFirst([url])).text();
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  if (/<sitemapindex/i.test(xml)) {
    const out = [];
    for (const child of locs) {
      try {
        out.push(...(await readSitemap(child, depth + 1, seen)));
      } catch {}
    }
    return out;
  }
  return locs;
}

async function buildCatalog() {
  let urls = [];
  for (const sm of ["sitemap.xml", "sitemap_index.xml", "sitemap-games.xml"]) {
    try {
      urls = await readSitemap(new URL(sm, BASE).href);
      if (urls.length) break;
    } catch {}
  }
  const games = new Map();
  for (const u of urls) {
    if (!sameSite(u)) continue;
    const p = new URL(u).pathname;
    if (NON_GAME.test(p) || /\.(xml|jpe?g|png|webp|gif|css|js)$/i.test(p)) continue;
    const name = titleFromSlug(p);
    if (!name || games.has(u)) continue;
    games.set(u, { name, url: u, cover: null });
  }
  try {
    for (const g of JSON.parse(await fs.readFile(EXTRA_FILE, "utf8"))) {
      if (g?.name && g?.url) games.set(g.url, { name: g.name, url: g.url, cover: g.cover || null });
    }
  } catch {}
  return [...games.values()];
}

export const c6xRouter = express.Router();

c6xRouter.get("/", async (_req, res) => {
  try {
    const { body } = await cached(`c6x:catalog:${BASE.href}`, 6 * HOUR, async () => {
      const list = await buildCatalog();
      if (!list.length) throw new Error("no games found in sitemap");
      return { body: Buffer.from(JSON.stringify(list)), type: "application/json" };
    });
    const games = JSON.parse(body.toString("utf8")).map((g, i) => ({
      id: `c6x-${i}`,
      name: g.name,
      source: "classroom-6x",
      tags: [],
      cover: g.cover || `/api/games/c6x/cover?u=${encodeURIComponent(g.url)}`,
      play: { type: "proxy", url: g.url, resolve: `/api/games/c6x/resolve?u=${encodeURIComponent(g.url)}` },
    }));
    res.set("Cache-Control", "public, max-age=600").json({ source: "classroom-6x", count: games.length, games });
  } catch (e) {
    res.status(502).json({ error: `Classroom 6x catalog unavailable: ${e.message}`, games: [] });
  }
});

async function pageInfo(u) {
  const { body } = await cached(`c6x:page:${u}`, 24 * HOUR, async () => {
    const html = await (await fetchFirst([u])).text();
    const meta = (prop) =>
      new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, "i").exec(html)?.[1] ||
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i").exec(html)?.[1];
    const iframes = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)]
      .map((m) => decode(m[1]))
      .filter((s) => !/googlesyndication|doubleclick|googletagmanager|facebook|disqus|youtube\.com\/embed/i.test(s));
    const abs = (s) => (s ? new URL(decode(s), u).href : null);
    return {
      body: Buffer.from(
        JSON.stringify({ image: abs(meta("og:image") || meta("twitter:image")), game: abs(iframes[0]), title: meta("og:title") || null })
      ),
      type: "application/json",
    };
  });
  return JSON.parse(body.toString("utf8"));
}

c6xRouter.get("/resolve", async (req, res) => {
  const u = String(req.query.u || "");
  if (!sameSite(u)) return res.status(400).json({ error: "not a Classroom 6x URL" });
  try {
    const info = await pageInfo(u);
    res.json({ url: info.game || u, page: u, title: info.title });
  } catch {
    res.json({ url: u, page: u });
  }
});

c6xRouter.get("/cover", async (req, res) => {
  const u = String(req.query.u || "");
  if (!sameSite(u)) return res.sendStatus(400);
  try {
    const info = await pageInfo(u);
    if (!info.image) return res.sendStatus(404);
    const img = await cached(`c6x:img:${info.image}`, 30 * 24 * HOUR, async () => {
      const r = await fetchFirst([info.image]);
      const type = r.headers.get("content-type") || "";
      if (!type.startsWith("image/")) throw new Error("not an image");
      return { body: Buffer.from(await r.arrayBuffer()), type };
    });
    res.set({ "Content-Type": img.type, "Cache-Control": "public, max-age=604800" }).send(img.body);
  } catch {
    res.sendStatus(404);
  }
});
