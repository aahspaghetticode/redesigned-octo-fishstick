// Jellyfin web client. All requests go to /jf/*, which the server reverse
// proxies to JELLYFIN_URL (a stub until configured).
import { $, html, esc, store, toast, letterTile } from "./util.js";

const BASE = "/jf";
const CLIENT = "henws hub";
const VERSION = "1.0.0";
const TICKS = 10_000_000;

function deviceId() {
  let id = store.get("jf:device");
  if (!id) {
    id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()).replace(/-/g, "");
    store.set("jf:device", id);
  }
  return id;
}

let session = store.get("jf:session"); // { token, userId, userName, server }

function authHeader() {
  let h = `MediaBrowser Client="${CLIENT}", Device="Web Browser", DeviceId="${deviceId()}", Version="${VERSION}"`;
  if (session?.token) h += `, Token="${session.token}"`;
  return h;
}

async function api(path, { method = "GET", body, query } = {}) {
  const url = new URL(BASE + path, location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== "") url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { "X-Emby-Authorization": authHeader(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    logout();
    throw new Error("Session expired. Sign in again.");
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  const type = res.headers.get("content-type") || "";
  return type.includes("json") ? res.json() : null;
}

function logout() {
  session = null;
  store.del("jf:session");
}

const img = (id, type = "Primary", h = 360, tag) =>
  `${BASE}/Items/${id}/Images/${type}?fillHeight=${h}&quality=85${tag ? `&tag=${tag}` : ""}`;

function posterFor(item, wide = false) {
  if (wide) {
    if (item.ImageTags?.Thumb) return img(item.Id, "Thumb", 300, item.ImageTags.Thumb);
    if (item.BackdropImageTags?.length) return img(item.Id, "Backdrop", 300, item.BackdropImageTags[0]);
    if (item.ParentThumbItemId) return img(item.ParentThumbItemId, "Thumb", 300);
    if (item.ParentBackdropItemId) return img(item.ParentBackdropItemId, "Backdrop", 300);
  }
  if (item.ImageTags?.Primary) return img(item.Id, "Primary", wide ? 300 : 420, item.ImageTags.Primary);
  if (item.SeriesId && item.SeriesPrimaryImageTag) return img(item.SeriesId, "Primary", 420, item.SeriesPrimaryImageTag);
  return null;
}

function itemCard(item, { wide = false } = {}) {
  const src = posterFor(item, wide);
  const pct = item.UserData?.PlayedPercentage;
  const title = item.Type === "Episode" ? item.SeriesName || item.Name : item.Name;
  const meta =
    item.Type === "Episode"
      ? `S${item.ParentIndexNumber ?? "?"}:E${item.IndexNumber ?? "?"} · ${item.Name}`
      : item.ProductionYear || TYPE_LABEL[item.Type] || "";
  return html`<button class="card${wide ? " wide" : ""}" data-item="${item.Id}" data-type="${item.Type}" title="${title}">
    <div class="thumb">
      ${letterTile(title)}
      ${src ? html`<img loading="lazy" alt="" src="${src}" onerror="this.remove()" />` : ""}
      ${pct ? html`<div class="progress"><i style="width:${Math.round(pct)}%"></i></div>` : ""}
    </div>
    <span class="name">${title}</span>
    <span class="meta">${meta}</span>
  </button>`;
}

const TYPE_LABEL = { CollectionFolder: "Library", UserView: "Library", Series: "Series", BoxSet: "Collection", Folder: "Folder", Playlist: "Playlist" };
const FIELDS = "PrimaryImageAspectRatio,ProductionYear,Overview,UserData,ChildCount";

// ---------- Views ----------

export async function renderMedia(view, path) {
  view.innerHTML = `<p class="muted">Connecting…</p>`;
  let cfg;
  try {
    cfg = await (await fetch(BASE + "/__config")).json();
  } catch {
    cfg = { configured: false };
  }
  if (!cfg.configured) return renderStub(view);
  if (!session?.token) return renderLogin(view, cfg);

  try {
    const [, kind, id] = path;
    if (kind === "lib" && id) return await renderLibrary(view, id);
    if (kind === "item" && id) return await renderItem(view, id);
    if (kind === "search") return await renderSearch(view);
    return await renderHome(view);
  } catch (e) {
    view.innerHTML = html`<div class="notice err">${e.message}</div>`.toString();
    if (!session) setTimeout(() => renderMedia(view, []), 600);
  }
}

function renderStub(view) {
  view.innerHTML = html`
    <h1>Media</h1>
    <p class="sub">Jellyfin client</p>
    <div class="notice">
      No Jellyfin server is connected yet. The host is a stub. To connect one, set
      <code>JELLYFIN_URL</code> in <code>/etc/henws-hub.env</code> on the server (for example
      <code>JELLYFIN_URL=http://10.0.0.5:8096</code>), then run <code>systemctl restart henws-hub</code>.
    </div>
  `.toString();
}

function renderLogin(view, cfg) {
  view.innerHTML = html`
    <form class="login" id="jf-login">
      <h1>Sign in to Jellyfin</h1>
      <p class="sub">Server: ${cfg.server}</p>
      <div class="field"><label for="jf-user">Username</label><input class="input" id="jf-user" autocomplete="username" required /></div>
      <div class="field"><label for="jf-pass">Password</label><input class="input" id="jf-pass" type="password" autocomplete="current-password" /></div>
      <div class="notice err" id="jf-err" hidden></div>
      <button class="btn" type="submit" style="width:100%;justify-content:center">Sign in</button>
    </form>`.toString();
  $("#jf-login", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const r = await api("/Users/AuthenticateByName", {
        method: "POST",
        body: { Username: $("#jf-user", view).value, Pw: $("#jf-pass", view).value },
      });
      session = { token: r.AccessToken, userId: r.User.Id, userName: r.User.Name, server: cfg.server };
      store.set("jf:session", session);
      renderMedia(view, []);
    } catch (err) {
      const el = $("#jf-err", view);
      el.textContent = /401|expired/.test(err.message) ? "Wrong username or password." : err.message;
      el.hidden = false;
      btn.disabled = false;
    }
  });
}

