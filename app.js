// MapleStory Classic DB: interactive world map, searchable tables and a
// cross-linked detail panel. Data lives in data/*.json (built by tools/build_data.py).

const DATASETS = ["monsters", "items", "maps", "jobs", "npcs", "quests", "meta"];
const OPTIONAL = ["log", "patches", "skills"]; // fine if missing
const db = {};
const byId = {};
const idx = { spawnsOf: {}, droppedBy: {}, incoming: {}, zones: {}, priceByName: {}, qGiver: {}, qEnder: {}, qNext: {}, qNeedItem: {}, qRewardItem: {}, qKill: {} };

// Free Market prices: Club FM's public daily summary, loaded live from GitHub.
const MARKET_URL = "https://raw.githubusercontent.com/maplefm/maplefm.github.io/live/data/summary-public.json";
const COZY_URL = "https://cozy.markets/market";
const CLUBFM_URL = "https://maplefm.gg";
const HENEFM_URL = "https://henefm.com";
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

// ---------- world map layout (positions on assets/world-map.webp, not to scale) ----------
const ZONES = {
  "Mushroom Town": { x: 75, y: 105 },
  "Amherst": { x: 195, y: 55 },
  "Southperry": { x: 225, y: 160 },
  "Ellinia": { x: 470, y: 110 },
  "Perion": { x: 815, y: 135 },
  "Sleepywood": { x: 665, y: 270 },
  "Henesys": { x: 270, y: 335 },
  "Kerning City": { x: 850, y: 365 },
  "Lith Harbor": { x: 340, y: 480 },
  "Free Market": { x: 590, y: 480 },
  "Kerning City PQ": { x: 860, y: 495 },
  "Florina Beach": { x: 85, y: 520 },
  "Other": { x: 925, y: 590 },
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
  quests: [
    { key: "_done", label: "✓", get: (q) => (isDone(q.id) ? 1 : 0), show: (q) => `<input type="checkbox" class="qdone" data-q="${q.id}" ${isDone(q.id) ? "checked" : ""} aria-label="Mark done">`, html: true },
    { key: "name", label: "Quest" },
    { key: "level", label: "Lv", num: true },
    { key: "area", label: "Area", wide: true },
    { key: "giver_name", label: "Start with", wide: true },
    { key: "exp", label: "EXP", num: true },
  ],
  npcs: [
    { key: "name", label: "NPC" },
    { key: "role", label: "Role", wide: true },
    { key: "_where", label: "Where", get: (n) => npcWhere(n) },
    { key: "_q", label: "Quests", num: true, get: (n) => (idx.qGiver[n.id] || []).length },
  ],
  jobs: [
    { key: "name", label: "Name" },
    { key: "branch", label: "Branch" },
    { key: "advancement", label: "Adv", num: true },
    { key: "level", label: "Req Lv", num: true },
  ],
};
const TYPE_OF_TAB = { monsters: "monster", items: "item", maps: "map", jobs: "job", market: "price", quests: "quest", npcs: "npc" };
const TAB_OF_TYPE = { monster: "monsters", item: "items", map: "maps", job: "jobs", zone: "world", price: "market", quest: "quests", npc: "npcs" };

const state = { tab: "world", sortKey: "level", asc: true, history: [], pos: -1, zone: null };

