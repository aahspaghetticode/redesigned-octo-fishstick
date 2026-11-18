import { $, esc, store, dec } from "./util.js";

export const ENGINES = {
  e1: { name: dec("aBJkLEcCXgU="), desc: dec("fRBlOU8bT1F3I05ITB5kJllIVB82OUINGxx5Pl5ISBhiKFlEGxh4LkYdXxh4KgoxVARCOEgNGxB4KQosUgJ1IlgMFQ==") },
  e2: { name: dec("bh1iP0seUh56KF4="), desc: dec("dhBiOFgNGwJzP1wBWBQ7OkUaUBRkbVoaVAlvYwopGxZ5Ik5IXRB6IUgJWBo2OkINVVF3bVkBTxQ2L1gNWhplbUUGGyJ1P0sFURRiYw==") },
  e4: { name: dec("eB5kP0UbUh54"), desc: dec("dB1yKFhISBRkO08aFgJ/KU9ISRRhP0McXgM4bWgNSAU2K0UaGwJ/IFoEXlF5PwoHVxVzPwobUgVzPgQ=") },
};
export const DEFAULT_ENGINE = "e1";

let statusPromise = null;
export function engineStatus() {
  statusPromise ||= fetch("/api/cfg")
    .then((r) => r.text())
    .then((t) => JSON.parse(dec(t)))
    .catch(() => ({ e1: { ok: true }, e2: { ok: true } }));
  return statusPromise;
}

export function currentEngine() {
  const e = store.get("eng", DEFAULT_ENGINE);
  return ENGINES[e] ? e : DEFAULT_ENGINE;
}
export function setEngine(e) {
  if (!ENGINES[e]) return;
  store.set("eng", e);
  document.querySelectorAll("select[data-engine-select]").forEach((s) => (s.value = e));
}

export async function bindEngineSelect(select, onChange) {
  const st = await engineStatus();
  select.dataset.engineSelect = "";
  select.innerHTML = Object.entries(ENGINES)
    .map(([id, e]) => `<option value="${id}" ${st[id]?.ok ? "" : "disabled"}>${esc(e.name)}${st[id]?.ok ? "" : " (off)"}</option>`)
    .join("");
  select.value = currentEngine();
  select.addEventListener("change", () => {
    setEngine(select.value);
    onChange?.(select.value);
  });
}

export function showBrowser(show) {
  $("#browser").hidden = !show;
}

const mod = () => import("./net.js");
export const warmUp = () => mod().then((m) => m.boot()).catch(() => {});
export async function openInBrowser(input, engine) {
  return (await mod()).openInBrowser(input, engine);
}
export async function makeFrame(url) {
  return (await mod()).makeFrame(url);
}

let inited = false;
export async function enterBrowse(params) {
  const m = await mod();
  if (!inited) {
    m.initBrowser();
    inited = true;
  }
  const u = params.get("url");
  if (u) m.openInBrowser(u);
  else if (!$("#browser-frame iframe")) $("#address").focus();
  m.boot().catch(() => {});
}