function header(crumbs = []) {
  return html`
    <div class="toolbar">
      <form id="jf-search" style="display:flex;flex:1 1 260px;gap:8px">
        <input class="input" style="flex:1" name="q" type="search" placeholder="Search movies, shows, episodes" aria-label="Search media" />
      </form>
      <span class="muted" style="font-size:13px">${session.userName}</span>
      <button class="btn ghost" id="jf-logout">Sign out</button>
    </div>
    ${crumbs.length
      ? html`<nav class="crumbs"><a href="#/media">Media</a>${crumbs.map((c) => html`<span>/</span>${c.href ? html`<a href="${c.href}">${c.label}</a>` : html`<span>${c.label}</span>`}`)}</nav>`
      : ""}`;
}

function bindCommon(view) {
  $("#jf-logout", view)?.addEventListener("click", async () => {
    try {
      await api("/Sessions/Logout", { method: "POST" });
    } catch {}
    logout();
    renderMedia(view, []);
  });
  $("#jf-search", view)?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get("q");
    if (q) location.hash = "#/media/search?q=" + encodeURIComponent(q);
  });
  view.addEventListener("click", onCardClick);
}

function onCardClick(e) {
  const b = e.target.closest("[data-item]");
  if (!b) return;
  const { item, type } = b.dataset;
  if (["Movie", "Episode", "Video", "MusicVideo", "Audio"].includes(type)) return play(item);
  if (type === "CollectionFolder" || type === "UserView" || type === "BoxSet" || type === "Folder" || type === "Playlist")
    location.hash = `#/media/lib/${item}`;
  else location.hash = `#/media/item/${item}`;
}

