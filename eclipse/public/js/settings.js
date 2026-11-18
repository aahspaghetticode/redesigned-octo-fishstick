import { $, html, esc, store, toast } from "./util.js";
import { ENGINES, DEFAULT_ENGINE, engineStatus, currentEngine, setEngine, resetRammerhead } from "./proxy.js";

export const SEARCH_ENGINES = [
  ["DuckDuckGo", "https://duckduckgo.com/?q=%s"],
  ["Google", "https://www.google.com/search?q=%s"],
  ["Bing", "https://www.bing.com/search?q=%s"],
  ["Brave Search", "https://search.brave.com/search?q=%s"],
];

export async function renderSettings(view) {
  const [st, shell] = await Promise.all([
    engineStatus(),
    fetch("/api/shell/status")
      .then((r) => r.json())
      .catch(() => ({ enabled: false })),
  ]);
  const search = store.get("search", SEARCH_ENGINES[0][1]);

  const engineRow = ([id, e]) => {
    const s = st[id] || { ok: false };
    const on = currentEngine() === id;
    return html`<label class="option${on ? " on" : ""}${s.ok ? "" : " off"}">
      <input type="radio" name="engine" value="${id}" ${on ? "checked" : ""} ${s.ok ? "" : "disabled"} />
      <div><strong>${e.name}</strong><span>${s.ok ? e.desc : `Turned off on this server. ${s.reason || ""}`}</span></div>
      ${id === DEFAULT_ENGINE ? html`<span class="tag accent">Default</span>` : s.ok ? "" : html`<span class="tag bad">Off</span>`}
    </label>`;
  };

  view.innerHTML = html`
    <div class="settings">
      <div class="page-head"><div><h1>Settings</h1><p class="sub">Saved in this browser only.</p></div></div>

      <section class="section">
        <h2>Proxy engine</h2>
        <p class="sub">Used for Browse and for Classroom 6x games. If a site breaks, try another engine.</p>
        <div class="options" id="engines">${Object.entries(ENGINES).map(engineRow)}</div>
      </section>

      <section class="section">
        <h2>Search engine</h2>
        <p class="sub">Used when you type something that isn't a web address.</p>
        <select class="select" id="search-engine" style="min-width:240px">
          ${SEARCH_ENGINES.map(([n, u]) => html`<option value="${u}" ${u === search ? "selected" : ""}>${n}</option>`)}
        </select>
      </section>

      <section class="section">
        <h2>Your data</h2>
        <p class="sub">Favorites, history and the Rammerhead session stay in this browser.</p>
        <div class="inline">
          <button class="btn ghost" data-clear="recent">Clear recently played</button>
          <button class="btn ghost" data-clear="favs">Clear favorites</button>
          <button class="btn ghost" data-clear="rh">Reset Rammerhead session</button>
        </div>
      </section>

      <section class="section">
        <h2>Server</h2>
        <p class="sub">${shell.enabled
          ? html`A terminal on this server, signed in as <code>${shell.user}</code> with that account's password.`
          : html`The server shell is turned off. Set <code>SHELL_ENABLED=true</code> in <code>/etc/eclipse.env</code> to turn it on.`}</p>
        ${shell.enabled ? html`<a class="btn ghost" href="#/shell">Open server shell</a>` : ""}
      </section>
    </div>`.toString();

  $("#engines", view).addEventListener("change", (e) => {
    if (e.target.name !== "engine") return;
    setEngine(e.target.value);
    view.querySelectorAll(".option").forEach((o) => o.classList.toggle("on", o.querySelector("input").checked));
    toast(`${ENGINES[e.target.value].name} is now your proxy engine.`);
  });
  $("#search-engine", view).addEventListener("change", (e) => {
    store.set("search", e.target.value);
    toast("Search engine saved.");
  });
  view.addEventListener("click", (e) => {
    const what = e.target.closest("[data-clear]")?.dataset.clear;
    if (!what) return;
    if (what === "rh") resetRammerhead();
    else store.del(what);
    toast({ recent: "History cleared.", favs: "Favorites cleared.", rh: "Rammerhead session reset." }[what]);
  });
}

export { esc };