// ---------- load + index ----------
async function load() {
  await Promise.all(OPTIONAL.map(async (name) => {
    try { const r = await fetch(`data/${name}.json`, { cache: "no-cache" }); db[name] = r.ok ? await r.json() : []; } catch { db[name] = []; }
  }));
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
  const push = (o, k, v) => (o[k] ||= []).includes(v) || o[k].push(v);
  for (const q of db.quests) {
    if (q.giver) push(idx.qGiver, q.giver, q.id);
    if (q.ender && q.ender !== q.giver) push(idx.qEnder, q.ender, q.id);
    for (const pre of q.pre) push(idx.qNext, pre, q.id);
    for (const x of q.need) push(idx.qNeedItem, x.item, q.id);
    for (const x of [...q.rewards, ...q.choice]) push(idx.qRewardItem, x.item, q.id);
    for (const k of q.kill) push(idx.qKill, k.monster, q.id);
  }
  for (const mob of db.monsters)
    for (const d of mob.drops) (idx.droppedBy[d.item] ||= []).push({ monster: mob.id, rate: d.rate, kills: d.kills });
  for (const list of Object.values(idx.droppedBy)) list.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  for (const list of Object.values(idx.spawnsOf)) list.sort((a, b) => b.count - a.count);
  if (db.meta?.built_from) $("#builtFrom").textContent = `Data: ${db.meta.built_from}.`;

  if (typeof buildSkills === "function") buildSkills();
  bind();
  renderWorld();
  renderCharChip();
  $("#charChip").addEventListener("click", () => switchTab("calc"));
  if (typeof readSharedBuild === "function" && readSharedBuild()) switchTab("calc");
  else fromHash() || switchTab("world");
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
// ---------- quest tracker (saved in this browser only) ----------
// ---------- saved characters (stats + quest progress, kept in this browser) ----------
const CHAR_KEY = "msclassicdb.characters";
const DONE_KEY = "msclassicdb.questsDone"; // older single-character storage, migrated below
function loadChars() {
  try {
    const c = JSON.parse(localStorage.getItem(CHAR_KEY) || "null");
    if (c && Array.isArray(c.list) && c.list.length) return c;
  } catch { /* storage unavailable */ }
  let oldCalc = {}, oldDone = [];
  try { oldCalc = JSON.parse(localStorage.getItem("msclassicdb.calc") || "{}"); } catch { /* ignore */ }
  try { oldDone = JSON.parse(localStorage.getItem(DONE_KEY) || "[]"); } catch { /* ignore */ }
  return { active: "c1", list: [{ id: "c1", name: "My character", calc: oldCalc, done: oldDone }] };
}
let chars = loadChars();
function activeChar() { return chars.list.find((c) => c.id === chars.active) || chars.list[0]; }
let doneSet = new Set(activeChar().done || []);
function saveChars() {
  try { localStorage.setItem(CHAR_KEY, JSON.stringify(chars)); } catch { /* storage unavailable */ }
  renderCharChip();
}
function isDone(id) { return doneSet.has(id); }
function setDone(id, on) {
  on ? doneSet.add(id) : doneSet.delete(id);
  activeChar().done = [...doneSet];
  saveChars();
}
function switchCharacter(id) {
  chars.active = id;
  doneSet = new Set(activeChar().done || []);
  saveChars();
  if (typeof loadCalcFromChar === "function") loadCalcFromChar();
  if (state.tab === "skills") renderSkillsTab();
}
function charSummary(c) {
  const k = c.calc || {};
  return `${k.level ? `Lv ${k.level} ` : ""}${k.cls || ""}`.trim();
}
function renderCharChip() {
  const chip = $("#charChip");
  if (!chip) return;
  const c = activeChar();
  chip.innerHTML = `<span aria-hidden="true">👤</span><b>${esc(c.name)}</b><span>${esc(charSummary(c))}</span>`;
}
function npcWhere(n) {
  if (!n.locations.length) return "—";
  const m = getEntity("map", n.locations[0].map);
  const extra = n.locations.length > 1 ? ` +${n.locations.length - 1}` : "";
  return `${m?.zone && m.zone !== m.name ? m.zone + ": " : ""}${m?.name || n.locations[0].map}${extra}`;
}

function priceOf(name) { return idx.priceByName[String(name).toLowerCase()]; }

function bind() {
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  ["#search", "#minLv", "#maxLv", "#variants", "#cat", "#qarea", "#hideDone", "#myLevel"].forEach((s) => $(s).addEventListener("input", renderTable));
  const areas = [...new Set(db.quests.map((q) => q.area))].sort();
  $("#qarea").innerHTML = `<option value="">All areas</option>` + areas.map((a) => `<option>${esc(a)}</option>`).join("");
  document.addEventListener("click", onLinkClick);
  document.addEventListener("mouseover", onHover);
  document.addEventListener("mouseout", (e) => { if (e.target.closest?.("[data-tip]")) hideTip(); });
}

function onLinkClick(e) {
  const box = e.target.closest?.(".qdone");
  if (box) {
    e.stopPropagation();
    setDone(box.dataset.q, box.checked);
    if (state.tab === "quests") renderTable();
    if (currentEntry()?.type === "quest") renderDetail();
    return;
  }
  const a = e.target.closest("[data-type][data-id]");
  if (!a) return;
  e.preventDefault();
  open(a.dataset.type, a.dataset.id);
}

// ---------- tabs ----------
const FEED_TABS = ["patches", "log"];
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.scrollIntoView({ block: "nearest", inline: "center" });
  });
  const isWorld = tab === "world";
  const isFeed = FEED_TABS.includes(tab);
  const isCalc = tab === "calc";
  const isSkills = tab === "skills";
  $("#skillsView").hidden = !isSkills;
  $("#worldView").hidden = !isWorld;
  $("#tableWrap").hidden = isWorld || isFeed || isCalc || isSkills;
  $("#feedView").hidden = !isFeed;
  $("#calcView").hidden = !isCalc;
  $("#controls").hidden = isWorld || isCalc || isSkills;
  if (isCalc) { renderCalc(); return; }
  if (isSkills) { renderSkillsTab(); return; }
  if (isFeed) {
    ["#variantsWrap", "#catWrap", "#marketBar", "#qareaWrap", "#hideDoneWrap"].forEach((x) => { $(x).hidden = true; });
    document.querySelectorAll(".lvctl").forEach((el) => { el.hidden = true; });
    $("#search").value = "";
    renderFeed();
    return;
  }
  $("#variantsWrap").hidden = tab !== "monsters";
  const isMarket = tab === "market";
  $("#catWrap").hidden = !isMarket;
  $("#marketBar").hidden = !isMarket;
  document.querySelectorAll(".lvctl").forEach((el) => { el.hidden = isMarket || tab === "npcs"; });
  $("#qareaWrap").hidden = tab !== "quests";
  $("#hideDoneWrap").hidden = tab !== "quests";
  $("#myLevelWrap").hidden = tab !== "quests";
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
    `<span><i class="dot" style="background:${TOWN_COLOR}"></i>Town / no monsters</span><span>Color = typical training level · number = maps in area · dashed line = boat</span><span>AI-illustrated fan art (ChatGPT), not an official map and not to scale</span>`;
  $("#worldView").innerHTML = `
    <svg viewBox="0 0 1000 667" role="img" aria-label="World map of Maple Island and Victoria Island">
      <image href="assets/world-map.webp" width="1000" height="667"></image>
      <text class="island-label" x="14" y="26">Maple Island</text>
      <text class="island-label" x="420" y="640">Victoria Island</text>
      ${boats}${nodes}
    </svg>
    <div class="legend">${legend}</div>
    <div class="zone-chips">${Object.keys(ZONES).filter((z) => idx.zones[z]).map((z) => {
      const s = zoneSummary(z);
      const color = s.mobs && s.typical != null ? bandColor(s.typical) : TOWN_COLOR;
      return `<button type="button" class="zone-chip" data-type="zone" data-id="${esc(z)}"><i class="dot" style="background:${color}"></i><b>${esc(z)}</b><span>${s.min != null ? `Lv ${s.min}–${s.max}` : "Town"} · ${s.maps.length} maps</span></button>`;
    }).join("")}</div>`;
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
    if (tab === "npcs") return true;
    if (tab === "quests") {
      if ($("#qarea").value && e.area !== $("#qarea").value) return false;
      if ($("#myLevel").checked) {
        const k = activeChar().calc || {};
        const lv = k.level || 1;
        if (e.level > lv || (e.max_level && e.max_level < lv)) return false;
        if (e.jobs && k.cls && lv >= 10 && !e.jobs.includes(k.cls)) return false;
      }
      if ($("#hideDone").checked && isDone(e.id)) return false;
    }
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
  if (tab === "world" || tab === "calc" || tab === "skills") return;
  if (FEED_TABS.includes(tab)) return renderFeed();
  if (tab === "market" && (!db.market || db.marketError)) {
    $("#table").innerHTML = `<tbody><tr><td style="padding:20px;white-space:normal">${db.marketError
      ? `Couldn't load Free Market prices right now (${esc(db.marketError)}). You can still check <a href="${COZY_URL}" target="_blank" rel="noopener">Cozy Market</a> or <a href="${HENEFM_URL}" target="_blank" rel="noopener">HeneFM</a>.`
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
      if (i === 0 && e.previous) extra += ' <span class="badge" title="Changed by a patch">Patched</span>';
      if (i === 0 && e.region === "Hidden Street") extra = ' <span class="badge hidden">Hidden</span>';
      const cell = c.html ? v : i === 0 && tab === "monsters" ? `<span class="spr-cell">${sprite(e, 28)}</span>${esc(e.name)}` : esc(fmt(v));
      return `<td class="${c.num ? "num" : ""} ${c.wide ? "wide-only" : ""}">${cell}${extra}</td>`;
    }).join("") + "</tr>").join("");
  $("#table").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  $("#count").textContent = `${rows.length.toLocaleString()} result${rows.length === 1 ? "" : "s"}` +
    (tab === "quests" ? ` · ${db.quests.filter((q) => isDone(q.id)).length} of ${db.quests.length} done by ${activeChar().name}` : "");
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
    if (location.hash !== h) history.pushState({ pos: state.pos }, "", h);
  }
  hideTip();
  renderDetail();
}

