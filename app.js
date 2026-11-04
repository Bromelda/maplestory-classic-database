// MapleStory Classic DB: interactive world map, searchable tables and a
// cross-linked detail panel. Data lives in data/*.json (built by tools/build_data.py).

const DATASETS = ["monsters", "items", "maps", "jobs", "meta"];
const db = {};
const byId = {};
const idx = { spawnsOf: {}, droppedBy: {}, incoming: {}, zones: {}, priceByName: {} };

// Free Market prices: Club FM's public daily summary, loaded live from GitHub.
const MARKET_URL = "https://raw.githubusercontent.com/maplefm/maplefm.github.io/live/data/summary-public.json";
const COZY_URL = "https://cozy.markets/market";
const CLUBFM_URL = "https://maplefm.gg";
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
function meso(n) {
  if (n == null) return "—";
  if (n > 0 && n < 1) return "<1";
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "k";
  return Math.round(n).toLocaleString();
}
function pct(x) { return x == null ? "—" : `${x > 0 ? "▲" : x < 0 ? "▼" : ""} ${Math.abs(x * 100).toFixed(0)}%`; }

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "—" : typeof n === "number" ? n.toLocaleString() : n);

// ---------- world map layout (schematic, not to scale) ----------
const ZONES = {
  "Mushroom Town": { x: 125, y: 140 },
  "Amherst": { x: 228, y: 98 },
  "Southperry": { x: 292, y: 178 },
  "Ellinia": { x: 450, y: 300 },
  "Perion": { x: 800, y: 285 },
  "Sleepywood": { x: 625, y: 395 },
  "Henesys": { x: 480, y: 450 },
  "Kerning City": { x: 815, y: 455 },
  "Lith Harbor": { x: 392, y: 545 },
  "Free Market": { x: 640, y: 525 },
  "Kerning City PQ": { x: 900, y: 560 },
  "Florina Beach": { x: 182, y: 560 },
  "Other": { x: 930, y: 90 },
};
const BOATS = [["Southperry", "Lith Harbor"], ["Lith Harbor", "Florina Beach"]];
const LEVEL_BANDS = [
  [10, "#5cb85c", "1–10"], [20, "#2bb3a3", "11–20"], [30, "#3d8be0", "21–30"],
  [40, "#8a5cd6", "31–40"], [50, "#e8711c", "41–50"], [999, "#d9434c", "51+"],
];
const TOWN_COLOR = "#a08a6a";
const MOB_COLORS = ["#e8711c", "#3d8be0", "#5cb85c", "#d9434c", "#8a5cd6", "#2bb3a3", "#d4a017", "#c2549d", "#6b7f2a", "#5b6ee1"];

function bandColor(lv) {
  if (lv == null) return TOWN_COLOR;
  return LEVEL_BANDS.find(([max]) => lv <= max)[1];
}

// ---------- table columns ----------
const COLUMNS = {
  monsters: [
    { key: "name", label: "Name" },
    { key: "level", label: "Lv", num: true },
    { key: "hp", label: "HP", num: true },
    { key: "exp", label: "EXP", num: true },
    { key: "_drops", label: "Drops", num: true, wide: true, get: (m) => m.drops.length },
    { key: "_maps", label: "Maps", num: true, get: (m) => (idx.spawnsOf[m.id] || []).length },
  ],
  items: [
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "category", label: "Category", wide: true },
    { key: "level", label: "Req Lv", num: true },
    { key: "_by", label: "Dropped by", num: true, get: (i) => (idx.droppedBy[i.id] || []).length },
  ],
  maps: [
    { key: "name", label: "Name" },
    { key: "zone", label: "Area" },
    { key: "type", label: "Type", wide: true },
    { key: "level", label: "Lv", num: true, get: (m) => (m.levels ? m.levels[0] : null), show: (m) => levelText(m.levels) },
    { key: "_mobs", label: "Mobs", num: true, get: (m) => m.spawns.reduce((a, s) => a + s.count, 0) },
  ],
  market: [
    { key: "name", label: "Item" },
    { key: "cat", label: "Category", wide: true },
    { key: "typ", label: "Price", num: true, show: (p) => meso(p.typ) },
    { key: "_range", label: "Range", num: true, wide: true, get: (p) => p.lo, show: (p) => `${meso(p.lo)}–${meso(p.hi)}` },
    { key: "change", label: "7-day", num: true, show: (p) => pct(p.change) },
    { key: "sales", label: "Sales", num: true, wide: true },
  ],
  jobs: [
    { key: "name", label: "Name" },
    { key: "branch", label: "Branch" },
    { key: "advancement", label: "Adv", num: true },
    { key: "level", label: "Req Lv", num: true },
  ],
};
const TYPE_OF_TAB = { monsters: "monster", items: "item", maps: "map", jobs: "job", market: "price" };
const TAB_OF_TYPE = { monster: "monsters", item: "items", map: "maps", job: "jobs", zone: "world", price: "market" };

const state = { tab: "world", sortKey: "level", asc: true, history: [], pos: -1, zone: null };