async function renderHome(view) {
  const uid = session.userId;
  const [views, resume, next] = await Promise.all([
    api(`/Users/${uid}/Views`),
    api(`/Users/${uid}/Items/Resume`, { query: { Limit: 16, Fields: FIELDS, MediaTypes: "Video", EnableImageTypes: "Primary,Backdrop,Thumb" } }),
    api(`/Shows/NextUp`, { query: { UserId: uid, Limit: 16, Fields: FIELDS } }).catch(() => ({ Items: [] })),
  ]);
  const latestPerLib = await Promise.all(
    views.Items.filter((v) => ["movies", "tvshows"].includes(v.CollectionType)).map(async (v) => ({
      lib: v,
      items: await api(`/Users/${uid}/Items/Latest`, { query: { ParentId: v.Id, Limit: 16, Fields: FIELDS } }).catch(() => []),
    }))
  );
  view.innerHTML = html`
    <h1>Media</h1>
    ${header()}
    <h2>Libraries</h2>
    <div class="row wide">${views.Items.map((v) => itemCard(v, { wide: true }))}</div>
    ${resume.Items.length ? html`<h2>Continue watching</h2><div class="row wide">${resume.Items.map((i) => itemCard(i, { wide: true }))}</div>` : ""}
    ${next.Items?.length ? html`<h2>Next up</h2><div class="row wide">${next.Items.map((i) => itemCard(i, { wide: true }))}</div>` : ""}
    ${latestPerLib
      .filter((l) => l.items.length)
      .map((l) => html`<h2>Latest in ${l.lib.Name}</h2><div class="row">${l.items.map((i) => itemCard(i))}</div>`)}
  `.toString();
  bindCommon(view);
}

async function renderLibrary(view, id) {
  const uid = session.userId;
  const lib = await api(`/Users/${uid}/Items/${id}`);
  const typeFor = { movies: "Movie", tvshows: "Series", music: "MusicAlbum", musicvideos: "MusicVideo", boxsets: "BoxSet" };
  const includeTypes = typeFor[lib.CollectionType];
  let start = 0;
  const limit = 60;
  view.innerHTML = html`
    <h1>${lib.Name}</h1>
    ${header([{ label: lib.Name }])}
    <div class="toolbar">
      <select class="select" id="jf-sort" aria-label="Sort">
        <option value="SortName,Ascending">Name</option>
        <option value="DateCreated,Descending">Recently added</option>
        <option value="PremiereDate,Descending">Release date</option>
        <option value="CommunityRating,Descending">Rating</option>
      </select>
      <span class="count" id="jf-count"></span>
    </div>
    <div class="grid posters" id="jf-grid"></div>
    <div class="more"><button class="btn ghost" id="jf-more" hidden>Load more</button></div>
  `.toString();
  bindCommon(view);
  const grid = $("#jf-grid", view);

  const load = async (reset) => {
    if (reset) {
      start = 0;
      grid.innerHTML = "";
    }
    const [sortBy, sortOrder] = $("#jf-sort", view).value.split(",");
    const r = await api(`/Users/${uid}/Items`, {
      query: {
        ParentId: id,
        IncludeItemTypes: includeTypes,
        Recursive: includeTypes ? "true" : "false",
        SortBy: sortBy,
        SortOrder: sortOrder,
        StartIndex: start,
        Limit: limit,
        Fields: FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: "Primary",
      },
    });
    grid.insertAdjacentHTML("beforeend", r.Items.map((i) => itemCard(i).toString()).join(""));
    start += r.Items.length;
    $("#jf-count", view).textContent = `${r.TotalRecordCount.toLocaleString()} items`;
    $("#jf-more", view).hidden = start >= r.TotalRecordCount;
    if (!r.TotalRecordCount) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">This library is empty.</div>`;
  };
  $("#jf-sort", view).addEventListener("change", () => load(true).catch((e) => toast(e.message)));
  $("#jf-more", view).addEventListener("click", () => load(false).catch((e) => toast(e.message)));
  await load(true);
}

