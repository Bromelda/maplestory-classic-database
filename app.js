// MapleStory Classic DB: interactive world map, searchable tables and a
// cross-linked detail panel. Data lives in data/*.json (built by tools/build_data.py).

const DATASETS = ["monsters", "items", "maps", "jobs", "npcs", "quests", "meta", "worldmap"];
const OPTIONAL = ["log", "patches", "skills", "gear", "ammo", "gear_info", "potions", "scrolls"]; // fine if missing
const db = {};
const byId = {};
const idx = { spawnsOf: {}, droppedBy: {}, incoming: {}, zones: {}, qGiver: {}, qEnder: {}, qNext: {}, qNeedItem: {}, qRewardItem: {}, qKill: {}, usedIn: {} };

const $ = (s, el = document) => el.querySelector(s);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "—" : typeof n === "number" ? n.toLocaleString() : n);

const LEVEL_BANDS = [
  [10, "#5cb85c", "1–10"], [20, "#2bb3a3", "11–20"], [30, "#3d8be0", "21–30"],
  [40, "#8a5cd6", "31–40"], [50, "#e8711c", "41–50"], [999, "#d9434c", "51+"],
];
const TOWN_COLOR = "#a08a6a";
const FREE_MARKET = "Free Market";
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
    { key: "_get", label: "Get it from", wide: true, get: (i) => itemSources(i).join(", ") },
    { key: "_by", label: "Dropped by", num: true, get: (i) => (idx.droppedBy[i.id] || []).length },
  ],
  maps: [
    { key: "name", label: "Name" },
    { key: "zone", label: "Area", get: (m) => m.node },
    { key: "type", label: "Type", wide: true },
    { key: "level", label: "Lv", num: true, get: (m) => (m.levels ? m.levels[0] : null), show: (m) => levelText(m.levels) },
    { key: "_mobs", label: "Mobs", num: true, get: (m) => m.spawns.reduce((a, s) => a + s.count, 0) },
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
const TYPE_OF_TAB = { monsters: "monster", items: "item", maps: "map", jobs: "job", quests: "quest", npcs: "npc" };
const TAB_OF_TYPE = { monster: "monsters", item: "items", map: "maps", job: "jobs", zone: "world", quest: "quests", npc: "npcs" };

const state = { world: 0, tab: "home", sortKey: "level", asc: true, history: [], pos: -1, zone: null };

// ---------- load + index ----------
async function load() {
  await Promise.all(OPTIONAL.map(async (name) => {
    try { const r = await fetch(`data/${name}.json`, { cache: "no-cache" }); db[name] = r.ok ? await r.json() : []; } catch { db[name] = []; }
  }));
  await Promise.all(DATASETS.map(async (name) => {
    const res = await fetch(`data/${name}.json`, { cache: "no-cache" }); // check for new data on every visit
    if (!res.ok) throw new Error(`${name}.json: ${res.status}`);
    db[name] = await res.json();
    if (Array.isArray(db[name])) byId[name] = Object.fromEntries(db[name].map((e) => [e.id, e]));
  }));
  buildWorldNodes();
  for (const m of db.maps) {
    (idx.zones[m.node] ||= []).push(m);
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

  for (const it of db.items) for (const r of it.crafts || []) for (const mat of r.materials) (idx.usedIn[mat.item] ||= []).includes(it.id) || idx.usedIn[mat.item].push(it.id);
  if (typeof buildSkills === "function") buildSkills();
  buildSearch();
  bind();
  renderWorld();
  renderCharChip();
  $("#charChip").addEventListener("click", () => switchTab("calc"));
  if (typeof readSharedBuild === "function" && readSharedBuild()) switchTab("calc");
  else fromHash() || switchTab("home");
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

function bind() {
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  ["#search", "#minLv", "#maxLv", "#variants", "#qarea", "#hideDone", "#myLevel"].forEach((s) => $(s).addEventListener("input", renderTable));
  const areas = [...new Set(db.quests.map((q) => q.area))].sort();
  $("#qarea").innerHTML = `<option value="">All areas</option>` + areas.map((a) => `<option>${esc(a)}</option>`).join("");
  document.addEventListener("click", onLinkClick);
  bindSearch();
  document.addEventListener("mouseover", onHover);
  document.addEventListener("mouseout", (e) => { if (e.target.closest?.("[data-tip]")) hideTip(); });
}

function onLinkClick(e) {
  const routeBtn = e.target.closest?.("[data-route-to]");
  if (routeBtn) { routeTo(routeBtn.dataset.routeTo); return; }
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
  // on a phone an open page covers everything else, so a new tab has to close it first
  if (isPhone() && currentEntry()) { state.listScroll = 0; closeDetail(); }
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => {
    const on = b.dataset.tab === (tab === "log" ? "patches" : tab);
    b.classList.toggle("active", on);
    if (on) b.scrollIntoView({ block: "nearest", inline: "center" });
  });
  const isWorld = tab === "world";
  const isFeed = FEED_TABS.includes(tab);
  const isCalc = tab === "calc";
  const isSkills = tab === "skills";
  const isRoute = tab === "route";
  const isHome = tab === "home";
  $("#homeView").hidden = !isHome;
  $("#routeView").hidden = !isRoute;
  $("#skillsView").hidden = !isSkills;
  $("#worldView").hidden = !isWorld;
  $("#tableWrap").hidden = isWorld || isFeed || isCalc || isSkills || isRoute || isHome;
  $("#feedView").hidden = !isFeed;
  $("#calcView").hidden = !isCalc;
  $("#controls").hidden = isWorld || isCalc || isSkills || isRoute || isHome;
  if (isHome) { renderHome(); return; }
  if (isRoute) { renderRoute(); return; }
  if (isCalc) { renderCalc(); return; }
  if (isSkills) { renderSkillsTab(); return; }
  if (isFeed) {
    ["#variantsWrap", "#qareaWrap", "#hideDoneWrap"].forEach((x) => { $(x).hidden = true; });
    document.querySelectorAll(".lvctl").forEach((el) => { el.hidden = true; });
    $("#search").value = "";
    renderFeed();
    return;
  }
  $("#variantsWrap").hidden = tab !== "monsters";
  document.querySelectorAll(".lvctl").forEach((el) => { el.hidden = tab === "npcs"; });
  $("#qareaWrap").hidden = tab !== "quests";
  $("#hideDoneWrap").hidden = tab !== "quests";
  $("#myLevelWrap").hidden = tab !== "quests";
  if (!isWorld) {
    state.sortKey = COLUMNS[tab].some((c) => c.key === "level") ? "level" : "name";
    state.asc = true;
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

// The nodes come from the game's own world maps (data/worldmap.json). A map that isn't on one, like the
// subway, joins a node next to it in the same area. Areas with no node at all, like the Free Market, stay on their own.
const nodes = {};

function nodeName(maps) {
  const main = maps.find((m) => m.name === m.zone) || maps[0];
  const base = (m) => m.name.replace(/ \([^)]*\)$/, "").replace(/ (I|II|III|IV|V|VI|VII|VIII|IX)$/, "");
  const shared = maps.filter((m) => base(m) === base(main)).length > 1;
  return shared ? base(main) : main.name;
}

function buildWorldNodes() {
  const byGid = Object.fromEntries(db.maps.map((m) => [m.gid, m]));
  db.worldmap.forEach((wm, world) => {
    for (const s of wm.spots) {
      const maps = s.maps.map((g) => byGid[g]).filter(Boolean);
      if (!maps.length) continue;
      let name = nodeName(maps);
      while (nodes[name]) name += " ";
      const town = s.type === 0 || s.type === 2 || (maps.length > 2 && maps.every((m) => m.type?.startsWith("Town")));
      nodes[name] = { name, world, x: s.x, y: s.y, town };
      for (const m of maps) m.node = name;
    }
  });
  // spread out to maps connected to a placed one, in the same area
  const near = {};
  for (const m of db.maps) for (const p of m.portals) {
    (near[m.id] ||= []).push(p.to);
    (near[p.to] ||= []).push(m.id);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const m of db.maps) {
      if (m.node) continue;
      const by = (near[m.id] || []).map((id) => byId.maps[id]).find((o) => o?.node && o.zone === m.zone);
      if (by) { m.node = by.node; changed = true; }
    }
  }
  for (const m of db.maps) m.node ||= m.zone;
  state.world = Math.max(0, db.worldmap.findIndex((wm) => wm.name === "Victoria Island"));
}

function renderWorld() {
  const wm = db.worldmap[state.world];
  if (!wm) { $("#worldView").innerHTML = `<p class="sub" style="padding:14px">The world map isn't available right now. Every map is still listed in the Maps tab.</p>`; return; }
  const here = Object.values(nodes).filter((n) => n.world === state.world).sort((a, b) => a.town - b.town);
  // a node only counts as a training spot when most of its maps have monsters (one job-test map doesn't make a town one)
  const training = (s) => s.typical != null && s.maps.filter((m) => m.spawns.length).length * 2 > s.maps.length;
  const colorOf = (s) => (training(s) ? bandColor(s.typical) : TOWN_COLOR);
  const levels = (s) => `${training(s) ? `Lv ${levelText([s.min, s.max])} · ` : ""}${s.maps.length} ${s.maps.length === 1 ? "map" : "maps"}`;
  const marks = here.map((n) => {
    const s = zoneSummary(n.name);
    return `<g class="zone ${n.town ? "town" : ""}" data-type="zone" data-id="${esc(n.name)}" tabindex="0" role="button" aria-label="${esc(n.name)}, ${esc(levels(s))}">
      <circle class="hit" cx="${n.x}" cy="${n.y}" r="${n.town ? 13 : 11}"></circle>
      <circle class="mark" cx="${n.x}" cy="${n.y}" r="${n.town ? 8.5 : 4.5}" fill="${colorOf(s)}"></circle>
      ${n.town ? `<text class="zone-count" x="${n.x}" y="${n.y + 3}" text-anchor="middle">${s.maps.length}</text>` : ""}
    </g>`;
  }).join("");
  const labels = here.map((n) => {
    const sub = levels(zoneSummary(n.name)), w = Math.max(n.name.length * 6.1, sub.length * 4.9) + 12;
    const lx = Math.max(3, Math.min(wm.width - w - 3, n.x - w / 2));
    const ly = n.y < 45 ? n.y + 11 : n.y - 39;
    return `<g class="zone-label" data-for="${esc(n.name)}">
      <rect x="${lx}" y="${ly}" width="${w}" height="28" rx="6"></rect>
      <text class="zone-name" x="${lx + w / 2}" y="${ly + 12}" text-anchor="middle">${esc(n.name)}</text>
      <text class="zone-sub" x="${lx + w / 2}" y="${ly + 23}" text-anchor="middle">${esc(sub)}</text>
    </g>`;
  }).join("");
  // the Free Market isn't an area of its own: towns with a door to it link to it from their page
  const off = Object.keys(idx.zones).filter((z) => !nodes[z] && z !== FREE_MARKET).sort();
  const chip = (z) => {
    const s = zoneSummary(z);
    return `<button type="button" class="zone-chip" data-type="zone" data-id="${esc(z)}"><i class="dot" style="background:${colorOf(s)}"></i><b>${esc(z)}</b><span>${esc(levels(s))}</span></button>`;
  };
  const legend = LEVEL_BANDS.map(([, c, label]) => `<span><i class="dot" style="background:${c}"></i>Lv ${label}</span>`).join("") +
    `<span><i class="dot" style="background:${TOWN_COLOR}"></i>Town / no monsters</span><span>Color = typical training level · big circles are towns, with the number of maps · click any node for its maps</span>`;
  $("#worldView").innerHTML = `
    <div class="world-bar">
      ${db.worldmap.map((w, i) => `<button type="button" class="world-tab ${i === state.world ? "active" : ""}" data-world="${i}">${esc(w.name)}</button>`).join("")}
      ${off.map((z) => `<button type="button" class="world-tab off" data-type="zone" data-id="${esc(z)}">${esc(z)}</button>`).join("")}
    </div>
    <svg viewBox="0 0 ${wm.width} ${wm.height}" role="img" aria-label="World map of ${esc(wm.name)}">
      <image href="${wm.image}" width="${wm.width}" height="${wm.height}"></image>
      ${marks}${labels}
    </svg>
    <div class="legend">${legend}</div>
    <div class="zone-chips">
      ${here.filter((n) => n.town).map((n) => chip(n.name)).join("")}
      <details class="zone-more"><summary>All ${here.filter((n) => !n.town).length} areas between the towns</summary>
        <div class="zone-more-list">${here.filter((n) => !n.town).map((n) => chip(n.name)).join("")}</div>
      </details>
    </div>`;
  $("#worldView").querySelectorAll(".world-tab[data-world]").forEach((b) => b.addEventListener("click", () => {
    state.world = Number(b.dataset.world);
    renderWorld();
    markZone(currentEntry()?.type === "zone" ? currentEntry().id : null);
    $(".world-tab.active")?.focus();
  }));
  const labelOf = (id) => [...$("#worldView").querySelectorAll(".zone-label")].find((l) => l.dataset.for === id);
  $("#worldView").querySelectorAll(".zone").forEach((g) => {
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open("zone", g.dataset.id); }
    });
    // mouse only: on an iPhone, changing the page on hover makes the first tap do nothing
    g.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") labelOf(g.dataset.id)?.classList.add("show"); });
    g.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") labelOf(g.dataset.id)?.classList.remove("show"); });
    g.addEventListener("focus", () => labelOf(g.dataset.id)?.classList.add("show"));
    g.addEventListener("blur", () => labelOf(g.dataset.id)?.classList.remove("show"));
  });
}

