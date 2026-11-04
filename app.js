// MapleStory Classic DB: loads data/*.json and renders searchable, sortable tables
// with a cross-linked detail panel.

const DATASETS = ["monsters", "items", "maps", "jobs"];
const db = {};      // db.monsters = [...]
const byId = {};    // byId.monsters.snail = {...}

const COLUMNS = {
  monsters: [
    { key: "name", label: "Name" },
    { key: "level", label: "Lv", num: true },
    { key: "hp", label: "HP", num: true },
    { key: "exp", label: "EXP", num: true },
  ],
  items: [
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "level", label: "Req Lv", num: true },
    { key: "price", label: "Shop Price", num: true },
  ],
  maps: [
    { key: "name", label: "Name" },
    { key: "region", label: "Region" },
  ],
  jobs: [
    { key: "name", label: "Name" },
    { key: "branch", label: "Branch" },
    { key: "advancement", label: "Adv", num: true },
    { key: "level", label: "Req Lv", num: true },
  ],
};

const state = { tab: "monsters", sortKey: "level", asc: true, selected: null };
const $ = (s) => document.querySelector(s);

async function load() {
  await Promise.all(DATASETS.map(async (name) => {
    const res = await fetch(`data/${name}.json`);
    db[name] = await res.json();
    byId[name] = Object.fromEntries(db[name].map((e) => [e.id, e]));
  }));
  bind();
  render();
}

function bind() {
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset.tab)));
  ["#search", "#minLv", "#maxLv"].forEach((s) => $(s).addEventListener("input", render));
}

function switchTab(tab, selectId = null) {
  state.tab = tab;
  state.sortKey = COLUMNS[tab].some((c) => c.key === "level") ? "level" : "name";
  state.asc = true;
  state.selected = selectId;
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab));
  $("#search").value = "";
  render();
}

function filtered() {
  const q = $("#search").value.trim().toLowerCase();
  const min = parseInt($("#minLv").value, 10);
  const max = parseInt($("#maxLv").value, 10);
  const rows = db[state.tab].filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (e.level != null) {
      if (!isNaN(min) && e.level < min) return false;
      if (!isNaN(max) && e.level > max) return false;
    }
    return true;
  });
  const k = state.sortKey;
  rows.sort((a, b) => {
    const x = a[k] ?? "", y = b[k] ?? "";
    const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return state.asc ? r : -r;
  });
  return rows;
}

function render() {
  const cols = COLUMNS[state.tab];
  const rows = filtered();
  const head = cols.map((c) => {
    const cls = [c.num ? "num" : "", state.sortKey === c.key ? "sorted" : "", state.sortKey === c.key && state.asc ? "asc" : ""].join(" ");
    return `<th class="${cls}" data-key="${c.key}">${c.label}</th>`;
  }).join("");
  const body = rows.map((e) => `<tr data-id="${e.id}" class="${e.id === state.selected ? "selected" : ""}">` +
    cols.map((c, i) => {
      const v = e[c.key] ?? "—";
      const mark = i === 0 && e.verified === false ? '<span class="unv" title="Unverified">?</span>' : "";
      return `<td class="${c.num ? "num" : ""}">${esc(v)}${mark}</td>`;
    }).join("") + "</tr>").join("");
  $("#table").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  $("#count").textContent = `${rows.length} result${rows.length === 1 ? "" : "s"}`;

  $("#table").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.key;
    state.asc = state.sortKey === k ? !state.asc : true;
    state.sortKey = k;
    render();
  }));
  $("#table").querySelectorAll("tbody tr").forEach((tr) =>
    tr.addEventListener("click", () => { state.selected = tr.dataset.id; render(); }));

  renderDetail();
}

// ---------- detail panel ----------

function link(type, id) {
  const e = byId[type]?.[id];
  return e ? `<a data-type="${type}" data-id="${id}">${esc(e.name)}</a>` : esc(id);
}
function list(type, ids) {
  return ids?.length ? `<ul>${ids.map((id) => `<li>${link(type, id)}</li>`).join("")}</ul>` : "<p>—</p>";
}
function reverse(type, field, id) {
  return db[type].filter((e) => (e[field] || []).includes(id)).map((e) => e.id);
}

function renderDetail() {
  const panel = $("#detail");
  const e = state.selected && byId[state.tab][state.selected];
  $("#layout").classList.toggle("with-detail", !!e);
  if (!e) { panel.hidden = true; return; }
  panel.hidden = false;

  let html = `<button class="close" title="Close">×</button><h2>${esc(e.name)}</h2>`;
  const dl = (pairs) => `<dl>${pairs.filter(([, v]) => v != null).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;

  if (state.tab === "monsters") {
    html += `<p class="sub">Monster</p>` + dl([["Level", e.level], ["HP", e.hp], ["MP", e.mp], ["EXP", e.exp]]);
    html += `<h3>Drops</h3>${list("items", e.drops)}<h3>Found in</h3>${list("maps", e.maps)}`;
  } else if (state.tab === "items") {
    html += `<p class="sub">${esc(e.type)}</p>` + dl([["Req. level", e.level], ["Job", e.job], ["Shop price", e.price], ["Effect", e.effect]]);
    html += `<h3>Dropped by</h3>${list("monsters", reverse("monsters", "drops", e.id))}`;
  } else if (state.tab === "maps") {
    html += `<p class="sub">${esc(e.region)}</p>`;
    html += `<h3>Monsters</h3>${list("monsters", reverse("monsters", "maps", e.id))}`;
    if (e.connects) html += `<h3>Connects to</h3>${list("maps", e.connects)}`;
  } else if (state.tab === "jobs") {
    html += `<p class="sub">${esc(e.branch)}</p>` + dl([["Advancement", e.advancement], ["Req. level", e.level], ["Instructor", e.instructor], ["Location", e.location], ["Main stat", e.stat]]);
    if (e.from) html += `<h3>Advances from</h3>${list("jobs", [e.from])}`;
    const next = db.jobs.filter((j) => j.from === e.id).map((j) => j.id);
    if (next.length) html += `<h3>Advances to</h3>${list("jobs", next)}`;
  }
  if (e.notes) html += `<h3>Notes</h3><p>${esc(e.notes)}</p>`;
  if (e.verified === false) html += `<p class="sub"><span class="unv">?</span> Values not yet verified.</p>`;

  panel.innerHTML = html;
  panel.querySelector(".close").onclick = () => { state.selected = null; render(); };
  panel.querySelectorAll("a[data-type]").forEach((a) =>
    a.addEventListener("click", () => switchTab(a.dataset.type, a.dataset.id)));
}

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

load().catch((err) => {
  $("#tableWrap").innerHTML = `<p style="padding:16px">Couldn't load data (${esc(err.message)}). If you opened the file directly, run <code>python3 -m http.server</code> in this folder instead.</p>`;
});