const isPhone = () => window.matchMedia("(max-width: 959px)").matches;

function closeDetail() {
  state.history = []; state.pos = -1;
  history.replaceState(null, "", location.pathname + location.search);
  renderDetail(); renderTable();
}

// Browser/phone back button: step back through the panel, then close it.
window.addEventListener("popstate", () => {
  const m = location.hash.match(/^#(\w+)\/(.+)$/);
  if (!m) { state.history = []; state.pos = -1; renderDetail(); renderTable(); return; }
  const type = m[1], id = decodeURIComponent(m[2]);
  const prev = state.history[state.pos - 1];
  if (prev && prev.type === type && prev.id === id) { state.pos--; renderDetail(); return; }
  if (!getEntity(type, id)) return;
  state.history = [{ type, id }]; state.pos = 0; renderDetail();
});

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
  const ds = { monster: "monsters", item: "items", map: "maps", job: "jobs", price: "market", quest: "quests", npc: "npcs" }[type];
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
  const wasOpen = document.body.classList.contains("sheet-open");
  const phoneOpen = !!cur && isPhone();
  if (phoneOpen && !wasOpen) state.listScroll = window.scrollY;   // remember where the list was
  document.body.classList.toggle("sheet-open", phoneOpen);
  if (!cur) {
    panel.hidden = true;
    if (wasOpen) requestAnimationFrame(() => window.scrollTo(0, state.listScroll || 0));
    return;
  }
  panel.hidden = false;
  const nav = `<div class="panel-nav">
      <button id="back" ${state.pos > 0 ? "" : "disabled"}>← Back</button>
      <span class="panel-title">${esc(getEntity(cur.type, cur.id)?.name || "")}</span>
      <button id="close" title="Close" aria-label="Close">✕</button></div>`;
  const body = { zone: zoneDetail, map: mapDetail, monster: monsterDetail, item: itemDetail, job: jobDetail, price: priceDetail, quest: questDetail, npc: npcDetail }[cur.type](getEntity(cur.type, cur.id));
  panel.innerHTML = nav + body;
  panel.scrollTop = 0;
  if (phoneOpen) window.scrollTo(0, 0);
  $("#back").onclick = () => { if (state.pos > 0) history.back(); };
  $("#close").onclick = closeDetail;
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
  html += dl([["Level range", m.levels ? levelText(m.levels) + (m.levels_from_mobs ? ' <span class="sub">(from its monsters)</span>' : "") : null], ["Total monsters", total || null]]);
  const walkIn = [...(idx.incoming[m.id] || [])].some((id) => id !== m.id);
  if (!walkIn) {
    const npcIds = m.npcs.map((n) => n.npc).join(" ");
    const how = /2nd_job_test/.test(npcIds)
      ? "This is a 2nd job test map. Your job instructor sends you here during the 2nd job advancement at level 30."
      : /^1st Accompaniment/.test(m.name)
        ? `This is a Kerning City Party Quest stage. You enter it with a party through ${getEntity("npc", "lakelis") ? link("npc", "lakelis") : "Lakelis"} in Kerning City.`
        : "No walking portal leads here. You get in through an NPC or a quest.";
    html += `<div class="note">${how}</div>`;
  }
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
  if (m.npcs.length) html += `<h3>NPCs</h3><ul>${m.npcs.map((n) => {
    const e = getEntity("npc", n.npc);
    const qn = (idx.qGiver[n.npc] || []).length;
    return `<li><i class="npc-dot"></i>${link("npc", n.npc)}<span class="right">${esc(e?.role || "")}${qn ? `${e?.role ? " · " : ""}${qn} quest${qn > 1 ? "s" : ""}` : ""}</span></li>`;
  }).join("")}</ul>`;
  if (!isHidden) html += howToGetHere(m);
  return html;
}