function highlightZone(z) {
  const n = nodes[z];
  if (n && n.world !== state.world) { state.world = n.world; renderWorld(); }
  markZone(z);
}

function markZone(z) {
  document.querySelectorAll(".zone").forEach((g) => g.classList.toggle("active", g.dataset.id === z));
  document.querySelectorAll(".zone-label").forEach((l) => l.classList.toggle("on", l.dataset.for === z));
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
  const rows = (db[tab] || []).filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
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
  if (["home", "world", "calc", "skills", "route"].includes(tab)) return;
  if (FEED_TABS.includes(tab)) return renderFeed();
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
  const ds = { monster: "monsters", item: "items", map: "maps", job: "jobs", quest: "quests", npc: "npcs" }[type];
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
  const body = { zone: zoneDetail, map: mapDetail, monster: monsterDetail, item: itemDetail, job: jobDetail, quest: questDetail, npc: npcDetail }[cur.type](getEntity(cur.type, cur.id));
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
  const doors = s.maps.filter((m) => m.portals.some((p) => byId.maps[p.to]?.node === FREE_MARKET));
  const market = doors.length && z.id !== FREE_MARKET ? (() => {
    const inside = byId.maps[doors[0].portals.find((p) => byId.maps[p.to]?.node === FREE_MARKET).to];
    return `<div class="zone-group"><h4>Free Market</h4><a class="maprow" data-type="map" data-id="${esc(inside.id)}" href="#map/${encodeURIComponent(inside.id)}">
      <span class="top">${esc(inside.name)}</span><span class="mobs">Go in from ${doors.map((m) => esc(m.name)).join(" or ")}</span></a></div>`;
  })() : "";
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
  const next = new Set();
  for (const m of s.maps) for (const p of m.portals) {
    const to = byId.maps[p.to];
    if (p.kind !== "hidden" && to && to.node !== z.id && nodes[to.node]) next.add(to.node);
  }
  const links = next.size ? `<p class="sub">Connects to ${[...next].map((n) => link("zone", n)).join(", ")}</p>` : "";
  return `<h2>${esc(z.id)}</h2><p class="sub">${s.maps.length} ${s.maps.length === 1 ? "map" : "maps"}${s.min != null ? ` · Lv ${levelText([s.min, s.max])}` : ""}</p>${links}${market}${out}`;
}