const runtime = (ticks) => {
  if (!ticks) return "";
  const m = Math.round(ticks / TICKS / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

async function renderItem(view, id) {
  const uid = session.userId;
  const item = await api(`/Users/${uid}/Items/${id}`);
  const poster = posterFor(item);
  const facts = [
    item.ProductionYear,
    item.OfficialRating,
    runtime(item.RunTimeTicks),
    item.CommunityRating ? `Rated ${item.CommunityRating.toFixed(1)}` : "",
    (item.Genres || []).slice(0, 3).join(", "),
  ].filter(Boolean);
  view.innerHTML = html`
    ${header([{ label: item.Name }])}
    <div class="detail">
      <div class="poster">${letterTile(item.Name)}${poster ? html`<img alt="" src="${poster}" onerror="this.remove()" />` : ""}</div>
      <div>
        <h1>${item.Name}</h1>
        <div class="facts">${facts.map((f) => html`<span>${f}</span>`)}</div>
        <p class="overview">${item.Overview || ""}</p>
        <div class="actions" id="jf-actions"></div>
        <div id="jf-seasons" class="quick"></div>
        <div id="jf-episodes" class="episodes" style="margin-top:16px"></div>
        <div id="jf-children"></div>
      </div>
    </div>
  `.toString();
  bindCommon(view);
  const actions = $("#jf-actions", view);

  if (item.Type === "Series") {
    const seasons = await api(`/Shows/${id}/Seasons`, { query: { UserId: uid } });
    const next = await api(`/Shows/NextUp`, { query: { UserId: uid, SeriesId: id, Limit: 1 } }).catch(() => ({ Items: [] }));
    if (next.Items?.[0]) {
      const n = next.Items[0];
      actions.innerHTML = html`<button class="btn" data-play="${n.Id}">Play S${n.ParentIndexNumber}:E${n.IndexNumber}</button>`.toString();
    }
    const box = $("#jf-seasons", view);
    box.innerHTML = seasons.Items.map((s, i) => `<button class="chip${i === 0 ? " on" : ""}" data-season="${s.Id}">${esc(s.Name)}</button>`).join("");
    const showSeason = async (sid) => {
      box.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.season === sid));
      const eps = await api(`/Shows/${id}/Episodes`, { query: { UserId: uid, SeasonId: sid, Fields: "Overview,UserData" } });
      $("#jf-episodes", view).innerHTML = eps.Items.map((ep) => {
        const t = posterFor(ep, true);
        const pct = ep.UserData?.PlayedPercentage;
        return html`<button class="episode" data-play="${ep.Id}">
          <div class="thumb">${letterTile(ep.Name)}${t ? html`<img loading="lazy" alt="" src="${t}" onerror="this.remove()" />` : ""}${pct ? html`<div class="progress"><i style="width:${Math.round(pct)}%"></i></div>` : ""}</div>
          <div><strong>${ep.IndexNumber != null ? ep.IndexNumber + ". " : ""}${ep.Name}</strong>${ep.UserData?.Played ? html` <span class="muted">· watched</span>` : ""}
          <p>${ep.Overview || runtime(ep.RunTimeTicks)}</p></div>
        </button>`.toString();
      }).join("");
    };
    box.addEventListener("click", (e) => {
      const s = e.target.closest("[data-season]");
      if (s) showSeason(s.dataset.season).catch((err) => toast(err.message));
    });
    if (seasons.Items[0]) await showSeason(seasons.Items[0].Id);
  } else if (item.IsFolder) {
    const kids = await api(`/Users/${uid}/Items`, { query: { ParentId: id, Fields: FIELDS, SortBy: "SortName" } });
    $("#jf-children", view).innerHTML = html`<div class="grid posters">${kids.Items.map((i) => itemCard(i))}</div>`.toString();
  } else {
    const pos = item.UserData?.PlaybackPositionTicks || 0;
    actions.innerHTML = html`
      <button class="btn" data-play="${id}" data-start="${pos}">${pos ? `Resume from ${fmtTime(pos / TICKS)}` : "Play"}</button>
      ${pos ? html`<button class="btn ghost" data-play="${id}" data-start="0">Start over</button>` : ""}`.toString();
  }

  view.addEventListener("click", (e) => {
    const p = e.target.closest("[data-play]");
    if (p) {
      e.stopPropagation();
      play(p.dataset.play, p.dataset.start != null ? Number(p.dataset.start) : undefined);
    }
  });
}

async function renderSearch(view) {
  const q = new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "";
  const r = await api(`/Users/${session.userId}/Items`, {
    query: { searchTerm: q, Recursive: "true", IncludeItemTypes: "Movie,Series,Episode,BoxSet", Limit: 60, Fields: FIELDS },
  });
  view.innerHTML = html`
    ${header([{ label: `Search: ${q}` }])}
    <div class="grid posters">${r.Items.length ? r.Items.map((i) => itemCard(i)) : html`<div class="empty" style="grid-column:1/-1">Nothing found for “${q}”.</div>`}</div>
  `.toString();
  bindCommon(view);
  const input = $("#jf-search input", view);
  if (input) input.value = q;
}

