import { $, html, raw, esc, store, toast, letterTile, requestFullscreen, icon, dec } from "./util.js";
import { createProxiedFrame } from "./proxy.js";

const PAGE = 120;
let catalog = null; // { games: [], errors: [] }
let loading = null;

export function loadCatalog() {
  if (catalog) return Promise.resolve(catalog);
  if (loading) return loading;
  loading = (async () => {
    const sources = [
      [dec("aB5jP0kNGzA="), "/api/games/gn"],
      [dec("aB5jP0kNGzM="), "/api/games/c6x"],
    ];
    const results = await Promise.all(
      sources.map(async ([label, url]) => {
        try {
          const r = await fetch(url);
          const txt = await r.text();
          if (!r.ok) {
            let m;
            try { m = JSON.parse(txt).error; } catch {}
            throw new Error(m || `HTTP ${r.status}`);
          }
          return { games: JSON.parse(dec(txt)).games || [] };
        } catch (e) {
          return { games: [], error: `${label}: ${e.message}` };
        }
      })
    );
    catalog = {
      games: results.flatMap((r) => r.games).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
      errors: results.filter((r) => r.error).map((r) => r.error),
    };
    catalog.byId = new Map(catalog.games.map((g) => [g.id, g]));
    loading = null;
    return catalog;
  })();
  return loading;
}

const favs = () => new Set(store.get("favs", []));
const recents = () => store.get("recent", []);

function pushRecent(id) {
  store.set("recent", [id, ...recents().filter((x) => x !== id)].slice(0, 24));
}

export function gameCard(g) {
  const meta = g.source === dec("XB87IEscUw==") ? (g.author ? `${dec("XB87IEscUw==")} · ${g.author}` : dec("XB87IEscUw==")) : dec("eB13PlkaVB57bRwQ");
  return html`<button class="card" data-game="${g.id}" title="${g.name}">
    <div class="thumb">
      ${letterTile(g.name)}
      ${g.cover ? html`<img loading="lazy" decoding="async" alt="" src="${g.cover}" onerror="this.remove()" />` : ""}
    </div>
    <span class="name">${g.name}</span>
    <span class="meta">${meta}</span>
  </button>`;
}

export function bindCardClicks(root) {
  root.addEventListener("click", (e) => {
    const id = e.target.closest("[data-game]")?.dataset.game;
    if (id) playGame(id);
  });
}

const TAG_LABELS = { flash: "Flash", emulator: "Emulator", port: "Ports", fnf: "FNF", dos: "DOS", tools: "Tools" };

export const skeletonCards = (n) =>
  Array.from({ length: n }, () => `<div class="card skeleton" aria-hidden="true"><div class="thumb"></div><div class="name"></div><div class="meta"></div></div>`).join("");