// map: layout drawing, spawn counts, portals (incl. hidden), NPCs
function mapDetail(m) {
  const colorOf = {};
  m.spawns.forEach((s, i) => { colorOf[s.monster] = MOB_COLORS[i % MOB_COLORS.length]; });
  const total = m.spawns.reduce((a, x) => a + x.count, 0);
  let html = `<h2>${esc(m.name)}</h2><p class="sub">${m.node === FREE_MARKET ? esc(m.node) : link("zone", m.node)} · ${esc(m.type || m.region)}${m.region === "Hidden Street" ? ' · <span class="badge hidden">Hidden Street</span>' : ""}</p>`;
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
  html += `<p><button type="button" class="btn ghost" data-route-to="${esc(m.id)}">Find a route here</button></p>`;
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

// Draws a map: its art from the game files when we have it (the sharpened minimap otherwise),
// with monsters at their spawn points and portals on top. `highlight` = id of a destination map whose portal(s) get circled.
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
  const bg = m.minimap
    ? `<image href="assets/map-art/${m.gid}.webp" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" onerror="this.onerror=null;this.setAttribute('href','assets/minimap-hd/${m.gid}.webp')"></image>`
    : "";
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
  const u = zoomW / 560; // about one screen pixel, so markers stay the same size on any map
  // monsters stand where they spawn, bigger on large maps so they stay visible and tappable, without big ones taking over
  const k = Math.min(3.5, Math.max(1, zoomW / 1000));
  const tallest = zoomW * 0.13;
  const mobs = showMobs ? m.mobpos.map(([id, x, y]) => {
    const mob = getEntity("monster", id);
    const cx = x + ox, cy = y + oy, color = colorOf[id] || "#999";
    const title = `<title>${esc(mob?.name || id)}</title>`;
    if (!mob?.sprite) return `<circle class="mob-dot" data-type="monster" data-id="${esc(id)}" cx="${cx}" cy="${cy}" r="${7 * u}" fill="${color}">${title}</circle>`;
    const size = mob.sprite_size || [80, 80];
    const fit = Math.min(k, Math.max(1, tallest / Math.max(...size)));
    const [sw, sh] = size.map((v) => v * fit);
    return `<g class="mob" data-type="monster" data-id="${esc(id)}">${title}<ellipse class="mob-base" cx="${cx}" cy="${cy}" rx="${sw * 0.42}" ry="${Math.max(sw * 0.12, 3 * u)}" fill="${color}"></ellipse><image href="assets/mob/${mob.gid}.gif" x="${cx - sw / 2}" y="${cy - sh}" width="${sw}" height="${sh}"></image></g>`;
  }).join("") : "";
  const label = (text, cx, y) => {
    const anchor = cx < w * 0.12 ? "start" : cx > w * 0.88 ? "end" : "middle";
    return `<text class="map-label" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;
  };
  const seen = new Set();
  let rings = "";
  const shownPortals = m.portals.filter((p) => { const k = `${p.to}|${p.x}|${p.y}`; if (seen.has(k) || p.to === m.id) return false; seen.add(k); return true; });
  // towns have dozens of markers: draw them smaller there, and skip the rings around hidden portals
  const crowded = shownPortals.length + m.npcs.length > 12;
  const mu = crowded ? u * 0.72 : u;
  const portals = shownPortals.map((p) => {
    const t = getEntity("map", p.to);
    // kept inside the map, for portals right at its edge
    const edge = 14 * mu;
    const cx = Math.max(edge, Math.min(w - edge, p.x + ox)), cy = Math.max(edge, Math.min(h - edge, p.y + oy - 15 * mu));
    const hidden = p.kind === "hidden";
    if (p.to === highlight || (!highlight && !point && hidden && !crowded)) {
      const isT = p.to === highlight;
      const R = isT ? zoomW * 0.09 : 27 * u;
      const sw = isT ? zoomW * 0.016 : 3 * u;
      if (isT) rings += `<circle class="ring halo" cx="${cx}" cy="${cy}" r="${R}" style="stroke-width:${sw * 1.9}px"></circle>`;
      rings += `<circle class="ring ${isT ? "target" : ""}" cx="${cx}" cy="${cy}" r="${R}" style="stroke-width:${sw}px${isT ? "" : `;stroke-dasharray:${8 * u} ${5 * u}`}"></circle>`;
    }
    const glyph = hidden ? `<text class="glyph" y="5.5" text-anchor="middle">?</text>` : `<path d="M-5.5,2.5 L0,-3.5 L5.5,2.5"></path>`;
    const name = caption && shownPortals.length <= 8 ? label(t?.name || p.to, cx, 28) : "";
    return `<g class="portal ${hidden ? "hidden-p" : ""}" data-type="map" data-id="${esc(p.to)}" transform="translate(${cx} ${cy}) scale(${mu})"><title>${hidden ? "Hidden portal" : "Portal"} → ${esc(t?.name || p.to)}</title><circle class="glow" r="19"></circle><circle class="disc" r="12.5"></circle>${glyph}${name}</g>`;
  }).join("");
  const head = 70; // NPC pins point at the top of the character
  const npcs = showNpcs || point ? m.npcs.map((n) => {
    const e = getEntity("npc", n.npc);
    const cx = n.x + ox, cy = n.y + oy - head;
    const name = caption && m.npcs.length <= 6 ? label(e?.name || n.npc, cx, -30) : "";
    return `<g class="npc-mark" data-type="npc" data-id="${esc(n.npc)}" transform="translate(${cx} ${cy}) scale(${mu})"><title>${esc(e?.name || n.npc)}</title><path d="M0,0 C-2.5,-5 -9,-9.5 -9,-16 A9,9 0 1 1 9,-16 C9,-9.5 2.5,-5 0,0 Z"></path><circle cy="-16" r="3.4"></circle>${name}</g>`;
  }).join("") : "";
  if (point) {
    const R = zoomW * 0.09, sw = zoomW * 0.016, py = point.y + oy - head - 16 * mu;
    rings += `<circle class="ring halo" cx="${point.x + ox}" cy="${py}" r="${R}" style="stroke-width:${sw * 1.9}px"></circle>
      <circle class="ring target" cx="${point.x + ox}" cy="${py}" r="${R}" style="stroke-width:${sw}px"></circle>`;
  }
  const cap = caption
    ? `<p class="sub" style="margin-top:6px">${m.minimap ? "Map from the game files" : "Layout from the game data"}. <span style="color:var(--accent)">●</span> portal · <span style="color:var(--hidden)">●</span> hidden portal · <span style="color:var(--npc)">●</span> NPC · click any marker${showMobs && m.mobpos.length ? " · monsters are shown where they spawn" : ""}</p>`
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
      return `<tr><td>${link("item", d.item)}${it?.type ? ` <span class="sub">${esc(it.type)}</span>` : ""}</td><td class="num">${rateText(d.rate)}</td></tr>`;
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

function itemSources(it) {
  return [it.shops && "Shop", idx.droppedBy[it.id] && "Drop", it.crafts && "Crafting", idx.qRewardItem[it.id] && "Quest"].filter(Boolean);
}
function hasItemIcon(it) { return !!it.gid && (db.gear_info?.[it.gid] !== undefined || (db.potions || []).some((p) => p.gid === it.gid)); }
function sellAdvice(it) {
  if (it.id === "meso") return "";
  const need = idx.qNeedItem[it.id] || [];
  const open = need.filter((id) => !isDone(id));
  const used = idx.usedIn[it.id] || [];
  const crafted = used.slice(0, 3).map((id) => link("item", id)).join(", ") + (used.length > 3 ? ` and ${used.length - 3} more` : "");
  const craftLine = used.length ? ` It's used to craft ${crafted}.` : "";
  const who = esc(activeChar().name);
  const [cls, label, text] = open.length
    ? ["keep", "Keep it", `${open.length} ${open.length === 1 ? "quest" : "quests"} ${who} hasn't finished ${open.length === 1 ? "needs" : "need"} this.${craftLine}`]
    : used.length ? ["maybe", "Keep it if you craft", `No unfinished quest needs this.${craftLine}`]
    : ["safe", "Safe to sell", need.length ? `${who} has finished every quest that needs this, and no recipe uses it.` : "No quest or crafting recipe listed here needs this."];
  return `<div class="sell-advice ${cls}"><b>${label}</b><span>${text}</span></div>`;
}
function itemDetail(it) {
  const icon = hasItemIcon(it) ? `<span class="cx-ico item-ico"><img src="assets/item/${it.gid}.png" alt="" onerror="this.parentElement.remove()"></span>` : "";
  let html = `<div class="item-head">${icon}<div><h2>${esc(it.name)}</h2><p class="sub">${esc([it.type, it.category].filter(Boolean).join(" · ") || "Item")}</p></div></div>`;
  const stats = it.stats ? Object.entries(it.stats).map(([k, v]) => `${esc(k)} ${v > 0 ? "+" : ""}${v}`).join(", ") : null;
  const req = db.gear_info?.[it.gid];
  const reqText = req && Object.keys(req).length ? ["STR", "DEX", "INT", "LUK"].filter((k) => req[k]).map((k) => `${req[k]} ${k}`).join(", ") : null;
  html += dl([["Req. level", it.level], ["Req. stats", reqText], ["Effect", esc(it.effect)], ["Stats", stats], ["Shop price", !it.shops && it.shop_price ? fmt(it.shop_price) + " mesos" : null], ["Sells to NPC for", it.sell ? fmt(it.sell) + " mesos" : null]]);
  html += sellAdvice(it);
  if (it.shops) {
    const shops = [...it.shops].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    html += `<h3>Sold by (${shops.length})</h3><ul>${shops.map((s) => `<li>${link("npc", s.npc, s.name)}${s.town ? ` <span class="sub">${esc(s.town)}</span>` : ""}<span class="right">${s.price != null ? `${fmt(s.price)} mesos` : ""}</span></li>`).join("")}</ul>`;
  }
  if (it.crafts) {
    html += `<h3>Crafting</h3><ul>${it.crafts.map((r) => `<li><span>${esc(r.skill)} ${r.level}: ${r.materials.map((x) => `${x.count > 1 ? `${x.count}× ` : ""}${link("item", x.item)}`).join(", ")}</span></li>`).join("")}</ul>`;
  }
  html += questList("Needed for quests", idx.qNeedItem[it.id]);
  html += questList("Quest reward from", idx.qRewardItem[it.id]);
  const by = idx.droppedBy[it.id] || [];
  if (by.length) html += `<h3>Dropped by (${by.length})</h3><ul>${by.map((d) => `<li><span class="spr-cell">${sprite(getEntity("monster", d.monster), 26)}</span>${link("monster", d.monster)}<span class="right">Lv ${getEntity("monster", d.monster)?.level} · ${rateText(d.rate)}</span></li>`).join("")}</ul>`;
  else if (!it.shops && !it.crafts && !idx.qRewardItem[it.id]) html += `<p class="sub">No way to get this has been reported in Classic yet.</p>`;
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
  const chooser = `<div class="cx-modes feed-switch" role="radiogroup" aria-label="News">${[["patches", "Patches and events"], ["log", "New discoveries"]].map(([t, label]) => `<button type="button" class="cx-mode ${state.tab === t ? "on" : ""}" data-feed="${t}" role="radio" aria-checked="${state.tab === t}">${label}</button>`).join("")}</div>`;
  if (state.tab === "patches") {
    const posts = (db.patches || []).filter((p) => !q || `${p.name} ${p.summary}`.toLowerCase().includes(q));
    view.innerHTML = chooser + `<div class="info-bar"><div><strong>Classic World patches & news</strong><br><span class="sub">Patch notes, maintenance, events and Cash Shop updates from Nexon, checked every morning. Click a post to read it in full on nexon.com.</span></div></div>` +
      (posts.length ? posts.map((p) => `<a class="post" href="${esc(p.url)}" target="_blank" rel="noopener">
        <span class="post-meta"><span class="badge ${p.category === "maintenance" ? "patch" : ""}">${esc(CAT_LABEL[p.category] || p.category)}</span> ${esc(niceDate(p.date))}</span>
        <strong>${esc(p.name)}</strong>${p.summary ? `<span class="sub">${esc(p.summary)}</span>` : ""}<span class="more">Read on nexon.com ↗</span></a>`).join("")
        : `<p class="sub">No posts yet.</p>`);
    $("#count").textContent = `${posts.length} post${posts.length === 1 ? "" : "s"}`;
    view.querySelectorAll("[data-feed]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.feed)));
    return;
  }
  const entries = (db.log || []).filter((e) => !q || (e.text || "").toLowerCase().includes(q));
  const byDay = {};
  for (const e of entries) (byDay[e.date] ||= []).push(e);
  const days = Object.keys(byDay).sort().reverse();
  view.innerHTML = chooser + `<div class="info-bar"><div><strong>Discovery log</strong><br><span class="sub">Updated every morning. New drops players find in Classic, new monsters, stat changes, new or ended quests and events. Everything here is already reflected on the monster, item and quest pages.</span></div></div>` +
    (days.length ? days.map((d) => `<h3 class="feed-date">${esc(niceDate(d))}</h3><ul class="feed">${byDay[d].map((e) => `<li><span class="feed-ico">${LOG_ICONS[e.type] || "•"}</span><span>${logText(e)}</span></li>`).join("")}</ul>`).join("")
      : `<p class="sub">Nothing logged yet.</p>`);
  $("#count").textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
  view.querySelectorAll("[data-feed]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.feed)));
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
      ${pic ? `<p class="sub" style="margin-top:4px">Circled on the map.</p>` : ""}`;
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

// ---------- start page ----------
function nextQuests(lv, cls, limit) {
  return db.quests.filter((q) => !isDone(q.id) && !q.event && q.level <= lv && (!q.max_level || q.max_level >= lv)
      && (!q.jobs || lv < 10 || cls === "Beginner" || q.jobs.includes(cls)) && q.pre.every(isDone))
    .sort((a, b) => b.level - a.level || (b.exp || 0) - (a.exp || 0)).slice(0, limit);
}
function nextJob(cls, lv) {
  const branch = cls === "Beginner" ? null : cls;
  if (!branch) return db.jobs.filter((j) => j.advancement === 1).sort((a, b) => a.level - b.level);
  const own = db.jobs.filter((j) => j.branch === branch);
  const step = own.filter((j) => j.level >= lv).sort((a, b) => a.level - b.level);
  return step.length ? step.filter((j) => j.level === step[0].level) : [];
}
function renderHome() {
  const view = $("#homeView");
  const cls = calc.cls, lv = calc.level;
  const c = withGear(calc), r = rawRange(c);
  const picks = [...guideEntries(c, r).usable].sort((a, b) => b.rate.exp - a.rate.exp).slice(0, 3);
  const upgrades = bestUpgrades(3);
  const quests = nextQuests(lv, cls, 5);
  const jobs = nextJob(cls, lv);
  const latest = (db.patches || [])[0];
  const card = (title, body, foot = "") => `<section class="calc-card home-card"><h3>${title}</h3>${body}${foot}</section>`;
  view.innerHTML = `
    <section class="cx-intro"><div><h2>Where to next?</h2><p>Pick your class and level for your next steps.</p></div>
      <div class="cx-jobs" role="radiogroup" aria-label="Class">
        ${Object.keys(WEAPONS).map((k) => `<button type="button" class="cx-job ${cls === k ? "on" : ""}" data-home-cls="${k}" role="radio" aria-checked="${cls === k}"><span>${CLASS_ICON[k]}</span>${k}</button>`).join("")}
      </div></section>
    <section class="calc-card home-level"><div class="cx-level">
      <input type="range" id="homeLevelR" min="1" max="120" value="${Math.min(lv, 120)}" aria-label="Level slider">
      <label class="cf"><span>Level</span><input type="number" id="homeLevel" min="1" max="200" value="${lv}" inputmode="numeric"></label>
    </div></section>
    <div class="home-grid">
      ${card("Train here", picks.length ? `<ul class="home-list">${picks.map(({ m, rate, danger }) => `<li><span class="spr-cell">${sprite(m, 30)}</span><span class="home-text">${link("monster", m.id)} <small>Lv ${m.level} · ${link("map", rate.best.map)}${danger.hitsToDie <= 3 ? " · dangerous" : ""}</small></span><span class="right">${shortNum(rate.exp)} EXP/hr</span></li>`).join("")}</ul>` : `<p class="sub">Add your gear in the calculator to get picks.</p>`,
        `<p class="sub small">Using your calculator setup. <button type="button" class="link-btn" data-go="calc">Update it</button></p>`)}
      ${card("Quests you can do", quests.length ? `<ul class="home-list">${quests.map((q) => `<li><span class="home-text">${link("quest", q.id)} <small>${esc(q.giver_name || q.area)}</small></span><span class="right">Lv ${q.level}</span></li>`).join("")}</ul>` : `<p class="sub">No open quests for this level and class.</p>`,
        `<p class="sub small"><button type="button" class="link-btn" data-go="quests">See every quest</button></p>`)}
      ${card("Gear to look for", upgrades.length ? `<ul class="home-list">${upgrades.map((u) => `<li><span class="cx-ico">${itemIcon(u.g.gid)}</span><span class="home-text"><b>${esc(u.g.name)}</b> <small>${UPGRADE_SLOTS[u.slot]} · +${u.pct.toFixed(1)}% damage</small></span><span class="right">${u.price != null ? shortNum(u.price) : ""}</span></li>`).join("")}</ul>` : `<p class="sub">Nothing better you can wear yet.</p>`,
        `<p class="sub small"><button type="button" class="link-btn" data-go="calc">Open the calculator</button></p>`)}
      ${card("Next job step", jobs.length ? `<ul class="home-list">${jobs.map((j) => `<li><span class="home-text">${link("job", j.id)} <small>${esc(j.location || j.instructor || "")}</small></span><span class="right">Lv ${j.level}</span></li>`).join("")}</ul>` : `<p class="sub">You've reached the last job open in Classic so far.</p>`,
        `<p class="sub small"><button type="button" class="link-btn" data-go="jobs">See the job tree</button> · <button type="button" class="link-btn" data-go="skills">Plan your skills</button></p>`)}
      ${latest ? card("Latest news", `<p><a href="${esc(latest.url)}" target="_blank" rel="noopener">${esc(latest.name)}</a><br><span class="sub">${esc(niceDate(latest.date))}</span></p>`, `<p class="sub small"><button type="button" class="link-btn" data-go="patches">All news</button></p>`) : ""}
    </div>`;
  view.querySelectorAll("[data-home-cls]").forEach((b) => b.addEventListener("click", () => {
    calc.cls = b.dataset.homeCls;
    calc.weapon = Object.keys(WEAPONS[calc.cls])[0];
    calc.skillId = defaultSkill();
    applySkill();
    calc.gear = Object.fromEntries(Object.entries(calc.gear).filter(([slot, gid]) => gearFor(calc, slot).some((g) => g.gid === gid)));
    saveCalc();
    renderHome();
  }));
  const setLevel = (v) => { const n = parseInt(v, 10); if (n >= 1) { calc.level = Math.min(n, 200); saveCalc(); renderHome(); } };
  $("#homeLevelR").addEventListener("change", (e) => setLevel(e.target.value));
  $("#homeLevelR").addEventListener("input", (e) => { $("#homeLevel").value = e.target.value; });
  $("#homeLevel").addEventListener("change", (e) => setLevel(e.target.value));
  view.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.go)));
  if (!prices.byName && !prices.failed && !prices.loading) { prices.loading = true; loadPrices(); }
}

// ---------- site-wide search ----------
const searchEntries = [];
const SEARCH_TYPES = { zone: "Area", monster: "Monster", item: "Item", map: "Map", npc: "NPC", quest: "Quest", job: "Job" };
function buildSearch() {
  const add = (type, list, sub) => { for (const e of list) searchEntries.push({ type, id: e.id, name: e.name, lc: e.name.toLowerCase(), sub: sub(e), mob: type === "monster" ? e : null }); };
  add("zone", Object.values(nodes).map((n) => ({ id: n.name, name: n.name })), (n) => { const c = idx.zones[n.id]?.length || 0; return `${c} ${c === 1 ? "map" : "maps"}`; });
  add("map", db.maps, (m) => (m.levels ? `Lv ${levelText(m.levels)}` : m.node || ""));
  add("monster", db.monsters, (m) => `Lv ${m.level}${m.variant ? ` · ${m.variant}` : ""}`);
  add("item", db.items, (i) => [i.category || i.type, i.level ? `Lv ${i.level}` : ""].filter(Boolean).join(" · "));
  add("npc", db.npcs, (n) => n.role || "");
  add("quest", db.quests, (q) => `Lv ${q.level} · ${q.area}`);
  add("job", db.jobs, (j) => j.branch || "");
}
function searchFind(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const order = Object.keys(SEARCH_TYPES);
  const score = (e) => {
    if (e.lc === words.join(" ")) return 0;
    if (e.lc.startsWith(words[0])) return 1;
    return new RegExp(`(^|[^a-z0-9])${words[0].replace(/[^a-z0-9]/g, "\\$&")}`).test(e.lc) ? 2 : 3;
  };
  return searchEntries.filter((e) => words.every((w) => e.lc.includes(w))).map((e) => ({ e, s: score(e) }))
    .sort((a, b) => a.s - b.s || order.indexOf(a.e.type) - order.indexOf(b.e.type) || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name))
    .slice(0, 12).map((x) => x.e);
}
function bindSearch() {
  const input = $("#gsInput"), box = $("#gsResults");
  let found = [], active = -1;
  const close = () => { box.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const paint = () => {
    box.querySelectorAll("[data-gs]").forEach((b, i) => {
      b.classList.toggle("on", i === active);
      if (i === active) b.scrollIntoView({ block: "nearest" });
    });
  };
  const show = () => {
    const text = input.value.trim();
    if (!text) { close(); return; }
    found = searchFind(text);
    active = found.length ? 0 : -1;
    box.innerHTML = found.length
      ? found.map((e, i) => `<button type="button" class="gs-row" data-gs="${i}" tabindex="-1"><span class="gs-pic">${e.mob ? sprite(e.mob, 28) : ""}</span><span class="gs-text"><b>${esc(e.name)}</b>${e.sub ? `<small>${esc(e.sub)}</small>` : ""}</span><span class="gs-type">${SEARCH_TYPES[e.type]}</span></button>`).join("")
      : `<p class="gs-none">Nothing found for "${esc(text)}".</p>`;
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    paint();
  };
  const choose = (e) => {
    input.value = "";
    close();
    input.blur();
    open(e.type, e.id);
  };
  input.addEventListener("input", show);
  input.addEventListener("focus", show);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { input.value = ""; close(); return; }
    if (box.hidden || !found.length) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); active = (active + 1) % found.length; paint(); }
    if (ev.key === "ArrowUp") { ev.preventDefault(); active = (active - 1 + found.length) % found.length; paint(); }
    if (ev.key === "Enter") { ev.preventDefault(); choose(found[Math.max(0, active)]); }
  });
  box.addEventListener("click", (ev) => {
    const row = ev.target.closest("[data-gs]");
    if (row) choose(found[Number(row.dataset.gs)]);
  });
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".gs")) close(); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) { ev.preventDefault(); input.focus(); }
  });
}

// ---------- route planner ----------
const ROUTE_KEY = "msclassicdb.route";
const route = (() => {
  const base = { from: "henesys", to: "", hidden: true };
  try { return { ...base, ...JSON.parse(localStorage.getItem(ROUTE_KEY) || "{}") }; } catch { return base; }
})();
function saveRoute() { try { localStorage.setItem(ROUTE_KEY, JSON.stringify(route)); } catch { /* storage unavailable */ } }
function routeEdges(m, useHidden) {
  const edges = m.portals.filter((p) => p.to !== m.id && byId.maps[p.to] && (useHidden || p.kind !== "hidden"))
    .map((p) => ({ to: p.to, portal: p, cost: p.kind === "hidden" ? 1.2 : 1 }));
  for (const boat of db.meta.boats || []) {
    if (boat.from !== m.id || !byId.maps[boat.to]) continue;
    const same = edges.find((e) => e.to === boat.to);
    if (same) same.boat = boat; else edges.push({ to: boat.to, boat, cost: 1 });
  }
  return edges;
}
// fewest maps, and a normal portal wins over a hidden one when they're about the same
function findRoute(from, to, useHidden) {
  if (from === to) return [];
  const dist = { [from]: 0 }, prev = {}, done = new Set();
  for (;;) {
    let cur = null;
    for (const id of Object.keys(dist)) if (!done.has(id) && (cur == null || dist[id] < dist[cur])) cur = id;
    if (cur == null) return null;
    if (cur === to) break;
    done.add(cur);
    for (const edge of routeEdges(byId.maps[cur], useHidden)) {
      const d = dist[cur] + edge.cost;
      if (dist[edge.to] == null || d < dist[edge.to]) { dist[edge.to] = d; prev[edge.to] = { from: cur, ...edge }; }
    }
  }
  const steps = [];
  for (let at = to; at !== from; at = prev[at].from) steps.unshift(prev[at]);
  return steps;
}
function mapByName(text) {
  const lc = text.trim().toLowerCase();
  return db.maps.find((m) => m.name.toLowerCase() === lc) || null;
}
function routeStepText(s) {
  if (s.boat) return `Take the boat with ${esc(s.boat.npc)}${s.boat.price != null ? ` (${fmt(s.boat.price)} mesos)` : ""}${s.boat.note ? ` <span class="sub">(${esc(s.boat.note)})</span>` : ""}`;
  if (s.portal?.kind === "hidden") return `Take the hidden portal`;
  if (s.portal?.kind === "door") return `Go through the door`;
  return `Take the portal`;
}
function renderRouteResult() {
  const box = $("#routeResult");
  const from = byId.maps[route.from], to = byId.maps[route.to];
  if (!from || !to) { box.innerHTML = `<p class="sub empty">Pick where you are and where you're going.</p>`; return; }
  if (from.id === to.id) { box.innerHTML = `<p class="sub empty">You're already there.</p>`; return; }
  const steps = findRoute(from.id, to.id, route.hidden);
  if (!steps) {
    const withHidden = !route.hidden && findRoute(from.id, to.id, true);
    box.innerHTML = `<div class="note">${withHidden ? "There's no way there without hidden portals. Turn them on above." : `No route found using portals and boats. ${link("map", to.id)} may need an NPC, a ticket or a quest to enter, or there may be no way back from ${link("map", from.id)}. Check its map page.`}</div>`;
    return;
  }
  const hiddenCount = steps.filter((s) => s.portal?.kind === "hidden").length;
  const fare = steps.reduce((a, s) => a + (s.boat?.price || 0), 0);
  const facts = [`${steps.length} ${steps.length === 1 ? "step" : "steps"}`, hiddenCount && `${hiddenCount} hidden ${hiddenCount === 1 ? "portal" : "portals"}`, fare && `${fmt(fare)} mesos`].filter(Boolean).join(" · ");
  box.innerHTML = `<p class="route-facts">${facts}</p><ol class="route-steps">${steps.map((s, i) => `<li><details data-step="${i}" ${i === 0 ? "open" : ""}><summary>
      <span class="route-num">${i + 1}</span><span class="route-text"><span>${routeStepText(s)} in ${link("map", s.from)}</span><span class="sub">to ${link("map", s.to)}</span></span>${s.portal?.kind === "hidden" ? '<span class="badge hidden">Hidden</span>' : ""}</summary>
      <div class="route-map"></div></details></li>`).join("")}</ol>
    <p class="sub small">Uses the portals and boats in the game data. Only walking routes are shown, so return scrolls and NPC trips could be faster. Tap a step to see its portal on the map.</p>`;
  const fill = (d) => {
    const body = d.querySelector(".route-map");
    if (body.dataset.done) return;
    body.dataset.done = "1";
    const s = steps[Number(d.dataset.step)];
    const src = byId.maps[s.from];
    const usable = s.portal && (s.portal.x || s.portal.y);
    const pic = usable ? mapLayout(src, {}, { highlight: s.to, showMobs: false, showNpcs: false, caption: false }) : "";
    body.innerHTML = pic || `<p class="sub">No picture for this step.</p>`;
  };
  box.querySelectorAll("details").forEach((d) => {
    if (d.open) fill(d);
    d.addEventListener("toggle", () => { if (d.open) fill(d); });
  });
}
function renderRoute() {
  const nameOf = (id) => byId.maps[id]?.name || "";
  $("#routeView").innerHTML = `
    <section class="cx-intro"><div><h2>Route planner</h2><p>Find the way between any two maps, step by step.</p></div></section>
    <section class="calc-card route-form">
      <label class="cf"><span>From</span><input id="routeFrom" type="search" list="routeMaps" value="${esc(nameOf(route.from))}" placeholder="Start typing a map…" autocomplete="off"></label>
      <button type="button" class="route-swap" id="routeSwap" aria-label="Swap start and destination">⇅</button>
      <label class="cf"><span>To</span><input id="routeTo" type="search" list="routeMaps" value="${esc(nameOf(route.to))}" placeholder="Start typing a map…" autocomplete="off"></label>
      <label class="check route-hidden"><input id="routeHidden" type="checkbox" ${route.hidden ? "checked" : ""}> Use hidden portals</label>
      <datalist id="routeMaps">${db.maps.map((m) => `<option value="${esc(m.name)}"></option>`).join("")}</datalist>
    </section>
    <section class="calc-card" id="routeResult"></section>`;
  const update = (key, el) => {
    const m = mapByName(el.value);
    if (m) route[key] = m.id;
    else if (!el.value.trim()) route[key] = "";
    else return; // still typing
    saveRoute();
    renderRouteResult();
  };
  $("#routeFrom").addEventListener("input", (e) => update("from", e.target));
  $("#routeTo").addEventListener("input", (e) => update("to", e.target));
  $("#routeHidden").addEventListener("change", (e) => { route.hidden = e.target.checked; saveRoute(); renderRouteResult(); });
  $("#routeSwap").addEventListener("click", () => {
    [route.from, route.to] = [route.to, route.from];
    saveRoute();
    $("#routeFrom").value = nameOf(route.from);
    $("#routeTo").value = nameOf(route.to);
    renderRouteResult();
  });
  renderRouteResult();
}
function routeTo(id) {
  route.to = id;
  saveRoute();
  switchTab("route");
  if (isPhone()) window.scrollTo(0, 0);
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