// ---------- Playback ----------

const fmtTime = (s) => {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
};

let activePlayback = null;

async function play(id, startTicks) {
  const uid = session.userId;
  let item;
  try {
    item = await api(`/Users/${uid}/Items/${id}`);
  } catch (e) {
    return toast(e.message);
  }
  if (startTicks == null) startTicks = item.UserData?.PlaybackPositionTicks || 0;
  const playSessionId = (crypto.randomUUID?.() || String(Date.now())).replace(/-/g, "");
  const mediaSourceId = item.MediaSources?.[0]?.Id || id;
  const q = new URLSearchParams({
    MediaSourceId: mediaSourceId,
    DeviceId: deviceId(),
    PlaySessionId: playSessionId,
    api_key: session.token,
    VideoCodec: "h264",
    AudioCodec: "aac,mp3",
    TranscodingMaxAudioChannels: "2",
    SegmentContainer: "ts",
    MinSegments: "1",
    BreakOnNonKeyFrames: "True",
    "h264-profile": "high,main,baseline,constrained baseline",
    "h264-level": "51",
    StartTimeTicks: "0",
  });
  const hlsUrl = `${BASE}/Videos/${id}/master.m3u8?${q}`;
  const directUrl = `${BASE}/Videos/${id}/stream?static=true&MediaSourceId=${mediaSourceId}&api_key=${session.token}`;

  const wrap = document.createElement("div");
  wrap.className = "video-wrap";
  const label = item.Type === "Episode" ? `${item.SeriesName} · S${item.ParentIndexNumber}:E${item.IndexNumber} ${item.Name}` : item.Name;
  wrap.innerHTML = html`
    <div class="player-bar">
      <strong>${label}</strong><span class="spacer"></span>
      <select class="select" data-mode aria-label="Playback mode" style="height:34px">
        <option value="hls">Auto (transcode if needed)</option>
        <option value="direct">Direct file</option>
      </select>
      <button class="btn ghost" data-close>Close</button>
    </div>
    <video controls autoplay playsinline></video>`.toString();
  document.body.append(wrap);
  document.body.style.overflow = "hidden";
  const video = wrap.querySelector("video");
  let hls = null;

  const load = (mode, at) => {
    hls?.destroy();
    hls = null;
    const seek = () => {
      if (at > 0) video.currentTime = at;
    };
    if (mode === "direct") {
      video.src = directUrl;
      video.addEventListener("loadedmetadata", seek, { once: true });
    } else if (window.Hls?.isSupported()) {
      hls = new Hls({ startPosition: at || -1 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) toast("Playback error. Try “Direct file” mode.");
      });
    } else {
      video.src = hlsUrl; // Safari plays HLS natively
      video.addEventListener("loadedmetadata", seek, { once: true });
    }
    video.play().catch(() => {});
  };
  load("hls", startTicks / TICKS);

  const report = (path, extra = {}) =>
    api(path, {
      method: "POST",
      body: {
        ItemId: id,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        PositionTicks: Math.floor((video.currentTime || 0) * TICKS),
        IsPaused: video.paused,
        CanSeek: true,
        PlayMethod: "Transcode",
        ...extra,
      },
    }).catch(() => {});
  report("/Sessions/Playing", { PositionTicks: startTicks });
  const timer = setInterval(() => report("/Sessions/Playing/Progress"), 10000);

  const close = () => {
    clearInterval(timer);
    report("/Sessions/Playing/Stopped");
    hls?.destroy();
    video.removeAttribute("src");
    video.load();
    wrap.remove();
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    activePlayback = null;
  };
  const onKey = (e) => {
    if (e.key === "Escape" && !document.fullscreenElement) close();
  };
  document.addEventListener("keydown", onKey);
  wrap.querySelector("[data-close]").addEventListener("click", close);
  wrap.querySelector("[data-mode]").addEventListener("change", (e) => load(e.target.value, video.currentTime));
  activePlayback = { close };
}

export function stopPlayback() {
  activePlayback?.close();
}