// Draws a map: the real in-game minimap when we have it, with spawn points and
// portals on top. `highlight` = id of a destination map whose portal(s) get circled.
function mapLayout(m, colorOf, { highlight = null, point = null, showMobs = true, showNpcs = true, caption = true } = {}) {
  const pts = [...m.mobpos.map(([, x, y]) => [x, y]), ...m.portals.map((p) => [p.x, p.y]), ...m.npcs.map((n) => [n.x, n.y])];
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
    ? `<image href="assets/minimap-hd/${m.gid}.webp" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"></image>`
    : "";
  const mobs = showMobs ? m.mobpos.map(([id, x, y]) => {
    const name = getEntity("monster", id)?.name || id;
    return `<circle class="mob" cx="${x + ox}" cy="${y + oy}" r="${r * 0.8}" fill="${colorOf[id] || "#999"}"><title>${esc(name)}</title></circle>`;
  }).join("") : "";
  // zoom in on the circled portal so it's easy to spot on wide maps (e.g. towns)
  let vb = `0 0 ${w} ${h}`, zoomW = w;
  const target = point || (highlight && m.portals.find((p) => p.to === highlight));
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
    if (p.to === highlight || (!highlight && !point && hidden)) {
      const isT = p.to === highlight;
      const R = isT ? zoomW * 0.09 : Math.max(r * 4.5, Math.min(w, h) / 9);
      const sw = isT ? zoomW * 0.016 : Math.max(8, w * 0.004);
      if (isT) rings += `<circle class="ring halo" cx="${cx}" cy="${cy - s * 0.4}" r="${R}" style="stroke-width:${sw * 1.9}px"></circle>`;
      rings += `<circle class="ring ${isT ? "target" : ""}" cx="${cx}" cy="${cy - s * 0.4}" r="${R}" style="stroke-width:${sw}px"></circle>`;
    }
    return `<rect class="portal ${hidden ? "hidden-p" : ""}" x="${cx - s}" y="${cy - s * 1.6}" width="${s * 2}" height="${s * 2.4}" rx="${s}" data-type="map" data-id="${esc(p.to)}"><title>${hidden ? "Hidden portal" : "Portal"} → ${esc(t?.name || p.to)}</title></rect>`;
  }).join("");
  const d = r * 1.1;
  const npcs = showNpcs || point ? m.npcs.map((n) => {
    const e = getEntity("npc", n.npc);
    const cx = n.x + ox, cy = n.y + oy - d;
    return `<path class="npc-mark" d="M${cx},${cy - d} L${cx + d},${cy} L${cx},${cy + d} L${cx - d},${cy} Z" data-type="npc" data-id="${esc(n.npc)}"><title>${esc(e?.name || n.npc)}</title></path>`;
  }).join("") : "";
  if (point) {
    const R = zoomW * 0.09, sw = zoomW * 0.016;
    rings += `<circle class="ring halo" cx="${point.x + ox}" cy="${point.y + oy - d}" r="${R}" style="stroke-width:${sw * 1.9}px"></circle>
      <circle class="ring target" cx="${point.x + ox}" cy="${point.y + oy - d}" r="${R}" style="stroke-width:${sw}px"></circle>`;
  }
  const cap = caption
    ? `<p class="sub" style="margin-top:6px">${m.minimap ? "In-game minimap, sharpened" : "Layout from the game data"}. <span style="color:var(--accent)">■</span> portal · <span style="color:var(--hidden)">■</span> hidden portal (circled) · <span style="color:var(--npc)">◆</span> NPC · click any marker${showMobs ? " · dots = spawn points" : ""}</p>`
    : "";
  return `<svg class="layout-svg ${m.minimap ? "has-img" : ""}" viewBox="${vb}" role="img" aria-label="${esc(m.name)} map">${bg}${mobs}${rings}${portals}${npcs}</svg>${cap}`;
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
      ${mapLayout(src, {}, { highlight: m.id, showMobs: false, showNpcs: false, caption: false })}</div>`;
  }).join("");
  const more = from.length > shown.length ? `<p class="sub">Also reachable from ${from.slice(shown.length).map((x) => link("map", x.id)).join(", ")}.</p>` : "";
  return `<h3>How to get here</h3>${cards}${more}`;
}

function monsterDetail(mob) {
  let html = `${mob.sprite ? `<div class="hero">${sprite(mob, 120)}</div>` : ""}<h2>${esc(mob.name)} ${mob.boss ? '<span class="badge">Boss</span>' : ""}</h2>
    <p class="sub">Monster${mob.variant ? ` · ${esc(mob.variant)}` : ""}</p>`;
  html += dl([
    ["Level", fmt(mob.level)], ["HP", fmt(mob.hp)], ["EXP", fmt(mob.exp)],
    ["Attack", fmt(mob.atk)], ["Magic attack", mob.matk ? fmt(mob.matk) : null],
    ["Weapon / magic DEF", `${fmt(mob.wdef)} / ${fmt(mob.mdef)}`], ["Accuracy", fmt(mob.acc)], ["Avoid", fmt(mob.avoid)],
    ["Weak to", esc(mob.weak)], ["Resists", esc(mob.resist)], ["Undead", mob.undead ? "Yes" : null],
    ["Mesos", mob.meso ? `${fmt(mob.meso.min)}–${fmt(mob.meso.max)}${mob.meso.basis === "reported" ? " (player-reported)" : ""}` : null],
  ]);
  if (mob.previous?.hp) {
    html += `<div class="note">HP was lowered from ${fmt(mob.previous.hp)} to ${fmt(mob.hp)} in the ${esc(mob.previous.until)}. Some sites still show the old number.</div>`;
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
  html += questList("Quests that hunt it", idx.qKill[mob.id]);
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
    html += `<h3>Free Market price</h3>${priceSummary(pr)}<p>${link("price", pr.id, "Full price details, stat rolls & sellers →")}</p><p>${heneButton(it.name)}</p>`;
  } else if (db.market && !db.marketError) {
    html += `<h3>Free Market price</h3><p class="sub">No recent sales tracked. ${cozyButton()} ${heneButton(it.name)}</p>`;
  }
  html += questList("Needed for quests", idx.qNeedItem[it.id]);
  html += questList("Quest reward from", idx.qRewardItem[it.id]);
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

// ---------- Patches & Log ----------
const LOG_ICONS = { drop_new: "🎁", drop_removed: "✖️", monster_new: "👾", monster_changed: "📊", map_new: "🗺️", quest_new: "📜", quest_removed: "⏹️", npc_new: "🧑", note: "📣" };
const CAT_LABEL = { maintenance: "Maintenance / patch", sale: "Cash Shop", events: "Event", general: "News", update: "Update", community: "Community" };
const niceDate = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

function logText(e) {
  const mob = e.monster && getEntity("monster", e.monster);
  const item = e.item && getEntity("item", e.item);
  switch (e.type) {
    case "drop_new": if (mob && item) return `${link("monster", e.monster)} now drops ${link("item", e.item)}${e.rate != null ? ` <span class="sub">(${rateText(e.rate)})</span>` : " <span class=\"sub\">(player-reported)</span>"}`; break;
    case "drop_removed": if (mob) return `${link("monster", e.monster)} no longer listed as dropping ${item ? link("item", e.item) : esc(e.item)}`; break;
    case "monster_changed": if (mob) return `${link("monster", e.monster)}: ${esc(String(e.field).toUpperCase())} ${fmt(e.old)} → <b>${fmt(e.new)}</b>${/patch/.test(e.text || "") ? ' <span class="sub">(patch)</span>' : ""}`; break;
    case "monster_new": if (mob) return `New monster: ${link("monster", e.monster)} <span class="sub">Lv ${mob.level}</span>`; break;
    case "map_new": if (e.map && getEntity("map", e.map)) return `New map: ${link("map", e.map)}`; break;
    case "quest_new": if (e.quest && getEntity("quest", e.quest)) return `New quest: ${link("quest", e.quest)}`; break;
    case "npc_new": if (e.npc && getEntity("npc", e.npc)) return `New NPC: ${link("npc", e.npc)}`; break;
  }
  return esc(e.text);
}

function renderFeed() {
  const q = $("#search").value.trim().toLowerCase();
  const view = $("#feedView");
  if (state.tab === "patches") {
    const posts = (db.patches || []).filter((p) => !q || `${p.name} ${p.summary}`.toLowerCase().includes(q));
    view.innerHTML = `<div class="market-bar"><div><strong>Classic World patches & news</strong><br><span class="sub">Patch notes, maintenance, events and Cash Shop updates from Nexon, checked every morning. Click a post to read it in full on nexon.com.</span></div></div>` +
      (posts.length ? posts.map((p) => `<a class="post" href="${esc(p.url)}" target="_blank" rel="noopener">
        <span class="post-meta"><span class="badge ${p.category === "maintenance" ? "patch" : ""}">${esc(CAT_LABEL[p.category] || p.category)}</span> ${esc(niceDate(p.date))}</span>
        <strong>${esc(p.name)}</strong>${p.summary ? `<span class="sub">${esc(p.summary)}</span>` : ""}<span class="more">Read on nexon.com ↗</span></a>`).join("")
        : `<p class="sub">No posts yet.</p>`);
    $("#count").textContent = `${posts.length} post${posts.length === 1 ? "" : "s"}`;
    return;
  }
  const entries = (db.log || []).filter((e) => !q || (e.text || "").toLowerCase().includes(q));
  const byDay = {};
  for (const e of entries) (byDay[e.date] ||= []).push(e);
  const days = Object.keys(byDay).sort().reverse();
  view.innerHTML = `<div class="market-bar"><div><strong>Discovery log</strong><br><span class="sub">Updated every morning. New drops players find in Classic, new monsters, stat changes, new or ended quests and events. Everything here is already reflected on the monster, item and quest pages.</span></div></div>` +
    (days.length ? days.map((d) => `<h3 class="feed-date">${esc(niceDate(d))}</h3><ul class="feed">${byDay[d].map((e) => `<li><span class="feed-ico">${LOG_ICONS[e.type] || "•"}</span><span>${logText(e)}</span></li>`).join("")}</ul>`).join("")
      : `<p class="sub">Nothing logged yet.</p>`);
  $("#count").textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
}

// ---------- NPCs ----------
function npcDetail(n) {
  let html = `<h2>${esc(n.name)}</h2><p class="sub">NPC${n.role ? ` · ${esc(n.role)}` : ""}${n.shop ? ' · <span class="badge">Shop</span>' : ""}</p>`;
  if (!n.locations.length) html += `<p class="sub">Location not in the game data yet.</p>`;
  html += n.locations.map((loc, i) => {
    const m = getEntity("map", loc.map);
    if (!m) return "";
    const pic = i < 4 ? mapLayout(m, {}, { point: loc, showMobs: false, caption: false }) : "";
    return `<h3>${n.locations.length > 1 ? `Location ${i + 1}` : "Where to find"}</h3>
      <p>${link("map", m.id)}${m.zone && m.zone !== m.name ? ` <span class="sub">· ${esc(m.zone)}</span>` : ""}</p>${pic}
      ${pic ? `<p class="sub" style="margin-top:4px">Circled on the in-game minimap.</p>` : ""}`;
  }).join("");
  html += questList("Quests they give", idx.qGiver[n.id], true);
  html += questList("Quests you turn in here", idx.qEnder[n.id], true);
  return html;
}

// ---------- quests ----------
function questList(title, ids, showDone = false) {
  if (!ids?.length) return "";
  const qs = ids.map((id) => getEntity("quest", id)).filter(Boolean).sort((a, b) => a.level - b.level);
  return `<h3>${title} (${qs.length})</h3><ul>${qs.map((q) => `<li>${showDone ? `<input type="checkbox" class="qdone" data-q="${q.id}" ${isDone(q.id) ? "checked" : ""} aria-label="Done">` : ""}${link("quest", q.id)}<span class="right">Lv ${q.level}</span></li>`).join("")}</ul>`;
}

function itemSource(itemId) {
  const by = idx.droppedBy[itemId] || [];
  if (by.length) {
    const top = by.slice(0, 2).map((d) => `${link("monster", d.monster)} (${rateText(d.rate)})`).join(", ");
    return `dropped by ${top}${by.length > 2 ? ` +${by.length - 2} more` : ""}`;
  }
  const fromQ = idx.qRewardItem[itemId];
  if (fromQ?.length) return `from quest ${link("quest", fromQ[0])}`;
  return "";
}

function npcSpot(npcId) {
  const n = getEntity("npc", npcId);
  const loc = n?.locations[0];
  const m = loc && getEntity("map", loc.map);
  return { n, loc, m };
}

function questDetail(q) {
  const done = isDone(q.id);
  let html = `<h2>${esc(q.name)}</h2>
    <p class="sub">Quest · ${esc(q.area)}${q.repeatable ? ' · <span class="badge">Repeatable</span>' : ""}${q.event ? ' · <span class="badge">Event</span>' : ""}</p>
    <label class="track ${done ? "on" : ""}"><input type="checkbox" class="qdone" data-q="${q.id}" ${done ? "checked" : ""}> ${done ? "Done!" : "Mark as done"}</label>`;

  // requirements
  const req = [["Level", q.max_level ? `${q.level}–${q.max_level}` : `${q.level}+`], ["Job", esc(q.jobs || "Any")]];
  if (q.skill) req.push(["Profession", esc(q.skill.join(", "))]);
  if (q.prof) req.push(["Profession level", esc(q.prof.map(([k, v]) => `${k} ${v}`).join(", "))]);
  html += dl(req);
  if (q.pre.length) html += `<h3>Finish first</h3><ul>${q.pre.map((id) => `<li>${isDone(id) ? "✅" : "⬜"} ${link("quest", id)}</li>`).join("")}</ul>`;

  // step 1: start
  const st = npcSpot(q.giver);
  html += `<h3>1 · Start the quest</h3><p>Talk to ${q.giver ? link("npc", q.giver, q.giver_name) : esc(q.giver_name)}${st.m ? ` in ${link("map", st.m.id)}` : q.where ? ` (${esc(q.where)})` : ""}.</p>`;
  if (st.m) html += mapLayout(st.m, {}, { point: st.loc, showMobs: false, caption: false });
  if (q.start_items.length) html += `<p class="sub">You'll be given: ${q.start_items.map((x) => `${x.count > 1 ? x.count + "× " : ""}${link("item", x.item)}`).join(", ")}</p>`;

  // step 2: tasks
  const tasks = [];
  for (const k of q.kill) {
    const where = (idx.spawnsOf[k.monster] || [])[0];
    tasks.push(`<li><span class="spr-cell">${sprite(getEntity("monster", k.monster), 28)}</span><span>Defeat <b>${k.count}×</b> ${link("monster", k.monster)}${where ? ` <span class="sub">· most common in ${link("map", where.map)}</span>` : ""}</span></li>`);
  }
  for (const x of q.need) {
    const src = itemSource(x.item);
    tasks.push(`<li><span class="spr-cell">📦</span><span>Collect <b>${x.count}×</b> ${link("item", x.item)}${src ? ` <span class="sub">· ${src}</span>` : ""}</span></li>`);
  }
  if (q.cost) tasks.push(`<li><span class="spr-cell">💰</span><span>Pay <b>${fmt(q.cost)}</b> mesos</span></li>`);
  if (!tasks.length && q.steps?.length) tasks.push(...q.steps.map((t) => `<li><span class="spr-cell">•</span><span>${esc(t)}</span></li>`));
  if (tasks.length) html += `<h3>2 · What to do</h3><ul class="tasks">${tasks.join("")}</ul>`;

  // step 3: finish
  const en = npcSpot(q.ender || q.giver);
  const endName = q.ender_name || q.giver_name;
  const same = !q.ender || q.ender === q.giver;
  html += `<h3>${tasks.length ? "3" : "2"} · Turn it in</h3><p>${same ? "Go back to" : "Bring it to"} ${q.ender || q.giver ? link("npc", q.ender || q.giver, endName) : esc(endName)}${en.m ? ` in ${link("map", en.m.id)}` : ""}.</p>`;
  if (!same && en.m) html += mapLayout(en.m, {}, { point: en.loc, showMobs: false, caption: false });

  // rewards
  const rw = [];
  if (q.exp) rw.push(`<li><span class="spr-cell">⭐</span><span>${fmt(q.exp)} EXP</span></li>`);
  if (q.meso) rw.push(`<li><span class="spr-cell">💰</span><span>${fmt(q.meso)} mesos</span></li>`);
  if (q.fame) rw.push(`<li><span class="spr-cell">👍</span><span>${q.fame} fame</span></li>`);
  for (const x of q.rewards) rw.push(`<li><span class="spr-cell">🎁</span><span>${x.count > 1 ? x.count + "× " : ""}${link("item", x.item)}</span></li>`);
  if (q.choice.length) rw.push(`<li><span class="spr-cell">🎲</span><span>One of: ${q.choice.map((x) => `${link("item", x.item)}${x.note && !/random/.test(x.note) ? ` <span class="sub">(${esc(x.note)})</span>` : ""}`).join(", ")}${q.choice.some((x) => /random/.test(x.note || "")) ? ' <span class="sub">(random)</span>' : ""}</span></li>`);
  if (rw.length) html += `<h3>Rewards</h3><ul class="tasks">${rw.join("")}</ul>`;
  if (q.unconfirmed?.length) html += `<div class="note">Some details (${esc(q.unconfirmed.join(", "))}) aren't confirmed in Classic yet.</div>`;
  html += questList("Unlocks next", idx.qNext[q.id]);
  return html;
}

// ---------- Free Market prices ----------
function cozyButton(label = "Find live shops on Cozy Market ↗") {
  return `<a class="btn" href="${COZY_URL}" target="_blank" rel="noopener">${label}</a>`;
}

// straight to the item's page when it's traded and we know its game id, otherwise HeneFM's search
// (untraded items like quest items have no page there)
function heneButton(name, cls = "btn ghost") {
  const it = priceOf(name) && byId.items[slugify(name)];
  const url = it?.gid ? `${HENEFM_URL}/items/${it.gid}` : `${HENEFM_URL}/?q=${encodeURIComponent(name)}`;
  return `<a class="${cls}" href="${url}" target="_blank" rel="noopener">HeneFM ↗</a>`;
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
  html += `<p>${cozyButton()} ${heneButton(p.name)} <a class="btn ghost" href="${CLUBFM_URL}" target="_blank" rel="noopener">Club FM ↗</a></p>`;
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
      <p class="sub">Character names whose shops sold or listed this item close to the typical price. Look for them in the Free Market, or check ${cozyButton("Cozy Market ↗").replace('class="btn"', 'class="inline"')} or ${heneButton(p.name, "inline")} for their current channel and room.</p>`;
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