export async function renderGames(view, params) {
  view.innerHTML = html`<div class="page-head"><div><h1>Games</h1><p class="sub">Loading the catalogs…</p></div></div>
    <div class="grid" aria-busy="true">${raw(skeletonCards(21))}</div>`.toString();
  const cat = await loadCatalog();
  const state = {
    q: params.get("q") || "",
    source: params.get("source") || "all",
    tag: params.get("tag") || "",
    shown: PAGE,
  };

  const counts = { gn: 0, c6x: 0 };
  for (const g of cat.games) g.source === dec("XB87IEscUw==") ? counts.gn++ : counts.c6x++;

  view.innerHTML = html`
    <div class="page-head">
      <div><h1>Games</h1><p class="sub">${cat.games.length.toLocaleString()}${dec("GxZ3IE8bGxB1P0UbSFFiOkVIVxh0P0saUhRlbQI=")}${counts.gn.toLocaleString()}${dec("G1o2")}${counts.c6x.toLocaleString()}).</p></div>
    </div>
    ${cat.errors.map((e) => html`<div class="notice err">${e}</div>`)}
    <div class="toolbar">
      <label class="search">${icon("search")}<input class="input" id="g-q" type="search" placeholder="Search games or developers" value="${state.q}" aria-label="Search games" data-slash /><kbd>/</kbd></label>
      <span class="count" id="g-count"></span>
    </div>
    <div class="quick" id="g-filters" style="margin:0 0 22px"></div>
    <div class="grid" id="g-grid"></div>
    <div class="more"><button class="btn ghost" id="g-more" hidden>Show more</button></div>
  `.toString();

  const grid = $("#g-grid", view);
  bindCardClicks(grid);

  const filters = () => {
    const f = favs();
    const chips = [
      ["source", "all", "All"],
      ["source", dec("XB87IEscUw=="), dec("XB87IEscUw==")],
      ["source", dec("WB13PlkaVB57YBwQ"), dec("eB13PlkaVB57bRwQ")],
      ["source", "favs", `Favorites${f.size ? ` (${f.size})` : ""}`],
      ["source", "recent", "Recently played"],
      ...Object.entries(TAG_LABELS).map(([t, l]) => ["tag", t, l]),
    ];
    $("#g-filters", view).innerHTML = chips
      .map(([k, v, l]) => {
        const on = k === "source" ? state.source === v : state.tag === v;
        return `<button class="chip${on ? " on" : ""}" data-k="${k}" data-v="${esc(v)}">${esc(l)}</button>`;
      })
      .join("");
  };

  const list = () => {
    let gs = cat.games;
    if (state.source === "favs") {
      const f = favs();
      gs = gs.filter((g) => f.has(g.id));
    } else if (state.source === "recent") {
      gs = recents().map((id) => cat.byId.get(id)).filter(Boolean);
    } else if (state.source !== "all") gs = gs.filter((g) => g.source === state.source);
    if (state.tag) gs = gs.filter((g) => g.tags?.includes(state.tag));
    const q = state.q.trim().toLowerCase();
    if (q) gs = gs.filter((g) => g.name.toLowerCase().includes(q) || (g.author || "").toLowerCase().includes(q));
    return gs;
  };

  const draw = () => {
    const gs = list();
    grid.innerHTML = gs.length
      ? gs.slice(0, state.shown).map((g) => gameCard(g).toString()).join("")
      : `<div class="empty">${state.source === "favs" ? "No favorites yet. Open a game and press Favorite." : state.source === "recent" ? "Games you play show up here." : "No games match that search."}</div>`;
    $("#g-count", view).textContent = `${gs.length.toLocaleString()} ${gs.length === 1 ? "game" : "games"}`;
    $("#g-more", view).hidden = gs.length <= state.shown;
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.source !== "all") p.set("source", state.source);
    if (state.tag) p.set("tag", state.tag);
    history.replaceState(null, "", "#/games" + (p.size ? "?" + p : ""));
  };

  let t;
  $("#g-q", view).addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = e.target.value;
      state.shown = PAGE;
      draw();
    }, 120);
  });
  $("#g-filters", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (!b) return;
    if (b.dataset.k === "source") state.source = b.dataset.v;
    else state.tag = state.tag === b.dataset.v ? "" : b.dataset.v;
    state.shown = PAGE;
    filters();
    draw();
  });
  $("#g-more", view).addEventListener("click", () => {
    state.shown += PAGE;
    draw();
  });
  filters();
  draw();
}

let currentGame = null;

export async function playGame(id) {
  const cat = await loadCatalog();
  const g = cat.byId.get(id);
  if (!g) return toast("Game not found.");
  currentGame = g;
  pushRecent(id);
  const player = $("#player");
  const stage = $("#player-stage");
  $("#player-title").textContent = g.name;
  $("#player-source").textContent = g.source === dec("XB87IEscUw==") ? `${dec("XB87IEscUw==")}${g.author ? " · " + g.author : ""}` : dec("eB13PlkaVB57bRwQ");
  updateFavButton();
  stage.innerHTML = `<div class="loading">Loading ${esc(g.name)}…</div>`;
  player.hidden = false;
  document.body.style.overflow = "hidden";

  try {
    if (g.play.type === "html") {
      const f = document.createElement("iframe");
      f.allow = "fullscreen; autoplay; gamepad";
      f.src = g.play.url;
      stage.replaceChildren(f);
      f.focus();
    } else {
      let target = g.play.url;
      if (g.play.resolve) {
        try {
          target = (await (await fetch(g.play.resolve)).json()).url || target;
        } catch {}
      }
      if (currentGame !== g) return;
      const frame = await createProxiedFrame(target);
      if (currentGame !== g) return;
      stage.replaceChildren(frame);
      frame.focus();
    }
  } catch (e) {
    stage.innerHTML = `<div class="loading">${esc(e.message)}</div>`;
  }
}

function updateFavButton() {
  const b = $("#player [data-act='fav']");
  if (!b || !currentGame) return;
  const on = favs().has(currentGame.id);
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", String(on));
  b.querySelector("svg").classList.toggle("fill", on);
  b.querySelector(".label").textContent = on ? "Favorited" : "Favorite";
}

export function initPlayer() {
  const player = $("#player");
  player.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") closePlayer();
    if (act === "fullscreen") requestFullscreen($("#player-stage"));
    if (act === "fav" && currentGame) {
      const f = favs();
      f.has(currentGame.id) ? f.delete(currentGame.id) : f.add(currentGame.id);
      store.set("favs", [...f]);
      updateFavButton();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !player.hidden && !document.fullscreenElement) closePlayer();
  });
}

function closePlayer() {
  currentGame = null;
  $("#player").hidden = true;
  $("#player-stage").innerHTML = "";
  document.body.style.overflow = "";
}

export { raw };
