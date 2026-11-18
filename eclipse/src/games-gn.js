// gn-math catalog adapter. Mirrors the catalog, covers and game HTML through
// this server (with a disk cache) so games load same-origin and keep working
// when the upstream CDN is filtered on the client's network.
import express from "express";
import { cached, fetchFirst } from "./cache.js";

const DAY = 24 * 3600 * 1000;
const SOURCES = {
  zones: [
    "https://cdn.jsdelivr.net/gh/gn-math/assets@main/zones.json",
    "https://raw.githubusercontent.com/gn-math/assets/main/zones.json",
  ],
  html: (f) => [
    `https://cdn.jsdelivr.net/gh/gn-math/html@main/${f}`,
    `https://raw.githubusercontent.com/gn-math/html/main/${f}`,
  ],
  cover: (f) => [
    `https://cdn.jsdelivr.net/gh/gn-math/covers@main/${f}`,
    `https://raw.githubusercontent.com/gn-math/covers/main/${f}`,
  ],
};
const SAFE_FILE = /^[\w.\-]+$/;
const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

export const gnRouter = express.Router();

gnRouter.get("/", async (_req, res) => {
  try {
    const { body } = await cached("gn:zones", DAY / 4, async () => {
      const r = await fetchFirst(SOURCES.zones);
      return { body: Buffer.from(await r.text()), type: "application/json" };
    });
    const zones = JSON.parse(body.toString("utf8"));
    const games = [];
    for (const z of zones) {
      const html = /^\{HTML_URL\}\/(.+)$/.exec(z.url)?.[1];
      const cover = /^\{COVER_URL\}\/(.+)$/.exec(z.cover)?.[1];
      if (!html || !SAFE_FILE.test(html)) continue; // skips the Discord promo entry
      if (/^\[!\]/.test(z.name)) continue; // site meta pages (comments, suggestions)
      games.push({
        id: `gn-${z.id}`,
        name: z.name,
        source: "gn-math",
        author: z.author || null,
        authorLink: z.authorLink || null,
        tags: z.special || [],
        featured: !!z.featured,
        cover: cover && SAFE_FILE.test(cover) ? `/api/games/gn/cover/${cover}` : null,
        play: { type: "html", url: `/api/games/gn/html/${html}` },
      });
    }
    res.set("Cache-Control", "public, max-age=600").json({ source: "gn-math", count: games.length, games });
  } catch (e) {
    res.status(502).json({ error: `gn-math catalog unavailable: ${e.message}` });
  }
});

gnRouter.get("/html/:file", async (req, res) => {
  const f = req.params.file;
  if (!SAFE_FILE.test(f)) return res.sendStatus(400);
  try {
    const { body } = await cached(`gn:html:${f}`, 7 * DAY, async () => {
      const r = await fetchFirst(SOURCES.html(f));
      return { body: Buffer.from(await r.arrayBuffer()), type: "text/html" };
    });
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" }).send(body);
  } catch (e) {
    res.status(502).type("text/plain").send(`Could not load game: ${e.message}`);
  }
});

gnRouter.get("/cover/:file", async (req, res) => {
  const f = req.params.file;
  if (!SAFE_FILE.test(f)) return res.sendStatus(400);
  const ext = f.split(".").pop().toLowerCase();
  try {
    const { body } = await cached(`gn:cover:${f}`, 30 * DAY, async () => {
      const r = await fetchFirst(SOURCES.cover(f));
      return { body: Buffer.from(await r.arrayBuffer()), type: IMG_TYPES[ext] || "application/octet-stream" };
    });
    res.set({ "Content-Type": IMG_TYPES[ext] || "application/octet-stream", "Cache-Control": "public, max-age=604800" }).send(body);
  } catch {
    res.sendStatus(404);
  }
});