// ---------- load + index ----------
async function load() {
  await Promise.all(DATASETS.map(async (name) => {
    const res = await fetch(`data/${name}.json`);
    if (!res.ok) throw new Error(`${name}.json: ${res.status}`);
    db[name] = await res.json();
    if (Array.isArray(db[name])) byId[name] = Object.fromEntries(db[name].map((e) => [e.id, e]));
  }));
  for (const m of db.maps) {
    (idx.zones[m.zone] ||= []).push(m);
    for (const s of m.spawns) (idx.spawnsOf[s.monster] ||= []).push({ map: m.id, count: s.count });
    for (const p of m.portals) (idx.incoming[p.to] ||= new Set()).add(m.id);
  }
  for (const mob of db.monsters)
    for (const d of mob.drops) (idx.droppedBy[d.item] ||= []).push({ monster: mob.id, rate: d.rate, kills: d.kills });
  for (const list of Object.values(idx.droppedBy)) list.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  for (const list of Object.values(idx.spawnsOf)) list.sort((a, b) => b.count - a.count);
  if (db.meta?.built_from) $("#builtFrom").textContent = `Data: ${db.meta.built_from}.`;

  bind();
  renderWorld();
  fromHash() || switchTab("world");
  loadMarket();
}

async function loadMarket() {
  try {
    const res = await fetch(MARKET_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const raw = await res.json();
    db.market = raw.rows.map((r) => {
      const daily = (r.daily || []).filter((d) => d[1] != null);
      const change = daily.length > 1 ? daily[daily.length - 1][1] / daily[0][1] - 1 : null;
      return {
        id: slugify(r.item), name: r.item, cat: r.cat, typ: r.typ, lo: r.lo, hi: r.hi,
        sales: r.salesN ?? 0, listings: r.n ?? 0, basis: r.kind, conf: r.conf, daily, change,
        ladder: r.lad || null, sellers: r.typWho || [],
      };
    });
    db.marketAt = raw.at;
    byId.market = Object.fromEntries(db.market.map((p) => [p.id, p]));
    for (const p of db.market) idx.priceByName[p.name.toLowerCase()] = p;
    const cats = [...new Set(db.market.map((p) => p.cat))].sort();
    $("#cat").innerHTML = `<option value="">All categories</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  } catch (err) {
    db.market = [];
    db.marketError = String(err.message || err);
  }
  if (state.tab === "market") renderTable();
  if (location.hash.startsWith("#price/")) fromHash();
  else if (currentEntry()) renderDetail();
}
function priceOf(name) { return idx.priceByName[String(name).toLowerCase()]; }

function bind() {
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  ["#search", "#minLv", "#maxLv", "#variants", "#cat"].forEach((s) => $(s).addEventListener("input", renderTable));
  window.addEventListener("hashchange", fromHash);
  document.addEventListener("click", onLinkClick);
  document.addEventListener("mouseover", onHover);
  document.addEventListener("mouseout", (e) => { if (e.target.closest?.("[data-tip]")) hideTip(); });
}

function onLinkClick(e) {
  const a = e.target.closest("[data-type][data-id]");
  if (!a) return;
  e.preventDefault();
  open(a.dataset.type, a.dataset.id);
}

// ---------- tabs ----------
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const isWorld = tab === "world";
  $("#worldView").hidden = !isWorld;
  $("#tableWrap").hidden = isWorld;
  $("#controls").hidden = isWorld;
  $("#variantsWrap").hidden = tab !== "monsters";
  const isMarket = tab === "market";
  $("#catWrap").hidden = !isMarket;
  $("#marketBar").hidden = !isMarket;
  document.querySelectorAll(".lvctl").forEach((el) => { el.hidden = isMarket; });
  if (!isWorld) {
    state.sortKey = isMarket ? "sales" : COLUMNS[tab].some((c) => c.key === "level") ? "level" : "name";
    state.asc = !isMarket;
    $("#search").value = "";
    renderTable();
  }
}

// ---------- world map ----------
function zoneSummary(z) {
  const maps = idx.zones[z] || [];
  const lv = maps.flatMap((m) => m.levels || []).filter((x) => x != null);
  const mobs = maps.reduce((a, m) => a + m.spawns.length, 0);
  // typical level = median of each hunting map's lowest level (outliers don't skew the color)
  const starts = maps.filter((m) => m.spawns.length && m.levels).map((m) => m.levels[0]).sort((a, b) => a - b);
  const typical = starts.length ? starts[Math.floor(starts.length / 2)] : null;
  return { maps, min: lv.length ? Math.min(...lv) : null, max: lv.length ? Math.max(...lv) : null, mobs, typical };
}

function renderWorld() {
  const nodes = Object.entries(ZONES).filter(([z]) => idx.zones[z]).map(([z, pos]) => {
    const s = zoneSummary(z);
    const r = 16 + Math.min(18, Math.sqrt(s.maps.length) * 3.2);
    const color = s.mobs && s.typical != null ? bandColor(s.typical) : TOWN_COLOR;
    const sub = s.min == null ? `${s.maps.length} maps` : `Lv ${s.min}–${s.max}`;
    return `<g class="zone" data-type="zone" data-id="${esc(z)}" tabindex="0" role="button" aria-label="${esc(z)}">
      <circle cx="${pos.x}" cy="${pos.y}" r="${r}" fill="${color}"></circle>
      <text class="zone-count" x="${pos.x}" y="${pos.y + 4}" text-anchor="middle">${s.maps.length}</text>
      <text class="zone-name" x="${pos.x}" y="${pos.y + r + 17}" text-anchor="middle">${esc(z)}</text>
      <text class="zone-sub" x="${pos.x}" y="${pos.y + r + 32}" text-anchor="middle">${esc(sub)}</text>
    </g>`;
  }).join("");
  const boats = BOATS.map(([a, b]) => {
    const p = ZONES[a], q = ZONES[b];
    const mx = (p.x + q.x) / 2 - 30, my = (p.y + q.y) / 2 + 20;
    return `<path class="boat" d="M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}"></path>`;
  }).join("");
  const legend = LEVEL_BANDS.map(([, c, label]) => `<span><i class="dot" style="background:${c}"></i>Lv ${label}</span>`).join("") +
    `<span><i class="dot" style="background:${TOWN_COLOR}"></i>Town / no monsters</span><span>Color = typical training level · number = maps in area · dashed line = boat</span>`;
  $("#worldView").innerHTML = `
    <svg viewBox="0 0 1000 640" role="img" aria-label="World map of Maple Island and Victoria Island">
      <rect class="sea" width="1000" height="640"></rect>
      <path class="island" d="M80,130 C60,60 190,30 270,70 C350,110 370,215 300,238 C225,262 105,225 80,130 Z"></path>
      <path class="island" d="M350,330 C335,250 450,212 565,238 C660,200 790,198 885,250 C965,292 975,425 935,505 C900,585 785,612 655,592 C560,612 430,612 360,572 C305,532 318,420 350,330 Z"></path>
      <path class="island" d="M128,560 C128,522 214,516 238,548 C254,586 182,604 150,593 C134,587 128,576 128,560 Z"></path>
      <text class="island-label" x="70" y="35">Maple Island</text>
      <text class="island-label" x="560" y="225">Victoria Island</text>
      ${boats}${nodes}
    </svg>
    <div class="legend">${legend}</div>`;
  $("#worldView").querySelectorAll(".zone").forEach((g) => g.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open("zone", g.dataset.id); }
  }));
}

function highlightZone(z) {
  document.querySelectorAll(".zone").forEach((g) => g.classList.toggle("active", g.dataset.id === z));
}

// ---------- tables ----------
function valueOf(col, e) { return col.get ? col.get(e) : e[col.key]; }

function filtered() {
  const tab = state.tab;
  const q = $("#search").value.trim().toLowerCase();
  const min = parseInt($("#minLv").value, 10);
  const max = parseInt($("#maxLv").value, 10);
  const showVariants = $("#variants").checked;
  const lvOf = (e) => (tab === "maps" ? e.levels?.[0] : e.level);
  const cat = $("#cat").value;
  const rows = (db[tab] || []).filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (tab === "market") return !cat || e.cat === cat;
    if (tab === "monsters" && !showVariants && (e.variant || e.level >= 200 || e.name.startsWith("Tutorial") || (!idx.spawnsOf[e.id] && !e.drops.length))) return false;
    const lv = lvOf(e);
    if (!isNaN(min) && (lv == null || lv < min)) return false;
    if (!isNaN(max) && (lv == null || lv > max)) return false;
    return true;
  });
  const col = COLUMNS[tab].find((c) => c.key === state.sortKey) || COLUMNS[tab][0];
  rows.sort((a, b) => {
    const x = valueOf(col, a), y = valueOf(col, b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return state.asc ? r : -r;
  });
  return rows;
}

function renderTable() {
  const tab = state.tab;
  if (tab === "world") return;
  if (tab === "market" && (!db.market || db.marketError)) {
    $("#table").innerHTML = `<tbody><tr><td style="padding:20px;white-space:normal">${db.marketError
      ? `Couldn't load Free Market prices right now (${esc(db.marketError)}). You can still check <a href="${COZY_URL}" target="_blank" rel="noopener">Cozy Market</a>.`
      : "Loading Free Market prices…"}</td></tr></tbody>`;
    $("#count").textContent = "";
    return;
  }
  const cols = COLUMNS[tab];
  const rows = filtered();
  const type = TYPE_OF_TAB[tab];
  const cur = currentEntry();
  const head = cols.map((c) => {
    const s = state.sortKey === c.key;
    return `<th class="${c.num ? "num" : ""} ${c.wide ? "wide-only" : ""} ${s ? "sorted" : ""} ${s && state.asc ? "asc" : ""}" data-key="${c.key}">${c.label}</th>`;
  }).join("");
  const body = rows.map((e) => `<tr data-type="${type}" data-id="${esc(e.id)}" class="${cur?.id === e.id ? "selected" : ""}">` +
    cols.map((c, i) => {
      let v = c.show ? c.show(e) : valueOf(c, e);
      let extra = "";
      if (i === 0 && tab === "monsters") v = null;
      if (i === 0 && e.boss) extra = ' <span class="badge">Boss</span>';
      if (i === 0 && e.variant) extra = ` <span class="badge">${esc(e.variant)}</span>`;
      if (i === 0 && e.disputed) extra += '<span class="unv" title="Sources disagree; see details">?</span>';
      if (i === 0 && e.region === "Hidden Street") extra = ' <span class="badge hidden">Hidden</span>';
      const cell = i === 0 && tab === "monsters" ? `<span class="spr-cell">${sprite(e, 28)}</span>${esc(e.name)}` : esc(fmt(v));
      return `<td class="${c.num ? "num" : ""} ${c.wide ? "wide-only" : ""}">${cell}${extra}</td>`;
    }).join("") + "</tr>").join("");
  $("#table").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  $("#count").textContent = `${rows.length.toLocaleString()} result${rows.length === 1 ? "" : "s"}`;
  $("#table").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.key;
    state.asc = state.sortKey === k ? !state.asc : true;
    state.sortKey = k;
    renderTable();
  }));
}

// ---------- detail panel + history ----------
function currentEntry() { return state.history[state.pos]; }

function open(type, id, { push = true } = {}) {
  if (!getEntity(type, id)) return;
  if (push) {
    state.history = state.history.slice(0, state.pos + 1);
    state.history.push({ type, id });
    state.pos = state.history.length - 1;
    const h = `#${type}/${encodeURIComponent(id)}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  hideTip();
  renderDetail();
}

function fromHash() {
  const m = location.hash.match(/^#(\w+)\/(.+)$/);
  if (!m) return false;
  const [, type, id] = m;
  const tab = TAB_OF_TYPE[type];
  if (!tab || !getEntity(type, decodeURIComponent(id))) return false;
  if (state.tab !== tab && !(type === "map" && state.tab === "world")) switchTab(tab);
  open(type, decodeURIComponent(id));
  return true;
}

function getEntity(type, id) {
  if (type === "zone") return idx.zones[id] ? { id, name: id } : null;
  const ds = { monster: "monsters", item: "items", map: "maps", job: "jobs", price: "market" }[type];
  return ds ? byId[ds]?.[id] : null;
}

function link(type, id, label) {
  const e = getEntity(type, id);
  if (!e) return esc(label ?? id);
  const tip = type === "monster" ? ` data-tip="1"` : "";
  return `<a href="#${type}/${encodeURIComponent(id)}" data-type="${type}" data-id="${esc(id)}"${tip}>${esc(label ?? e.name)}</a>`;
}

function sprite(mob, h = 32) {
  if (!mob?.sprite) return "";
  return `<img class="sprite" src="assets/mob/${mob.gid}.gif" alt="" loading="lazy" style="max-height:${h}px">`;
}

function levelText(l) { return l ? (l[0] === l[1] ? `${l[0]}` : `${l[0]}–${l[1]}`) : "—"; }
function rateText(r) { return r == null ? "reported" : `${r < 1 ? r.toFixed(2) : r.toFixed(1)}%`; }
function dl(pairs) {
  return `<dl>${pairs.filter(([, v]) => v != null && v !== "").map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

function renderDetail() {
  const panel = $("#detail");
  const cur = currentEntry();
  $("#layout").classList.toggle("with-detail", !!cur);
  highlightZone(cur?.type === "zone" ? cur.id : null);
  if (!cur) { panel.hidden = true; return; }
  panel.hidden = false;
  const nav = `<div class="panel-nav">
      <button id="back" ${state.pos > 0 ? "" : "disabled"}>← Back</button>
      <button id="close" title="Close">✕</button></div>`;
  const body = { zone: zoneDetail, map: mapDetail, monster: monsterDetail, item: itemDetail, job: jobDetail, price: priceDetail }[cur.type](getEntity(cur.type, cur.id));
  panel.innerHTML = nav + body;
  panel.scrollTop = 0;
  $("#back").onclick = () => { if (state.pos > 0) { state.pos--; syncHash(); renderDetail(); } };
  $("#close").onclick = () => { state.history = []; state.pos = -1; history.replaceState(null, "", location.pathname); renderDetail(); renderTable(); };
  if (window.innerWidth < 960) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  renderTable();
}
function syncHash() {
  const c = currentEntry();
  if (c) history.replaceState(null, "", `#${c.type}/${encodeURIComponent(c.id)}`);
}

// zone: list its maps grouped by type
function zoneDetail(z) {
  const s = zoneSummary(z.id);
  const groups = {};
  for (const m of s.maps) {
    const g = m.region === "Hidden Street" ? "Hidden Street" : m.town || m.type === "Town interior" || m.type === "Town" ? "Town" : m.type === "Dungeon" ? "Dungeons" : "Hunting grounds & fields";
    (groups[g] ||= []).push(m);
  }
  const order = ["Hunting grounds & fields", "Dungeons", "Hidden Street", "Town"];
  const out = order.filter((g) => groups[g]).map((g) => {
    const rows = groups[g].sort((a, b) => (a.levels?.[0] ?? 999) - (b.levels?.[0] ?? 999) || a.name.localeCompare(b.name)).map((m) => {
      const total = m.spawns.reduce((a, x) => a + x.count, 0);
      const mobs = m.spawns.map((x) => `${x.count} ${getEntity("monster", x.monster)?.name}`).join(", ");
      return `<a class="maprow" data-type="map" data-id="${esc(m.id)}" href="#map/${encodeURIComponent(m.id)}">
        <span class="top">${esc(m.name)} ${m.region === "Hidden Street" ? '<span class="badge hidden">Hidden</span>' : ""}<span class="right">${m.levels ? "Lv " + levelText(m.levels) : ""}${total ? ` · ${total} mobs` : ""}</span></span>
        ${mobs ? `<span class="mobs">${esc(mobs)}</span>` : ""}</a>`;
    }).join("");
    return `<div class="zone-group"><h4>${g} (${groups[g].length})</h4>${rows}</div>`;
  }).join("");
  return `<h2>${esc(z.id)}</h2><p class="sub">${s.maps.length} maps${s.min != null ? ` · Lv ${s.min}–${s.max}` : ""}</p>${out}`;
}

// map: layout drawing, spawn counts, portals (incl. hidden), NPCs
function mapDetail(m) {
  const colorOf = {};
  m.spawns.forEach((s, i) => { colorOf[s.monster] = MOB_COLORS[i % MOB_COLORS.length]; });
  const total = m.spawns.reduce((a, x) => a + x.count, 0);
  let html = `<h2>${esc(m.name)}</h2><p class="sub">${esc(m.zone)} · ${esc(m.type || m.region)}${m.region === "Hidden Street" ? ' · <span class="badge hidden">Hidden Street</span>' : ""}</p>`;
  html += dl([["Level range", m.levels ? levelText(m.levels) : null], ["Total monsters", total || null]]);
  html += mapLayout(m, colorOf);
  const isHidden = m.region === "Hidden Street";
  if (isHidden) html += howToGetHere(m);

  if (m.spawns.length) {
    html += `<h3>Monsters on this map</h3><ul>` + m.spawns.map((s) => {
      const mob = getEntity("monster", s.monster);
      const resp = m.respawn?.[s.monster];
      return `<li><i class="dot" style="background:${colorOf[s.monster]}"></i><span class="spr-cell">${sprite(mob, 30)}</span>${link("monster", s.monster)}
        ${mob?.boss ? '<span class="badge">Boss</span>' : ""}<span class="right">×${s.count}${resp ? ` · respawn ${Math.round(resp / 60)} min` : ""}</span></li>`;
    }).join("") + `</ul>`;
  }

  const uniq = (arr) => [...new Map(arr.map((p) => [p.to, p])).values()].filter((p) => p.to !== m.id);
  const walk = uniq(m.portals.filter((p) => p.kind !== "hidden"));
  const hidden = uniq(m.portals.filter((p) => p.kind === "hidden"));
  const shown = new Set([...walk, ...hidden].map((p) => p.to));
  const into = [...(idx.incoming[m.id] || [])].filter((id) => !shown.has(id) && id !== m.id);
  const portalLi = (p) => {
    const t = getEntity("map", p.to);
    return `<li>${link("map", p.to)}${t?.region === "Hidden Street" ? ' <span class="badge hidden">Hidden Street</span>' : ""}<span class="right">${t?.levels ? "Lv " + levelText(t.levels) : ""}</span></li>`;
  };
  if (walk.length) html += `<h3>Connected maps</h3><ul>${walk.map(portalLi).join("")}</ul>`;
  if (hidden.length) html += `<h3>Hidden portals</h3><ul>${hidden.map(portalLi).join("")}</ul>`;
  if (into.length) html += `<h3>One-way in from</h3><ul>${into.map((id) => `<li>${link("map", id)}</li>`).join("")}</ul>`;
  if (m.npcs.length) html += `<h3>NPCs</h3><p>${m.npcs.map(esc).join(", ")}</p>`;
  if (!isHidden) html += howToGetHere(m);
  return html;
}

// Draws a map: the real in-game minimap when we have it, with spawn points and
// portals on top. `highlight` = id of a destination map whose portal(s) get circled.
function mapLayout(m, colorOf, { highlight = null, showMobs = true, caption = true } = {}) {
  const pts = [...m.mobpos.map(([, x, y]) => [x, y]), ...m.portals.map((p) => [p.x, p.y])];
  if (!m.minimap && !m.mobpos.length) return ""; // nothing worth drawing (e.g. small interiors)
  let ox, oy, w, h;
  if (m.origin) { [ox, oy] = m.origin; [w, h] = m.size; }
  else {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 150;
    ox = -Math.min(...xs) + pad; oy = -Math.min(...ys) + pad;
    w = Math.max(...xs) - Math.min(...xs) + pad * 2; h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  }
  const r = Math.max(18, Math.min(w, h) / 45);
  const bg = m.minimap
    ? `<image href="assets/minimap/${m.gid}.png" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"></image>`
    : "";
  const mobs = showMobs ? m.mobpos.map(([id, x, y]) => {
    const name = getEntity("monster", id)?.name || id;
    return `<circle class="mob" cx="${x + ox}" cy="${y + oy}" r="${r * 0.8}" fill="${colorOf[id] || "#999"}"><title>${esc(name)}</title></circle>`;
  }).join("") : "";
  // zoom in on the circled portal so it's easy to spot on wide maps (e.g. towns)
  let vb = `0 0 ${w} ${h}`, zoomW = w;
  const target = highlight && m.portals.find((p) => p.to === highlight);
  if (target) {
    const cw = Math.min(w, 1800);
    const ch = Math.min(h, cw * 0.62);
    const tx = target.x + ox, ty = target.y + oy;
    const vx = Math.max(0, Math.min(w - cw, tx - cw / 2));
    const vy = Math.max(0, Math.min(h - ch, ty - ch * 0.6));
    vb = `${vx} ${vy} ${cw} ${ch}`;
    zoomW = cw;
  }
  const seen = new Set();
  let rings = "";
  const portals = m.portals.filter((p) => { const k = `${p.to}|${p.x}|${p.y}`; if (seen.has(k) || p.to === m.id) return false; seen.add(k); return true; }).map((p) => {
    const t = getEntity("map", p.to);
    const s = r * 1.3, cx = p.x + ox, cy = p.y + oy;
    const hidden = p.kind === "hidden";
    if (p.to === highlight || (!highlight && hidden)) {
      const isT = p.to === highlight;
      const R = isT ? zoomW * 0.09 : Math.max(r * 4.5, Math.min(w, h) / 9);
      const sw = isT ? zoomW * 0.016 : Math.max(8, w * 0.004);
      if (isT) rings += `<circle class="ring halo" cx="${cx}" cy="${cy - s * 0.4}" r="${R}" style="stroke-width:${sw * 1.9}px"></circle>`;
      rings += `<circle class="ring ${isT ? "target" : ""}" cx="${cx}" cy="${cy - s * 0.4}" r="${R}" style="stroke-width:${sw}px"></circle>`;
    }
    return `<rect class="portal ${hidden ? "hidden-p" : ""}" x="${cx - s}" y="${cy - s * 1.6}" width="${s * 2}" height="${s * 2.4}" rx="${s}" data-type="map" data-id="${esc(p.to)}"><title>${hidden ? "Hidden portal" : "Portal"} → ${esc(t?.name || p.to)}</title></rect>`;
  }).join("");
  const cap = caption
    ? `<p class="sub" style="margin-top:6px">${m.minimap ? "In-game minimap" : "Layout from the game data"}. <span style="color:var(--accent)">■</span> portal · <span style="color:var(--hidden)">■</span> hidden portal (circled) · click a portal to go there${showMobs ? " · dots = spawn points" : ""}</p>`
    : "";
  return `<svg class="layout-svg ${m.minimap ? "has-img" : ""}" viewBox="${vb}" role="img" aria-label="${esc(m.name)} map">${bg}${mobs}${rings}${portals}</svg>${cap}`;
}

// "How to get here": the neighbouring maps, with the portal that leads here circled.
function howToGetHere(m) {
  const from = [...(idx.incoming[m.id] || [])].filter((id) => id !== m.id).map((id) => getEntity("map", id));
  if (!from.length) return "";
  // prefer the maps where the way in is a hidden portal, then towns/fields with a drawable minimap
  from.sort((a, b) => {
    const ha = a.portals.some((p) => p.to === m.id && p.kind === "hidden") ? 0 : 1;
    const hb = b.portals.some((p) => p.to === m.id && p.kind === "hidden") ? 0 : 1;
    return ha - hb || (b.minimap ? 1 : 0) - (a.minimap ? 1 : 0);
  });
  const shown = from.slice(0, 3);
  const cards = shown.map((src) => {
    const p = src.portals.find((x) => x.to === m.id);
    const how = p?.kind === "hidden" ? "the hidden portal" : "the portal";
    return `<div class="howto"><p>From ${link("map", src.id)}, take ${how} circled below${src.zone !== m.zone ? ` (${esc(src.zone)})` : ""}.</p>
      ${mapLayout(src, {}, { highlight: m.id, showMobs: false, caption: false })}</div>`;
  }).join("");
  const more = from.length > shown.length ? `<p class="sub">Also reachable from ${from.slice(shown.length).map((x) => link("map", x.id)).join(", ")}.</p>` : "";
  return `<h3>How to get here</h3>${cards}${more}`;
}

function monsterDetail(mob) {
  let html = `${mob.sprite ? `<div class="hero">${sprite(mob, 120)}</div>` : ""}<h2>${esc(mob.name)} ${mob.boss ? '<span class="badge">Boss</span>' : ""}</h2>
    <p class="sub">Monster${mob.variant ? ` · ${esc(mob.variant)}` : ""}</p>`;
  html += dl([
    ["Level", fmt(mob.level)], ["HP", fmt(mob.hp) + (mob.disputed?.hp ? '<span class="unv">?</span>' : "")], ["EXP", fmt(mob.exp)],
    ["Attack", fmt(mob.atk)], ["Magic attack", mob.matk ? fmt(mob.matk) : null],
    ["Weapon / magic DEF", `${fmt(mob.wdef)} / ${fmt(mob.mdef)}`], ["Accuracy", fmt(mob.acc)], ["Avoid", fmt(mob.avoid)],
    ["Weak to", esc(mob.weak)], ["Resists", esc(mob.resist)], ["Undead", mob.undead ? "Yes" : null],
    ["Mesos", mob.meso ? `${fmt(mob.meso.min)}–${fmt(mob.meso.max)}${mob.meso.basis === "reported" ? " (player-reported)" : ""}` : null],
  ]);
  if (mob.disputed?.hp) {
    html += `<div class="note">HP is ${fmt(mob.hp)} per ${mob.sources.join(" and ")}. The ${esc(mob.disputed.hp.source)} show ${fmt(mob.disputed.hp.value)}, which may be from before a patch.</div>`;
  }
  html += `<h3>Drop table (${mob.drops.length})</h3>`;
  if (mob.drops.length) {
    const kills = mob.drops.find((d) => d.kills)?.kills;
    html += `<table class="drops"><tbody>${mob.drops.map((d) => {
      const it = getEntity("item", d.item);
      const pr = it && priceOf(it.name);
      return `<tr><td>${link("item", d.item)}${it?.type ? ` <span class="sub">${esc(it.type)}</span>` : ""}</td><td class="num price-cell">${pr ? `≈${meso(pr.typ)}` : ""}</td><td class="num">${rateText(d.rate)}</td></tr>`;
    }).join("")}</tbody></table>`;
    html += `<p class="sub" style="margin-top:6px">${kills ? `Rates counted in Classic World over ${kills.toLocaleString()} kills.` : "Drops reported by Classic players; no rate counted yet."}</p>`;
  } else {
    html += `<p class="sub">No Classic drops reported yet.</p>`;
  }
  const where = idx.spawnsOf[mob.id] || [];
  html += `<h3>Found in (${where.length})</h3>`;
  html += where.length
    ? `<ul>${where.map((w) => `<li>${link("map", w.map)}<span class="right">×${w.count}</span></li>`).join("")}</ul>`
    : `<p class="sub">Doesn't spawn on any regular map.</p>`;
  html += `<p class="sub" style="margin-top:12px">Stats confirmed by: ${mob.sources.map(esc).join(", ")}</p>`;
  return html;
}

function itemDetail(it) {
  let html = `<h2>${esc(it.name)}</h2><p class="sub">${esc([it.type, it.category].filter(Boolean).join(" · ") || "Item")}</p>`;
  const stats = it.stats ? Object.entries(it.stats).map(([k, v]) => `${esc(k)} ${v > 0 ? "+" : ""}${v}`).join(", ") : null;
  html += dl([["Req. level", it.level], ["Effect", esc(it.effect)], ["Stats", stats], ["Shop price", it.shop_price ? fmt(it.shop_price) + " mesos" : null], ["Sells to NPC for", it.sell ? fmt(it.sell) + " mesos" : null]]);
  const pr = priceOf(it.name);
  if (pr) {
    html += `<h3>Free Market price</h3>${priceSummary(pr)}<p>${link("price", pr.id, "Full price details, stat rolls & sellers →")}</p>`;
  } else if (db.market && !db.marketError) {
    html += `<h3>Free Market price</h3><p class="sub">No recent sales tracked. ${cozyButton()}</p>`;
  }
  const by = idx.droppedBy[it.id] || [];
  html += `<h3>Dropped by (${by.length})</h3>`;
  html += by.length
    ? `<ul>${by.map((d) => `<li><span class="spr-cell">${sprite(getEntity("monster", d.monster), 26)}</span>${link("monster", d.monster)}<span class="right">Lv ${getEntity("monster", d.monster)?.level} · ${rateText(d.rate)}</span></li>`).join("")}</ul>`
    : `<p class="sub">No Classic drop reported.</p>`;
  return html;
}

function jobDetail(j) {
  let html = `<h2>${esc(j.name)}</h2><p class="sub">${esc(j.branch)}</p>`;
  html += dl([["Advancement", j.advancement ? `${j.advancement}${["", "st", "nd", "rd"][j.advancement] || "th"} job` : "None"], ["Req. level", j.level], ["Instructor", esc(j.instructor)], ["Location", esc(j.location)], ["Main stat", esc(j.stat)]]);
  if (j.from) html += `<h3>Advances from</h3><ul><li>${link("job", j.from)}</li></ul>`;
  const next = db.jobs.filter((x) => x.from === j.id);
  if (next.length) html += `<h3>Advances to</h3><ul>${next.map((x) => `<li>${link("job", x.id)}<span class="right">Lv ${x.level}</span></li>`).join("")}</ul>`;
  if (j.notes) html += `<div class="note">${esc(j.notes)}</div>`;
  return html;
}

// ---------- Free Market prices ----------
function cozyButton(label = "Find live shops on Cozy Market ↗") {
  return `<a class="btn" href="${COZY_URL}" target="_blank" rel="noopener">${label}</a>`;
}

function sparkline(daily) {
  if (daily.length < 2) return "";
  const W = 320, H = 70, P = 6;
  const ys = daily.map((d) => d[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  const x = (i) => P + (i * (W - 2 * P)) / (daily.length - 1);
  const y = (v) => (max === min ? H / 2 : H - P - ((v - min) * (H - 2 * P)) / (max - min));
  const pts = daily.map((d, i) => `${x(i).toFixed(1)},${y(d[1]).toFixed(1)}`).join(" ");
  const day = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price over the last ${daily.length} days">
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"></polyline>
      ${daily.map((d, i) => `<circle cx="${x(i)}" cy="${y(d[1])}" r="3" fill="var(--accent)"><title>${day(d[0])}: ${meso(d[1])}</title></circle>`).join("")}
    </svg><div class="spark-axis"><span>${day(daily[0][0])}</span><span>low ${meso(min)} · high ${meso(max)}</span><span>${day(daily[daily.length - 1][0])}</span></div>`;
}

function priceSummary(p) {
  const basis = p.basis === "sale" ? "typical sold price" : "typical asking price (few sales yet)";
  return `<div class="price-big">${meso(p.typ)} <span>mesos</span></div>
    <p class="sub">${basis} · usual range ${meso(p.lo)}–${meso(p.hi)} · ${p.sales.toLocaleString()} sales tracked</p>`;
}

function priceDetail(p) {
  const conf = { verified: "Verified by repeated sales", lead: "Based on a few sales or listings", watched: "Being watched (prices moving)" }[p.conf] || p.conf;
  const ourItem = byId.items[p.id];
  let html = `<h2>${esc(p.name)}</h2><p class="sub">${esc(p.cat)} · Free Market</p>${priceSummary(p)}`;
  html += `<p>${cozyButton()} <a class="btn ghost" href="${CLUBFM_URL}" target="_blank" rel="noopener">Club FM ↗</a></p>`;
  if (p.daily.length > 1) html += `<h3>Last ${p.daily.length} days ${p.change != null ? `<span class="${p.change >= 0 ? "up" : "down"}">${pct(p.change)}</span>` : ""}</h3>${sparkline(p.daily)}`;
  html += dl([["Confidence", esc(conf)], ["Listings seen", p.listings.toLocaleString()]]);
  if (p.ladder?.length) {
    for (const [stat, rows] of p.ladder) {
      html += `<h3>Price by ${esc(stat)} roll</h3><table class="drops ladder"><tbody>${rows.map(([label, status, lo, hi, typ, sold, listed]) => `
        <tr><td>${esc(label)}</td><td class="num">${typ ? meso(typ) : lo === hi ? meso(lo) : `${meso(lo)}–${meso(hi)}`}</td>
        <td class="num sub">${status === "sold" ? `${sold} sold` : status === "asking" ? "asking" : "few sales"}</td></tr>`).join("")}</tbody></table>`;
    }
  }
  if (p.sellers.length) {
    html += `<h3>Shops selling near this price</h3>
      <p class="sellers">${p.sellers.map((n) => `<span class="seller">${esc(n)}</span>`).join("")}</p>
      <p class="sub">Character names whose shops sold or listed this item close to the typical price. Look for them in the Free Market, or check ${cozyButton("Cozy Market ↗").replace('class="btn"', 'class="inline"')} for their current channel and room.</p>`;
  }
  if (ourItem) html += `<h3>In the database</h3><p>${link("item", ourItem.id, `${ourItem.name}: stats and who drops it →`)}</p>`;
  return html;
}

// ---------- monster hover tooltip ----------
function onHover(e) {
  const a = e.target.closest?.("[data-tip]");
  if (!a) return;
  const mob = getEntity("monster", a.dataset.id);
  if (!mob) return;
  const tip = $("#tooltip");
  const top = mob.drops.slice(0, 6).map((d) => `<div class="row"><span>${esc(getEntity("item", d.item)?.name || d.item)}</span><span>${rateText(d.rate)}</span></div>`).join("");
  tip.innerHTML = `${sprite(mob, 56)}<strong>${esc(mob.name)}</strong><div class="t-sub">Lv ${mob.level} · ${fmt(mob.hp)} HP · ${fmt(mob.exp)} EXP</div>` +
    (top ? `${top}${mob.drops.length > 6 ? `<div class="t-sub" style="margin:4px 0 0">+${mob.drops.length - 6} more · click for full table</div>` : ""}` : `<div class="t-sub">No Classic drops reported yet.</div>`);
  tip.hidden = false;
  const r = a.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.left, y = r.bottom + 6;
  if (x + tw > innerWidth - 8) x = innerWidth - tw - 8;
  if (y + th > innerHeight - 8) y = r.top - th - 6;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hideTip() { $("#tooltip").hidden = true; }

load().catch((err) => {
  $("#worldView").innerHTML = `<p style="padding:16px">Couldn't load data (${esc(err.message)}). If you opened the file directly, run <code>python3 -m http.server</code> in this folder instead.</p>`;
});
