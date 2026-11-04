// Damage calculator for MapleStory Classic World.
// Damage formulas: community-datamined Classic formulas (NiaMeowDB, FullBoosts, MS-Classic agree),
// with an optional MapleClassic Wiki variant for physical hits.
// Accuracy / hit chance: NiaMeowDB and MS-Classic (they match).
// Avoid, defense, HP/MP, AP and EXP to level: NiaDB's formula pages (linked under the results).
// Skill presets: max-level values, each read from its own NiaDB skill page (linked).
// Loaded after app.js; uses its helpers (db, idx, $, esc, fmt, link, sprite, getEntity).

const NIADB = "https://meowdb.com/msclassic/skills/";

// Weapon multipliers (Classic): [swing, stab]; ranged weapons shoot at 2.5.
const WEAPONS = {
  Beginner: {
    "1H Sword": { mult: [1.8, 1.8], stats: ["STR", "DEX"] },
    "1H Axe": { mult: [2.4, 1.2], stats: ["STR", "DEX"] },
    "1H Blunt": { mult: [2.4, 1.2], stats: ["STR", "DEX"] },
    "2H Sword": { mult: [2.5, 2.5], stats: ["STR", "DEX"] },
    "Spear": { mult: [1.5, 3.5], stats: ["STR", "DEX"] },
    "Dagger": { mult: [1.0, 2.0], stats: ["LUK", "STR+DEX"] },
    "Wand": { mult: [1.8, 1.8], stats: ["STR", "DEX"] },
  },
  Warrior: {
    "1H Sword": { mult: [1.8, 1.8], stats: ["STR", "DEX"] },
    "2H Sword": { mult: [2.5, 2.5], stats: ["STR", "DEX"] },
    "1H Axe": { mult: [2.4, 1.2], stats: ["STR", "DEX"] },
    "2H Axe": { mult: [3.0, 2.0], stats: ["STR", "DEX"] },
    "1H Blunt": { mult: [2.4, 1.2], stats: ["STR", "DEX"] },
    "2H Blunt": { mult: [3.0, 2.0], stats: ["STR", "DEX"] },
    "Spear": { mult: [1.5, 3.5], stats: ["STR", "DEX"] },
    "Polearm": { mult: [3.5, 1.5], stats: ["STR", "DEX"] },
  },
  // magic: casts spells; a regular attack is still a physical hit with the weapon
  Magician: { "Wand": { magic: true, mult: [1.8, 1.8], stats: ["STR", "DEX"] }, "Staff": { magic: true, mult: [1.8, 1.8], stats: ["STR", "DEX"] } },
  Bowman: {
    "Bow": { shoot: 2.5, stats: ["DEX", "STR"] },
    "Crossbow": { shoot: 2.5, stats: ["DEX", "STR"] },
  },
  Thief: {
    "Claw": { shoot: 2.5, stats: ["LUK", "STR+DEX"] },
    "Dagger": { mult: [1.0, 2.0], stats: ["LUK", "STR+DEX"] },
  },
};
const CLASS_ICON = { Beginner: "🍃", Warrior: "⚔️", Magician: "🔮", Bowman: "🏹", Thief: "🗡️" };

// Attack skills at max level (NiaDB skill pages, checked 2026-11-03).
// pct = damage % (spell power for magic), hits per use, mobs = targets, weapons = which weapons can use it.
const SKILLS = {
  Warrior: [
    { id: "power-strike", name: "Power Strike", lv: 20, pct: 260, hits: 1, mobs: 1, src: "warrior/power-strike" },
    { id: "slash-blast", name: "Slash Blast", lv: 20, pct: 130, hits: 1, mobs: 6, src: "warrior/slash-blast" },
  ],
  Magician: [
    { id: "energy-bolt", name: "Energy Bolt", lv: 20, pct: 130, hits: 1, mobs: 1, mastery: 10, src: "magician/energy-bolt" },
    { id: "magic-claw", name: "Magic Claw", lv: 20, pct: 65, hits: 2, mobs: 1, mastery: 10, src: "magician/magic-claw" },
    { id: "fire-arrow", name: "Fire Arrow (F/P)", lv: 30, pct: 180, hits: 1, mobs: 1, mastery: 10, element: "Fire", src: "f-p-wizard/fire-arrow" },
    { id: "poison-breath", name: "Poison Breath (F/P)", lv: 30, pct: 90, hits: 1, mobs: 6, mastery: 10, element: "Poison", src: "f-p-wizard/poison-breath", note: "Raised by 10 in the Oct 29 patch." },
    { id: "cold-beam", name: "Cold Beam (I/L)", lv: 30, pct: 170, hits: 1, mobs: 1, mastery: 10, element: "Ice", src: "i-l-wizard/cold-beam" },
    { id: "thunder-bolt", name: "Thunder Bolt (I/L)", lv: 30, pct: null, hits: 1, mobs: 6, mastery: 10, element: "Lightning", src: "i-l-wizard/thunder-bolt", note: "Buffed in the Oct 29 patch; the new value isn't published yet. Enter it from your skill tooltip." },
    { id: "holy-arrow", name: "Holy Arrow (Cleric)", lv: 30, pct: 160, hits: 1, mobs: 1, mastery: 10, element: "Holy", src: "cleric/holy-arrow" },
  ],
  Bowman: [
    { id: "arrow-blow", name: "Arrow Blow", lv: 20, pct: 240, hits: 1, mobs: 1, src: "bowman/arrow-blow" },
    { id: "double-shot", name: "Double Shot", lv: 20, pct: 120, hits: 2, mobs: 2, src: "bowman/double-shot" },
    { id: "arrow-bomb", name: "Arrow Bomb (Hunter)", lv: 30, pct: 130, hits: 1, mobs: 6, weapons: ["Bow"], src: "hunter/arrow-bomb-bow" },
    { id: "iron-arrow", name: "Iron Arrow (Crossbowman)", lv: 30, pct: 180, hits: 1, mobs: 6, weapons: ["Crossbow"], src: "crossbowman/iron-arrow-crossbow", note: "Each monster it passes through takes 20% less." },
  ],
  Thief: [
    { id: "lucky-seven", name: "Lucky Seven", lv: 20, pct: 140, hits: 2, mobs: 1, weapons: ["Claw"], lucky7: true, src: "thief/lucky-seven" },
    { id: "double-stab", name: "Double Stab", lv: 20, pct: 160, hits: 2, mobs: 1, weapons: ["Dagger"], motion: "stab", src: "thief/double-stab" },
    { id: "drain", name: "Drain (Assassin)", lv: 30, pct: 240, hits: 1, mobs: 1, weapons: ["Claw"], drain: true, src: "assassin/drain" },
    { id: "savage-blow", name: "Savage Blow (Bandit)", lv: 30, pct: 75, hits: 6, mobs: 1, weapons: ["Dagger"], motion: "stab", src: "bandit/savage-blow" },
  ],
};
const ELEMENTS = ["None", "Fire", "Ice", "Lightning", "Poison", "Holy"];
const DEFAULTS = {
  cls: "Warrior", weapon: "1H Sword", motion: "avg", level: 30, STR: 132, DEX: 30, INT: 4, LUK: 4,
  watk: 47, matk: 0, ap: 0, mastery: 0, skillId: "basic", skill: 100, hits: 1, crit: 5, critdmg: 20,
  element: "None", accExtra: 0, rage: false, precise: false, formula: "majority", near: true, target: "", gear: {}, gearBonus: {}, buffs: {}, potions: [], mobSort: "level",
};

// The calculator edits the active saved character (see app.js). A shared build link
// is shown without touching your characters until you choose to save it.
let calc = { ...DEFAULTS, ...(activeChar().calc || {}) };
let shared = null; // { from: name } while viewing someone's shared build
function saveCalc() {
  if (shared) return;
  activeChar().calc = { ...calc };
  saveChars();
}
function loadCalcFromChar() {
  calc = { ...DEFAULTS, ...(activeChar().calc || {}) };
  if (state.tab === "calc") renderCalc();
  else if (state.tab === "quests") renderTable();
}

// ---------- shareable builds ----------
const BUILD_KEYS = Object.keys(DEFAULTS).filter((k) => !["near", "target", "gear", "gearBonus", "buffs", "potions", "mobSort"].includes(k));
function encodeBuild(name) {
  const o = { n: name };
  for (const k of BUILD_KEYS) if (calc[k] !== DEFAULTS[k]) o[k] = calc[k];
  if (Object.keys(calc.gear).length) o.g = calc.gear;
  if (Object.keys(calc.gearBonus).length) o.b = calc.gearBonus;
  if (Object.keys(calc.buffs).length) o.f = Object.keys(calc.buffs);
  if (calc.potions.length) o.u = calc.potions;
  const p = plan(); if (Object.keys(p).length) o.p = p;
  if (activeChar().job2) o.j = activeChar().job2;
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeBuild(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
}
function readSharedBuild() {
  const s = new URLSearchParams(location.search).get("build");
  if (!s) return false;
  try {
    const o = decodeBuild(s);
    const clean = {};
    for (const k of BUILD_KEYS) if (k in o && typeof o[k] === typeof DEFAULTS[k]) clean[k] = o[k];
    if (!WEAPONS[clean.cls || DEFAULTS.cls]) return false;
    const gear = {};
    for (const [slot, gid] of Object.entries(o.g || {})) if (Number.isInteger(gid)) gear[slot] = gid;
    const gearBonus = {};
    for (const [slot, stats] of Object.entries(o.b || {})) {
      if (!Object.prototype.hasOwnProperty.call(gear, slot) || !stats || typeof stats !== "object") continue;
      const good = Object.entries(stats).filter(([k, v]) => BONUS_STATS.some(([s]) => s === k) && Number.isInteger(v));
      if (good.length) gearBonus[slot] = Object.fromEntries(good);
    }
    const buffs = {};
    for (const name of Array.isArray(o.f) ? o.f : []) if (typeof name === "string") buffs[name] = true;
    const potions = (Array.isArray(o.u) ? o.u : []).filter(Number.isInteger);
    calc = { ...DEFAULTS, ...clean, gear, gearBonus, buffs, potions };
    const sp = {};
    for (const [k, v] of Object.entries(o.p || {})) if (/^\d+$/.test(k) && Number.isInteger(v) && v > 0 && v <= 30) sp[k] = v;
    shared = { from: String(o.n || "A shared build").slice(0, 40), skills: sp, job2: Number(o.j) || null };
    return true;
  } catch { return false; }
}
function leaveShared(save) {
  if (save) {
    const id = "c" + Date.now();
    chars.list.push({ id, name: shared.from, calc: { ...calc }, done: [], skills: { ...shared.skills }, job2: shared.job2 });
    chars.active = id;
    doneSet = new Set();
    shared = null;
    saveChars(); saveCalc();
  } else {
    shared = null;
    calc = { ...DEFAULTS, ...(activeChar().calc || {}) };
  }
  history.replaceState(null, "", location.pathname + location.hash);
  renderCalc();
}
async function shareBuild() {
  const name = activeChar().name;
  const url = `${location.origin}${location.pathname}?build=${encodeBuild(name)}`;
  const status = $("#shareStatus");
  try {
    if (navigator.share) { await navigator.share({ title: `${name}'s build · MapleStory Classic DB`, url }); status.textContent = "Shared."; return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); status.textContent = "Link copied. Paste it anywhere to share."; }
  catch {
    status.innerHTML = `<input class="share-url" id="shareUrl" readonly value="${esc(url)}">`;
    const box = $("#shareUrl"); box.focus(); box.select();
  }
}

function charBar() {
  if (shared) {
    return `<section class="char-bar shared-bar">
      <div><b>Viewing ${esc(shared.from)}'s build</b><span>Changes here aren't saved to your characters.</span></div>
      <div class="char-actions"><button type="button" class="btn" id="sharedSave">Save as my character</button>
      <button type="button" class="btn ghost" id="sharedLeave">Back to mine</button></div></section>`;
  }
  const c = activeChar();
  return `<section class="char-bar">
    <label class="cf"><span>Character</span><select id="charSel">${chars.list.map((x) => `<option value="${x.id}" ${x.id === c.id ? "selected" : ""}>${esc(x.name)}${charSummary(x) ? ` · ${esc(charSummary(x))}` : ""}</option>`).join("")}</select></label>
    <label class="cf"><span>Name</span><input id="charName" value="${esc(c.name)}" maxlength="24" autocomplete="off"></label>
    <div class="char-actions">
      <button type="button" class="btn ghost" id="charNew">+ New</button>
      ${chars.list.length > 1 ? `<button type="button" class="btn ghost danger" id="charDel">Delete</button>` : ""}
      <button type="button" class="btn" id="shareBtn">Share build</button>
    </div>
    <p class="sub small" id="shareStatus" aria-live="polite">Saved in this browser. Each character keeps its own stats and quest progress.</p>
  </section>`;
}
function bindCharBar() {
  if (shared) {
    $("#sharedSave").onclick = () => leaveShared(true);
    $("#sharedLeave").onclick = () => leaveShared(false);
    return;
  }
  $("#charSel").onchange = (e) => switchCharacter(e.target.value);
  $("#charName").oninput = (e) => {
    activeChar().name = e.target.value.trim() || "My character";
    saveChars();
    const opt = $("#charSel").selectedOptions[0];
    if (opt) opt.textContent = activeChar().name + (charSummary(activeChar()) ? ` · ${charSummary(activeChar())}` : "");
  };
  $("#charNew").onclick = () => {
    const id = "c" + Date.now();
    chars.list.push({ id, name: `Character ${chars.list.length + 1}`, calc: { ...DEFAULTS }, done: [] });
    switchCharacter(id);
    $("#charName")?.select();
  };
  const del = $("#charDel");
  if (del) {
    let armed = false;
    del.onclick = () => {
      if (!armed) { armed = true; del.textContent = "Tap again to delete"; setTimeout(() => { armed = false; if (del.isConnected) del.textContent = "Delete"; }, 3000); return; }
      chars.list = chars.list.filter((x) => x.id !== chars.active);
      switchCharacter(chars.list[0].id);
    };
  }
  $("#shareBtn").onclick = shareBuild;
}

const hasSkillData = () => typeof SK !== "undefined" && SK.jobs.length > 0;
const SPELL_ELEMENT = { "Fire Arrow": "Fire", "Poison Breath": "Poison", "Cold Beam": "Ice", "Thunder Bolt": "Lightning", "Holy Arrow": "Holy" };
function currentSkill() {
  if (hasSkillData()) {
    const sk = SK.byId[Number(calc.skillId)];
    return sk && sk.attack ? sk : null;
  }
  return (SKILLS[calc.cls] || []).find((s) => s.id === calc.skillId) || null;
}
function skillsForWeapon() {
  if (hasSkillData()) {
    const magic = !!WEAPONS[calc.cls][calc.weapon].magic, code = WEAPON_CODE[calc.weapon];
    const list = classJobs(calc.cls).flatMap((j) => j.skills)
      .filter((s) => s.attack && s.magic === magic && (!s.weapons.length || s.weapons.includes(code)));
    // the same skill can exist in several 2nd jobs (e.g. Rush): keep the character's own copy
    const job2 = typeof shared !== "undefined" && shared ? shared.job2 : activeChar().job2;
    const byName = new Map();
    for (const s of list) if (!byName.has(s.name) || s.job === job2) byName.set(s.name, s);
    return [...byName.values()];
  }
  return (SKILLS[calc.cls] || []).filter((s) => !s.weapons || s.weapons.includes(calc.weapon));
}
// the character's 2nd job decides which copy of a shared skill (e.g. Sword Mastery) is used
function classSkill(name) {
  const list = (SK.byName[name] || []).filter((s) => classJobs(calc.cls).some((j) => j.job === s.job));
  const c2 = typeof shared !== "undefined" && shared ? null : activeChar().job2;
  return list.find((s) => s.job === c2) || list[0] || null;
}
function masterySkill() { return hasSkillData() ? classSkill(MASTERY_SKILL[calc.weapon]) : null; }

// ---------- gear ----------
// Picked items are added to what's typed in, so the typed numbers stay as they are if the gear changes.
const CLASS_BIT = { Beginner: 0, Warrior: 1, Magician: 2, Bowman: 4, Thief: 8 };
const ARMOR_TILES = [["hat", "Hat", "🎩"], ["top", "Top / Overall", "👕"], ["bottom", "Bottom", "👖"], ["shoes", "Shoes", "👟"], ["gloves", "Gloves", "🧤"], ["cape", "Cape", "🧥"], ["earrings", "Earrings", "💎"], ["shield", "Shield", "🛡️"]];
const NO_SHIELD = new Set(["2H Sword", "2H Axe", "2H Blunt", "Spear", "Polearm", "Bow", "Crossbow", "Claw"]);
const GEAR_FIELD = { STR: "STR", DEX: "DEX", INT: "INT", LUK: "LUK", ATT: "watk", MATT: "matk", ACC: "accExtra", CRIT: "crit", CRITDMG: "critdmg", AP: "ap" };
const GEAR_LABEL = { AP: "Attack Power", ATT: "ATT", MATT: "Magic ATT", ACC: "accuracy", CRIT: "crit rate", CRITDMG: "crit damage", WDEF: "weapon DEF", MDEF: "magic DEF", AVOID: "avoid", SPEED: "speed", JUMP: "jump" };
const AMMO_LABEL = { Claw: "Throwing stars", Bow: "Arrows", Crossbow: "Arrows" };
// [main stat, second stat] for auto-assign; the rest of the AP goes to the main stat
const MAIN_STATS = { Beginner: ["STR", "DEX"], Warrior: ["STR", "DEX"], Magician: ["INT", "LUK"], Bowman: ["DEX", "STR"], Thief: ["LUK", "DEX"] };
// what can be added to a piece of gear by hand: scroll results, or rolling higher or lower than normal
const BONUS_STATS = [["ATT", "Weapon ATT"], ["MATT", "Magic ATT"], ["STR", "STR"], ["DEX", "DEX"], ["INT", "INT"], ["LUK", "LUK"],
  ["ACC", "Accuracy"], ["AVOID", "Avoid"], ["WDEF", "Weapon DEF"], ["MDEF", "Magic DEF"], ["HP", "HP"], ["MP", "MP"], ["SPEED", "Speed"], ["JUMP", "Jump"], ["CRIT", "Crit rate %"], ["CRITDMG", "Crit damage %"]];
const picker = { slot: null, mine: false, list: false };

function gearFor(c, slot) {
  if (slot === "ammo") return (db.ammo || []).filter((a) => a.weapon === c.weapon);
  const bit = CLASS_BIT[c.cls];
  return (db.gear || []).filter((g) => g.slot === slot && (slot !== "weapon" || g.weapon === c.weapon) && (!g.job || g.job & bit));
}
function wornGear(c) {
  return Object.entries(c.gear).flatMap(([slot, gid]) => {
    if (slot === "shield" && NO_SHIELD.has(c.weapon)) return [];
    const it = gearFor(c, slot).find((g) => g.gid === gid);
    return it ? [it] : [];
  });
}
function gearTotals(c) {
  const total = {};
  const add = (stats) => { for (const [k, v] of Object.entries(stats || {})) total[k] = (total[k] || 0) + v; };
  for (const it of wornGear(c)) { add(it.stats); add(c.gearBonus[it.slot]); }
  return total;
}
// ---------- buffs and potions ----------
// Timed skills are switched on or off here. Passive skills count at their planned level.
const SKILL_STATS = { indiePad: "AP", indieMad: "MATT", indieAcc: "ACC", accX: "ACC", indieEva: "AVOID", evaX: "AVOID", crtX: "CRIT", crdX: "CRITDMG",
  indiePdd: "WDEF", indieMdd: "MDEF", indieSpeed: "SPEED", indieJump: "JUMP", mhpR: "HPR", mmpR: "MPR" };
function statSkills() {
  if (!hasSkillData()) return [];
  const code = WEAPON_CODE[calc.weapon];
  const job2 = typeof shared !== "undefined" && shared ? shared.job2 : activeChar().job2;
  const byName = new Map();
  for (const s of classJobs(calc.cls).flatMap((j) => j.skills)) {
    const top = s.levels[s.levels.length - 1] || {};
    if (s.attack || !Object.keys(SKILL_STATS).some((k) => top[k])) continue;
    if (s.weapons.length && !s.weapons.includes(code)) continue;
    if (!byName.has(s.name) || s.job === job2) byName.set(s.name, { skill: s, timed: !!top.time });
  }
  return [...byName.values()];
}
const statSkillLevel = ({ skill, timed }) => (timed ? (calc.buffs[skill.name] ? usedLevel(skill) : 0) : planLevel(skill.id));
function activePotions() { return (db.potions || []).filter((p) => calc.potions.includes(p.gid)); }
function buffTotals() {
  const total = {};
  for (const row of statSkills()) {
    const lv = statSkillLevel(row);
    if (!lv) continue;
    const l = skillAt(row.skill, lv);
    for (const [k, stat] of Object.entries(SKILL_STATS)) if (l[k]) total[stat] = (total[stat] || 0) + l[k];
  }
  // potions for the same stat don't add up: the strongest one counts
  const best = {};
  for (const p of activePotions()) for (const [k, v] of Object.entries(p.stats)) best[k] = k in best ? Math.max(best[k], v) : v;
  for (const [k, v] of Object.entries(best)) total[k] = (total[k] || 0) + v;
  return total;
}
function withGear(c) {
  // crit starts at the game's base values, and a typed attack only stands in when no weapon is picked
  const total = { ...c, crit: 5, critdmg: 20, ap: 0, accExtra: 0 };
  if (wornGear(c).some((g) => g.slot === "weapon")) { total.watk = 0; total.matk = 0; }
  for (const [k, v] of Object.entries(gearTotals(c))) if (GEAR_FIELD[k]) total[GEAR_FIELD[k]] += v;
  for (const [k, v] of Object.entries(buffTotals())) if (GEAR_FIELD[k]) total[GEAR_FIELD[k]] += v;
  return total;
}
function gearStatText(it) {
  const spellWeapon = it.slot === "weapon" && WEAPONS[calc.cls][calc.weapon].magic;
  return Object.entries(it.stats).filter(([k]) => !(spellWeapon && k === "ATT"))
    .map(([k, v]) => `${v > 0 ? "+" : ""}${v}${/CRIT/.test(k) ? "%" : ""} ${GEAR_LABEL[k] || k}`).join(", ");
}
// what's stopping this item being worn, counting stats from the other gear too
function gearNeeds(it, total) {
  const needs = [];
  if (it.level > total.level) needs.push(`Lv ${it.level}`);
  const req = db.gear_info?.[it.gid] || {};
  for (const k of ["STR", "DEX", "INT", "LUK"]) if (req[k] > total[k]) needs.push(`${req[k]} ${k}`);
  return needs;
}
function bonusText(it) {
  const stats = calc.gearBonus[it.slot];
  return stats ? `Bonus ${gearStatText({ slot: "bonus", stats })}` : "";
}
const itemIcon = (gid) => `<img src="assets/item/${gid}.png" alt="" loading="lazy" onerror="this.remove()">`;

function wornIn(slot) {
  const id = (s) => calc.gear[s] && gearFor(calc, s).find((g) => g.gid === calc.gear[s]);
  return slot === "top" ? id("overall") || id("top") : id(slot);
}
function gearTile(slot, label, glyph, wide = false) {
  const it = wornIn(slot);
  const covered = slot === "bottom" && calc.gear.overall;
  return `<button type="button" class="cx-tile ${it ? "on" : ""} ${wide ? "wide" : ""}" data-tile="${slot}" aria-expanded="${picker.slot === slot}" ${covered ? "disabled" : ""}>
    <span class="cx-ico">${it ? itemIcon(it.gid) : `<i>${glyph}</i>`}</span>
    <span class="cx-tile-text"><small>${esc(label)}</small><b>${it ? esc(it.name) : covered ? "Covered by overall" : "Empty"}</b>
      ${it ? `<em>${esc(gearStatText(it))}</em><u class="t-bonus"></u>` : ""}<strong class="t-need"></strong></span></button>`;
}
function setGear(slot, gid) {
  const g = { ...calc.gear };
  // a different item starts with no bonus stats
  if (calc.gear[slot] !== gid) {
    const { [slot]: gone, ...rest } = calc.gearBonus;
    calc.gearBonus = rest;
  }
  if (gid) g[slot] = gid; else delete g[slot];
  if (!gid && slot === "top") delete g.overall;
  if (gid && slot === "overall") { delete g.top; delete g.bottom; }
  if (gid && (slot === "top" || slot === "bottom")) delete g.overall;
  // the attack typed so far was standing in for a weapon, so the real one replaces it
  if (gid && slot === "weapon" && !calc.gear.weapon) { calc.watk = 0; calc.matk = 0; }
  calc.gear = g;
  const tileSlot = slot === "overall" ? "top" : slot;
  // the next thing to do with a new item is often entering its bonus stats
  picker.slot = gid && slot !== "ammo" ? tileSlot : null;
  picker.list = false;
  saveCalc();
  renderCalc();
  const tile = $(`[data-tile="${tileSlot}"]`);
  tile?.focus({ preventScroll: true });
  (picker.slot ? $("#gearPicker") : tile)?.scrollIntoView({ block: "nearest" });
}
function setBonus(it, key, value) {
  const stats = { ...calc.gearBonus[it.slot] };
  if (value) stats[key] = value; else delete stats[key];
  const { [it.slot]: old, ...rest } = calc.gearBonus;
  calc.gearBonus = Object.keys(stats).length ? { ...rest, [it.slot]: stats } : rest;
  saveCalc();
  renderCalcOut();
}
function pickerItems(slot) {
  const list = slot === "top" ? [...gearFor(calc, "top"), ...gearFor(calc, "overall")] : gearFor(calc, slot);
  return list.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
function renderPickerList() {
  const q = ($("#gpSearch")?.value || "").trim().toLowerCase();
  const total = withGear(calc);
  const current = wornIn(picker.slot);
  const rows = pickerItems(picker.slot).filter((g) => (!q || g.name.toLowerCase().includes(q)) && (!picker.mine || g.level <= calc.level));
  $("#gpList").innerHTML = (current ? `<button type="button" class="cx-pick-row clear" data-gid="" data-real="${picker.slot}"><span class="cx-ico"><i>✕</i></span><span><b>Take it off</b></span></button>` : "") +
    (rows.map((g) => {
      const needs = gearNeeds(g, total);
      return `<button type="button" class="cx-pick-row ${current?.gid === g.gid ? "on" : ""}" data-gid="${g.gid}" data-real="${g.slot}">
        <span class="cx-ico">${itemIcon(g.gid)}</span>
        <span><b>${esc(g.name)}</b><small>${g.level ? `Lv ${g.level}` : "No level needed"}${g.stats && gearStatText(g) ? ` · ${esc(gearStatText(g))}` : ""}</small>${needs.length ? `<strong>Needs ${esc(needs.join(", "))}</strong>` : ""}</span></button>`;
    }).join("") || `<p class="sub empty">Nothing matches.</p>`);
}
function bonusField(it, key, label) {
  const normal = it.stats[key];
  const value = calc.gearBonus[it.slot]?.[key];
  return `<label class="cx-bonus-field"><span>${label}${normal ? ` <small>normal ${normal > 0 ? "+" : ""}${normal}</small>` : ""}</span>
    <input type="number" data-bonus="${key}" step="1" placeholder="0" value="${value || ""}" aria-label="Bonus ${label}"></label>`;
}
function renderBonus(box, it) {
  const main = WEAPONS[calc.cls][calc.weapon].magic ? ["MATT", "INT", "LUK", "ATT", "STR", "DEX"] : ["ATT", "STR", "DEX", "INT", "LUK", "MATT"];
  const label = (k) => BONUS_STATS.find(([s]) => s === k)[1];
  const more = BONUS_STATS.filter(([k]) => !main.includes(k));
  const moreSet = more.some(([k]) => calc.gearBonus[it.slot]?.[k]);
  box.innerHTML = `<div class="cx-bonus-head"><span class="cx-ico">${itemIcon(it.gid)}</span><b>${esc(it.name)}</b>
      <button type="button" class="cx-pick-close" id="gpClose" aria-label="Close">✕</button></div>
    <p class="cf-note">Scrolled it, or got a better or worse roll? Enter the difference here, like +14 Magic ATT from scrolls. Use a minus for a lower roll. It's added to your damage.</p>
    <div class="cx-bonus-grid">${main.map((k) => bonusField(it, k, label(k))).join("")}</div>
    <details class="cx-bonus-more" ${moreSet ? "open" : ""}><summary>More stats</summary>
      <div class="cx-bonus-grid">${more.map(([k, l]) => bonusField(it, k, l)).join("")}</div></details>
    <div class="cx-bonus-actions"><button type="button" class="cx-auto" id="gpChange">Change item</button>
      <button type="button" class="cx-auto" id="gpClear">Clear bonus</button>
      <button type="button" class="cx-auto" id="gpOff">Take it off</button></div>`;
  box.querySelectorAll("[data-bonus]").forEach((el) => el.addEventListener("input", () => setBonus(it, el.dataset.bonus, parseInt(el.value, 10) || 0)));
  $("#gpChange").addEventListener("click", () => { picker.list = true; renderPicker(); });
  $("#gpClear").addEventListener("click", () => {
    const { [it.slot]: gone, ...rest } = calc.gearBonus;
    calc.gearBonus = rest;
    saveCalc();
    renderPicker();
    renderCalcOut();
  });
  $("#gpOff").addEventListener("click", () => setGear(picker.slot === "top" ? "top" : it.slot, 0));
  $("#gpClose").addEventListener("click", () => closePicker());
}
function renderPicker() {
  const box = $("#gearPicker");
  if (!box) return;
  document.querySelectorAll("[data-tile]").forEach((t) => {
    const on = t.dataset.tile === picker.slot;
    t.classList.toggle("open", on);
    t.setAttribute("aria-expanded", on);
  });
  box.hidden = !picker.slot;
  box.onkeydown = (e) => { if (e.key === "Escape") closePicker(); };
  if (!picker.slot) { box.innerHTML = ""; return; }
  const worn = wornIn(picker.slot);
  if (worn && picker.slot !== "ammo" && !picker.list) {
    renderBonus(box, worn);
    box.scrollIntoView({ block: "nearest" });
    return;
  }
  box.innerHTML = `<div class="cx-pick-head">
      <input id="gpSearch" type="search" placeholder="Search items…" autocomplete="off" aria-label="Search items">
      <label class="check"><input id="gpMine" type="checkbox" ${picker.mine ? "checked" : ""}> Up to my level</label>
      <button type="button" class="cx-pick-close" id="gpClose" aria-label="Close">✕</button>
    </div><div class="cx-pick-list" id="gpList"></div>`;
  renderPickerList();
  $("#gpSearch").addEventListener("input", renderPickerList);
  $("#gpMine").addEventListener("change", (e) => { picker.mine = e.target.checked; renderPickerList(); });
  $("#gpClose").addEventListener("click", () => closePicker());
  $("#gpList").addEventListener("click", (e) => {
    const row = e.target.closest("[data-gid]");
    if (row) setGear(row.dataset.real, Number(row.dataset.gid) || 0);
  });
  box.scrollIntoView({ block: "nearest" });
  // no keyboard popping up on phones until someone taps the search box
  if (!isPhone()) $("#gpSearch").focus({ preventScroll: true });
}
function closePicker() {
  const slot = picker.slot;
  picker.slot = null;
  picker.list = false;
  renderPicker();
  $(`[data-tile="${slot}"]`)?.focus({ preventScroll: true });
}

// ---------- stats that come from the character sheet ----------
const AP_AT = (level) => 25 + 5 * (level - 1);
const GROWTH = { Warrior: [28, 12, 350, 150], Bowman: [22, 17, 250, 250], Thief: [22, 17, 250, 250], Magician: [16, 22, 150, 350] };
function baseHpMp(cls, level) {
  if (!GROWTH[cls]) return [50 + 16 * (level - 1), 5 + 12 * (level - 1)];
  const [hpL, mpL, hpA, mpA] = GROWTH[cls];
  const b = Math.min(level, 10) - 1, n = Math.max(0, level - 10), a = level >= 30 ? 2 : 1;
  return [50 + 16 * b + hpA * a + hpL * n, 5 + 12 * b + mpA * a + mpL * n];
}
function expToNext(level) {
  if (level <= 5) return (Math.floor(level * level / 2) + 15) * level;
  if (level <= 50) { const q = Math.floor(level * level / 3); return (q + 19) * q; }
  return Math.trunc(expToNext(level - 1) * (level <= 89 ? 1.0548 : 2.1));
}
function sheet(c) {
  const g = gearTotals(calc), b = buffTotals();
  const both = (k) => (g[k] || 0) + (b[k] || 0);
  const [hp, mp] = baseHpMp(c.cls, c.level);
  return {
    hp: Math.trunc(hp * (1 + (b.HPR || 0) / 100)) + both("HP"),
    mp: Math.trunc(mp * (1 + (b.MPR || 0) / 100)) + both("MP"),
    wdef: Math.floor(c.STR / 4) + both("WDEF"),
    mdef: Math.floor(c.INT / 4) + both("MDEF"),
    avoid: Math.floor(c.LUK / 3) + Math.floor(c.DEX / 6) + 5 + both("AVOID"),
    magic: Math.floor(c.INT / 2) + c.matk,
    speed: both("SPEED"),
    jump: both("JUMP"),
  };
}
function autoAssign() {
  const [main] = MAIN_STATS[calc.cls];
  const bonus = gearTotals(calc);
  const base = { STR: 4, DEX: 4, INT: 4, LUK: 4 };
  for (const it of wornGear(calc)) {
    const req = db.gear_info?.[it.gid] || {};
    for (const k of Object.keys(base)) base[k] = Math.max(base[k], (req[k] || 0) - (bonus[k] || 0));
  }
  base[main] += Math.max(0, AP_AT(calc.level) - Object.values(base).reduce((a, b) => a + b, 0));
  Object.assign(calc, base);
  saveCalc();
  renderCalc();
}
// the parts of the form that follow the level and stats
function refreshBuild() {
  const total = withGear(calc);
  const worn = (slot) => wornIn(slot);
  document.querySelectorAll("[data-tile]").forEach((t) => {
    const it = worn(t.dataset.tile);
    const needs = it ? gearNeeds(it, total) : [];
    t.classList.toggle("warn", needs.length > 0);
    t.querySelector(".t-need").textContent = needs.length ? `Needs ${needs.join(", ")}` : "";
    const bonus = t.querySelector(".t-bonus");
    if (bonus) bonus.textContent = it ? bonusText(it) : "";
  });
  const weaponless = !calc.gear.weapon && !(isSpell(calc) ? calc.matk : calc.watk);
  $("#gearNote").textContent = weaponless ? "Pick your weapon, or type its attack in the box above."
    : wornGear(calc).some((g) => g.slot !== "ammo") ? "Tap a worn item to add scroll bonuses or a better or worse roll." : "";
  const used = calc.STR + calc.DEX + calc.INT + calc.LUK, all = AP_AT(calc.level);
  const hasGear = wornGear(calc).length > 0;
  $("#apBar").style.width = `${Math.min(100, (used / all) * 100)}%`;
  $("#apBar").classList.toggle("over", used > all && hasGear);
  $("#apText").innerHTML = `<b>${used}</b> of ${all} AP at level ${calc.level}`;
  $("#apHint").textContent = used > all
    ? (hasGear ? `${used - all} AP over. Quest rewards or scrolls can explain a little of that.` : "That's more than your AP, so it must include your gear. That's fine if you haven't picked any.")
    : used < all ? `${all - used} AP left to spend.` : "All your AP is spent.";
  const slider = $("#levelR");
  if (slider && Number(slider.value) !== calc.level) slider.value = calc.level;
}

// ---------- damage math ----------
function masteryFactor(level, formula) {
  return (level / 10 + 0.1) * (formula === "wiki" ? 0.8 : 0.7);
}
function totalAP(c) { return c.ap; }
function critRate(c) { return c.crit; }
// physical mastery comes from the planned level of the weapon's Mastery skill
function physMastery(c) {
  if (WEAPONS[c.cls][c.weapon].magic) return 0; // no mastery skill for a wand or staff's physical hit
  const ms = masterySkill();
  if (!ms) return hasSkillData() ? 0 : c.mastery;
  return skillAt(ms, planLevel(ms.id)).mastery || 0;
}

function isSpell(c) { return !!WEAPONS[c.cls][c.weapon].magic && c.skillId !== "basic"; }

function rawRange(c) {
  const sk = currentSkill();
  const S = c.skill / 100;
  const w = WEAPONS[c.cls][c.weapon];
  if (isSpell(c)) {
    const m = masteryFactor(c.mastery, "majority");
    const total = Math.floor(c.INT / 2) + c.matk;
    return { min: S * total * (1 + (c.INT * m) / 125), max: S * total * (1 + c.INT / 125), magic: true };
  }
  const val = (k) => (k === "STR+DEX" ? c.STR + c.DEX : c[k]);
  const P = val(w.stats[0]), Q = val(w.stats[1]);
  const motion = sk?.rule?.motion || sk?.motion || c.motion;
  let M = w.shoot ?? (motion === "swing" ? w.mult[0] : motion === "stab" ? w.mult[1] : 0.6 * w.mult[0] + 0.4 * w.mult[1]);
  let m = masteryFactor(physMastery(c), c.formula);
  const rule = sk?.rule || sk || {};
  if (rule.lucky7) { M = 3.0; m = 0.5; }
  if (rule.drain) M = 2.5;
  const A = (c.formula === "wiki" ? 1 : 2) * totalAP(c);
  return {
    min: S * c.watk * (0.8 + (P * m * M + Q + A) / 100),
    max: S * c.watk * (1.0 + (P * M + Q + A) / 100),
    magic: false,
  };
}

function elementMult(mob, el) {
  if (!el || el === "None") return 1;
  if (mob.weak && mob.weak.split(/,\s*/).includes(el)) return 1.25;
  if (mob.resist && mob.resist.split(/,\s*/).includes(el)) return 0.75;
  return 1;
}
function levelScale(mobLv, playerLv) {
  const gap = mobLv - playerLv;
  if (gap <= 0) return 1;
  return gap < 10 ? 1 / (1 + gap * gap * 0.005) : 1 / (1 + gap * 0.05);
}
const clampDmg = (v) => Math.max(1, Math.min(99999, Math.floor(v)));

function vsMonster(r, c, mob) {
  const def = r.magic ? mob.mdef || 0 : mob.wdef || 0;
  const el = elementMult(mob, r.magic ? c.element : "None");
  const k = (100 / (def + 100)) * el * levelScale(mob.level, c.level);
  const min = clampDmg(r.min * k), max = clampDmg(r.max * k);
  const avg = ((min + max) / 2) * (1 + (critRate(c) / 100) * (c.critdmg / 100));
  return { min, max, avg, el, def };
}

// ---------- accuracy (NiaDB / MS-Classic) ----------
function accuracy(c) {
  const common = 1.2 * c.DEX + 2 * c.level + 0.6 * c.LUK;
  const base = {
    Beginner: common / 2.5 + 5, Warrior: common / 2.5 + 10, Bowman: common / 4.8 + 20, Thief: common / 4 + 15,
    Magician: (1.2 * c.INT + 2 * c.level + 0.6 * c.LUK) / 5.1 + 20,
  }[c.cls];
  const ms = hasSkillData() ? masterySkill() : null;
  return Math.floor(base) + c.accExtra + (ms ? skillAt(ms, planLevel(ms.id)).x || 0 : 0);
}
function hitChance(acc, playerLv, mob) {
  const L = Math.max(0, mob.level - playerLv);
  const A = (acc * 100) / (10 * L + 255);
  const eva = mob.avoid || 0;
  if (A <= 0) return 0;
  const D = A - eva;
  if (D >= 25 + L * (0.5 * playerLv + 15)) return 1;
  const f = 0.15 + 0.2 / (1 + Math.exp(D / 12));
  const q = eva / A;
  if (q <= 1 - f) return 1;
  if (q >= 1 + f) return 0;
  return (1 + f - q) / (2 * f);
}
function accFor100(playerLv, mob) {
  let lo = 0, hi = 2000;
  if (hitChance(hi, playerLv, mob) < 1) return null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; hitChance(mid, playerLv, mob) >= 1 ? (hi = mid) : (lo = mid); }
  return hi;
}

function matchup(r, c, mob) {
  const d = vsMonster(r, c, mob);
  const p = hitChance(accuracy(c), c.level, mob);
  const perUse = d.avg * c.hits;
  const uses = Math.max(1, Math.ceil(mob.hp / perUse));
  const worst = Math.ceil(mob.hp / Math.max(1, d.min * c.hits));
  const withMiss = p > 0 ? Math.ceil(uses / p) : Infinity;
  let verdict;
  if (p < 0.5) verdict = ["bad", "Hard to hit", "You'll miss most attacks. Raise accuracy first."];
  else if (withMiss <= 1) verdict = ["great", "One-shot", "Dies in a single " + (c.hits > 1 ? "use" : "hit") + "."];
  else if (withMiss <= 3) verdict = ["great", "Easy", "A great training target."];
  else if (withMiss <= 6) verdict = ["good", "Good", "Comfortable to fight."];
  else if (withMiss <= 12) verdict = ["ok", "Slow", "Doable, but it takes a while."];
  else verdict = ["bad", "Too tough", "Takes too many hits for normal training."];
  return { ...d, p, uses, worst, withMiss, verdict, need100: accFor100(c.level, mob) };
}

// ---------- page ----------
function num(id, label, min = 0, max = 99999, hint = "") {
  return `<label class="cf"><span>${label}</span><input type="number" id="c_${id}" min="${min}" max="${max}" value="${esc(calc[id])}" inputmode="numeric">${hint ? `<small>${hint}</small>` : ""}</label>`;
}
function sel(id, label, options, wide = true) {
  return `<label class="cf ${wide ? "full" : ""}"><span>${label}</span><select id="c_${id}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(calc[id]) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
}
function calcMonsters() {
  return db.monsters.filter((m) => !m.variant && m.level < 200 && !m.name.startsWith("Tutorial") && (m.drops.length || idx.spawnsOf[m.id]))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function applySkill() {
  const sk = currentSkill();
  if (!sk) { if (calc.skillId === "basic") { calc.skill = 100; calc.hits = 1; calc.element = "None"; } return; }
  if (sk.levels) {
    const l = skillAt(sk, usedLevel(sk));
    calc.skill = l.damage || l.mad || 100;
    calc.hits = skillHits(l);
    if (sk.magic) { calc.mastery = l.mastery || 0; calc.element = SPELL_ELEMENT[sk.name] || "None"; }
    return;
  }
  if (sk.pct != null) calc.skill = sk.pct;
  calc.hits = sk.hits;
  if (sk.mastery != null) calc.mastery = sk.mastery;
  if (sk.element) calc.element = sk.element;
}

function renderCalc() {
  const view = $("#calcView");
  if (!WEAPONS[calc.cls][calc.weapon]) calc.weapon = Object.keys(WEAPONS[calc.cls])[0];
  if (calc.skillId !== "basic" && calc.skillId !== "custom" && !skillsForWeapon().some((s) => String(s.id) === String(calc.skillId))) {
    calc.skillId = defaultSkill();
    applySkill();
  }
  // gear this class or weapon can't use comes off
  const wearable = {};
  for (const [slot, gid] of Object.entries(calc.gear)) if (gearFor(calc, slot).some((g) => g.gid === gid)) wearable[slot] = gid;
  calc.gear = wearable;
  calc.gearBonus = Object.fromEntries(Object.entries(calc.gearBonus).filter(([slot]) => wearable[slot]));
  const w = WEAPONS[calc.cls][calc.weapon];
  const magic = isSpell(calc);
  const sk = currentSkill();
  const hasGear = wornGear(calc).length > 0;
  const armor = ARMOR_TILES.filter(([slot]) => !(slot === "shield" && NO_SHIELD.has(calc.weapon)));
  const attackBox = magic ? num("matk", "Magic Attack", 0, 9999, "No weapon picked? Type its Magic Attack.") : num("watk", "Weapon Attack", 0, 9999, "No weapon picked? Type its attack.");
  const skillOpts = [["basic", w.magic ? "Regular attack (physical hit)" : "Regular attack (100%)"],
    ...skillsForWeapon().map((s) => [s.id, s.levels ? `${s.name}${s.jobName !== calc.cls ? ` · ${s.jobName.replace(/^Wizard \((.+)\)$/, "$1")}` : ""}` : `${s.name} · Lv ${s.lv}${s.pct != null ? ` · ${s.pct}%${s.hits > 1 ? ` ×${s.hits}` : ""}` : ""}`]),
    ["custom", "Custom (type the % yourself)"]];
  const ms = masterySkill();
  const mobs = calcMonsters();
  view.innerHTML = `
    <section class="cx-intro">
      <div><h2>Damage calculator</h2>
        <p>Build your character, wear your gear, and see what you can fight.</p></div>
      <div class="cx-jobs" role="radiogroup" aria-label="Class">
        ${Object.keys(WEAPONS).map((k) => `<button type="button" class="cx-job ${calc.cls === k ? "on" : ""}" data-cls="${k}" role="radio" aria-checked="${calc.cls === k}"><span>${CLASS_ICON[k]}</span>${k}</button>`).join("")}
      </div>
    </section>
    ${charBar()}
    <div class="calc-grid">
      <form class="calc-form" onsubmit="return false">
        <fieldset><legend>Level</legend>
          <div class="cx-level full">
            <input type="range" id="levelR" min="1" max="120" value="${Math.min(calc.level, 120)}" aria-label="Level slider">
            ${num("level", "Level", 1, 200)}
          </div>
        </fieldset>
        ${db.gear?.length ? `<section class="cx-gear" aria-label="Equipment">
          <h3>Equipment</h3>
          <div class="cx-tiles">
            ${sel("weapon", "Weapon type", Object.keys(WEAPONS[calc.cls]).map((k) => [k, k]))}
            ${gearTile("weapon", "Weapon", "⚔️", true)}
            ${AMMO_LABEL[calc.weapon] && db.ammo?.length ? gearTile("ammo", AMMO_LABEL[calc.weapon], "🎯", true) : ""}
            ${armor.map(([slot, label, glyph]) => gearTile(slot, label, glyph)).join("")}
          </div>
          <div id="gearPicker" class="cx-picker" hidden></div>
          ${calc.gear.weapon ? "" : `<div class="cx-typed">${attackBox}</div>`}
          <p class="cf-note" id="gearNote"></p>
        </section>` : `<fieldset><legend>Weapon</legend>${sel("weapon", "Weapon type", Object.keys(WEAPONS[calc.cls]).map((k) => [k, k]))}${attackBox}<p class="cf-note full" id="gearNote"></p></fieldset>`}
        ${w.mult && w.mult[0] !== w.mult[1] && !sk?.rule?.motion && !sk?.motion ? `<fieldset><legend>Attack motion</legend>${sel("motion", "Swing or stab", [["avg", "Average (60% swing / 40% stab)"], ["swing", "Swing"], ["stab", "Stab"]])}</fieldset>` : ""}
        <fieldset><legend>${hasGear ? "Base stats (without gear)" : "Stats"}</legend>
          <div class="cx-ap full"><div class="cx-ap-top"><span id="apText"></span><button type="button" class="cx-auto" id="apAuto">Auto-assign</button></div>
            <div class="cx-ap-track"><div id="apBar"></div></div><small id="apHint"></small></div>
          ${num("STR", "STR")}${num("DEX", "DEX")}${num("INT", "INT")}${num("LUK", "LUK")}
          <p class="cf-note full">${hasGear ? "The gear you picked is added to these for you." : "Pick your gear above and enter your stats without it, or leave it empty and enter your totals."}</p>
        </fieldset>
        <fieldset><legend>Skill</legend>
          ${sel("skillId", "Skill", skillOpts)}
          ${sk?.levels ? `<label class="cf"><span>Skill level</span><input type="number" id="c_skLv" min="1" max="${sk.max}" value="${usedLevel(sk)}" inputmode="numeric"><small>1–${sk.max}. Saved to your skill plan.</small></label>` : ""}
          ${num("skill", magic ? "Spell power" : "Damage %", 1, 9999, sk?.levels ? (sk.note ? esc(sk.note) : "From the game files") : sk ? `<a href="${NIADB}${sk.src}" target="_blank" rel="noopener">Max level value · NiaDB ↗</a>${sk.note ? ` ${esc(sk.note)}` : ""}` : calc.skillId === "custom" ? "From your skill's tooltip" : "")}
          ${num("hits", "Hits per use", 1, 10)}
          ${!magic ? "" : calc.skillId === "custom" ? sel("element", "Spell element", ELEMENTS.map((e) => [e, e]), false)
            : calc.element !== "None" ? `<p class="cf-note full">${esc(calc.element)} spell: monsters weak to it take 25% more, and ones that resist it take 25% less.</p>` : ""}
          ${!magic && ms ? `<label class="cf"><span>${esc(ms.name)} level</span><input type="number" id="c_msLv" min="0" max="${ms.max}" value="${planLevel(ms.id)}" inputmode="numeric"><small>0–${ms.max} · mastery ${physMastery(calc)}, +${skillAt(ms, planLevel(ms.id)).x || 0} accuracy</small></label>`
            : magic && calc.skillId === "custom" ? num("mastery", "Spell mastery", 0, 10, "0–10. From your skill's tooltip") : ""}
          ${sk?.mobs > 1 ? `<p class="cf-note full">Hits up to ${sk.mobs} monsters at once.</p>` : ""}
        </fieldset>
        <fieldset><legend>Buffs and potions</legend>
          ${buffRows()}
          ${db.potions?.length ? `<details class="cx-potions full" ${calc.potions.length ? "open" : ""}><summary>Potions and food${calc.potions.length ? ` (${calc.potions.length} on)` : ""}</summary>
            ${db.potions.map((p) => `<label class="cx-buff-main cx-potion"><input type="checkbox" data-potion="${p.gid}" ${calc.potions.includes(p.gid) ? "checked" : ""}>
              <span class="cx-ico">${itemIcon(p.gid)}</span><span><b>${esc(p.name)}</b><small>${esc(gearStatText({ slot: "potion", stats: p.stats }))} · ${p.minutes} min</small></span></label>`).join("")}
            <p class="cf-note">If two raise the same stat, only the strongest counts.</p></details>` : ""}
        </fieldset>
        <details class="calc-more"><summary>Damage formula</summary>
          <fieldset>
            ${sel("formula", "Formula version", [["majority", "NiaDB / most sites (default)"], ["wiki", "MapleClassic Wiki"]])}
            <p class="cf-note full">Sources disagree on two small details (mastery ×0.7 vs ×0.8, Attack Power counted twice vs once).${magic ? " Spells always use the NiaDB formula." : ""} If you test in game, let us know which matches!</p>
          </fieldset>
        </details>
      </form>
      <div class="calc-out">
        <div id="calcSummary"></div>
        <section class="calc-card" id="calcSheet"></section>
        <section class="calc-card">
          <div class="card-head"><h3>Fight a monster</h3>
            <select id="c_target" aria-label="Pick a monster"><option value="">Pick a monster…</option>
              ${mobs.map((m) => `<option value="${m.id}" ${calc.target === m.id ? "selected" : ""}>Lv ${m.level} · ${esc(m.name)}${m.boss ? " (boss)" : ""}</option>`).join("")}
            </select></div>
          <div id="calcMatch"></div>
        </section>
        <section class="calc-card" id="calcBest"></section>
        <section class="calc-card" id="calcMatchCard">
          <div class="card-head"><h3>Every monster</h3>
            <select id="c_mobSort" aria-label="Sort monsters">
              ${[["level", "By level"], ["exp", "Most EXP per attack"], ["fast", "Fewest attacks"]].map(([v, t]) => `<option value="${v}" ${calc.mobSort === v ? "selected" : ""}>${t}</option>`).join("")}
            </select>
            <label class="check"><input type="checkbox" id="c_near" ${calc.near ? "checked" : ""}> Near my level only</label></div>
          <div id="calcTable"></div>
        </section>
      </div>
    </div>
    <button type="button" id="calcBar" class="calc-bar" aria-label="Jump to results"></button>`;

  bindCharBar();
  view.querySelectorAll("[data-tile]").forEach((t) => t.addEventListener("click", () => {
    picker.slot = picker.slot === t.dataset.tile ? null : t.dataset.tile;
    picker.list = false;
    renderPicker();
  }));
  $("#apAuto").addEventListener("click", autoAssign);
  $("#levelR").addEventListener("input", (e) => {
    calc.level = Number(e.target.value);
    $("#c_level").value = calc.level;
    saveCalc();
    renderCalcOut();
  });
  view.querySelectorAll("[data-plan]").forEach((el) => {
    const s = SK.byId[Number(el.dataset.plan)];
    const shownLevel = () => (el.dataset.timed ? usedLevel(s) : planLevel(s.id));
    el.addEventListener("input", () => {
      setPlanLevel(s.id, Number(el.value) || 0);
      const lv = shownLevel();
      el.closest(".cx-buff").querySelector("small").textContent = lv ? describeLevel(s, skillAt(s, lv)) : "Not learned";
      renderCalcOut();
    });
    el.addEventListener("blur", () => { el.value = shownLevel(); });
  });
  view.querySelectorAll("[data-buff]").forEach((el) => el.addEventListener("change", () => {
    const { [el.dataset.buff]: gone, ...rest } = calc.buffs;
    calc.buffs = el.checked ? { ...rest, [el.dataset.buff]: true } : rest;
    saveCalc();
    renderCalcOut();
  }));
  view.querySelectorAll("[data-potion]").forEach((el) => el.addEventListener("change", () => {
    const gid = Number(el.dataset.potion);
    calc.potions = el.checked ? [...calc.potions, gid] : calc.potions.filter((p) => p !== gid);
    saveCalc();
    renderCalcOut();
    const summary = el.closest("details").querySelector("summary");
    summary.textContent = `Potions and food${calc.potions.length ? ` (${calc.potions.length} on)` : ""}`;
  }));
  const skLv = $("#c_skLv");
  if (skLv) {
    // the box has to stay put while typing: empty just means the next digit is coming
    skLv.addEventListener("input", () => {
      const v = parseInt(skLv.value, 10);
      if (!v) return;
      setPlanLevel(currentSkill().id, v);
      applySkill();
      saveCalc();
      for (const k of ["skill", "hits", "mastery", "element"]) { const el = $(`#c_${k}`); if (el) el.value = calc[k]; }
      renderCalcOut();
    });
    skLv.addEventListener("blur", () => { const s = currentSkill(); if (s) skLv.value = usedLevel(s); });
  }
  const msLv = $("#c_msLv");
  if (msLv) msLv.addEventListener("input", () => { setPlanLevel(masterySkill().id, Number(msLv.value) || 0); renderCalcOut(); msLv.parentElement.querySelector("small").textContent = `0–${masterySkill().max} · mastery ${physMastery(calc)}, +${skillAt(masterySkill(), planLevel(masterySkill().id)).x || 0} accuracy`; });
  view.querySelectorAll(".cx-job").forEach((b) => b.addEventListener("click", () => {
    calc.cls = b.dataset.cls;
    calc.weapon = Object.keys(WEAPONS[calc.cls])[0];
    calc.skillId = defaultSkill();
    applySkill();
    picker.slot = null;
    saveCalc(); renderCalc();
  }));
  view.querySelectorAll(".calc-form input:not([data-plan]):not([data-buff]):not([data-potion]):not(#c_skLv):not(#c_msLv):not(#levelR), .calc-form select, #c_target, #c_near, #c_mobSort").forEach((el) => el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
    const id = el.id.slice(2);
    if (["level", "hits"].includes(id) && !Number(el.value)) return; // still typing
    calc[id] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value) || 0;
    if (id === "skillId") applySkill();
    if (["skill", "hits"].includes(id) && currentSkill()) calc.skillId = "custom";
    saveCalc();
    if (["weapon", "skillId"].includes(id)) renderCalc(); else renderCalcOut();
  }));
  for (const id of ["level", "hits"]) $(`#c_${id}`)?.addEventListener("blur", (e) => { if (!Number(e.target.value)) e.target.value = calc[id]; });
  renderPicker();
  renderCalcOut();
}

function defaultSkill() {
  if (!WEAPONS[calc.cls][calc.weapon].magic) return "basic";
  const first = skillsForWeapon()[0];
  return first ? String(first.id) : "basic";
}

function buffRow(row) {
  const { skill: s, timed } = row;
  const lv = timed ? usedLevel(s) : planLevel(s.id);
  const desc = lv ? describeLevel(s, skillAt(s, lv)) : "Not learned";
  return `<div class="cx-buff full">
    ${timed ? `<label class="cx-buff-main"><input type="checkbox" data-buff="${esc(s.name)}" ${calc.buffs[s.name] ? "checked" : ""}><span><b>${esc(s.name)}</b><small>${esc(desc)}</small></span></label>`
      : `<div class="cx-buff-main"><span><b>${esc(s.name)}</b><small>${esc(desc)}</small></span></div>`}
    <label class="cx-buff-lv"><span>Lv</span><input type="number" data-plan="${s.id}" data-timed="${timed ? 1 : ""}" min="0" max="${s.max}" value="${lv}" inputmode="numeric" aria-label="${esc(s.name)} level"></label>
  </div>`;
}
function buffRows() {
  const rows = statSkills();
  const on = rows.filter((r) => r.timed), always = rows.filter((r) => !r.timed);
  return (on.length ? `<p class="cx-buff-title full">Turn on your buffs</p>${on.map(buffRow).join("")}` : "") +
    (always.length ? `<p class="cx-buff-title full">Passive skills, set their level</p>${always.map(buffRow).join("")}` : "");
}

function verdictBadge(v) { return `<span class="verdict ${v[0]}">${v[1]}</span>`; }

function activeBuffNames() {
  return [...statSkills().filter((r) => r.timed && calc.buffs[r.skill.name]).map((r) => r.skill.name), ...activePotions().map((p) => p.name)];
}
function renderCalcOut() {
  const c = withGear(calc);
  refreshBuild();
  const r = rawRange(c);
  const acc = accuracy(c);
  const cr = critRate(c);
  const avgRaw = ((r.min + r.max) / 2) * (1 + (cr / 100) * (c.critdmg / 100));
  const sk = currentSkill();
  const skillName = sk ? sk.name : c.skillId === "custom" ? `Custom ${c.skill}%` : "Regular attack";
  const lo = clampDmg(r.min), hi = clampDmg(r.max), top = clampDmg(r.max * (1 + c.critdmg / 100));
  const pos = (v) => `${Math.max(0, Math.min(100, (v / Math.max(1, top)) * 100)).toFixed(1)}%`;
  $("#calcSummary").innerHTML = `
    <section class="cx-dmg">
      <div class="cx-dmg-top"><span>${esc(skillName)}${c.hits > 1 ? ` · ${c.hits} hits` : ""}</span><span>${esc(c.cls)} · Lv ${c.level} · ${esc(c.weapon)}</span></div>
      <div class="cx-dmg-num">${fmt(lo)}<i>–</i>${fmt(hi)}</div>
      <div class="cx-range" aria-hidden="true">
        <div class="cx-range-hit" style="left:${pos(lo)};right:calc(100% - ${pos(hi)})"></div>
        <div class="cx-range-crit" style="left:${pos(hi)};right:0"></div>
      </div>
      <div class="cx-range-labels" aria-hidden="true"><span>0</span><span>max crit ${fmt(top)}</span></div>
      <div class="cx-dmg-stats">
        <div><b>${fmt(Math.round(avgRaw * c.hits))}</b><span>avg per ${c.hits > 1 ? "use" : "hit"}</span></div>
        <div><b>${acc}</b><span>accuracy</span></div>
        <div><b>${cr}%</b><span>crit rate</span></div>
        <div><b>${c.critdmg}%</b><span>crit damage</span></div>
      </div>
      <p>Before monster defense. ${r.magic ? "Spells use INT and Magic Attack." : ""}${activeBuffNames().length ? ` With ${esc(activeBuffNames().join(", "))}.` : ""}</p>
    </section>`;

  const fs = sheet(c);
  const bonus = gearTotals(calc);
  const stat = (k) => `<div class="cx-stat main"><span>${k}</span><b>${fmt(c[k])}</b>${bonus[k] ? `<small>+${bonus[k]} gear</small>` : ""}</div>`;
  const line = (label, value) => `<div class="cx-stat"><span>${label}</span><b>${value}</b></div>`;
  $("#calcSheet").innerHTML = `<div class="card-head"><h3>Character sheet</h3></div>
    <div class="cx-sheet">
      ${["STR", "DEX", "INT", "LUK"].map(stat).join("")}
      ${line("HP", fmt(fs.hp))}${line("MP", fmt(fs.mp))}
      ${line("Weapon ATT", fmt(c.watk))}${line("Magic", fmt(fs.magic))}
      ${line("Attack Power", fmt(totalAP(c)))}${line("Avoid", fmt(fs.avoid))}
      ${line("Weapon DEF", fmt(fs.wdef))}${line("Magic DEF", fmt(fs.mdef))}
      ${fs.speed ? line("Speed", `+${fs.speed}`) : ""}${fs.jump ? line("Jump", `+${fs.jump}`) : ""}
    </div>
    <p class="sub small">From your stats, gear, passive skills and the buffs you turned on.</p>`;

  // matchup
  const target = c.target && getEntity("monster", c.target);
  const bar = $("#calcBar");
  if (bar) {
    let tail = "";
    if (target) {
      const mm0 = matchup(r, c, target);
      tail = `<span class="cb-mob">${sprite(target, 28)}<span><b>${esc(target.name)}</b> ${mm0.uses} ${c.hits > 1 ? "uses" : "hits"} · ${Math.round(mm0.p * 100)}% hit</span>${verdictBadge(mm0.verdict)}</span>`;
    }
    bar.innerHTML = `<span class="cb-dmg"><small>${esc(skillName)}</small><b>${fmt(clampDmg(r.min))}–${fmt(clampDmg(r.max))}</b></span>${tail || '<span class="cb-hint">Pick a monster ↓</span>'}`;
    bar.onclick = () => $(target ? "#calcMatch" : "#calcSummary").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (target) {
    const mm = matchup(r, c, target);
    const where = (idx.spawnsOf[target.id] || []).slice(0, 2);
    $("#calcMatch").innerHTML = `
      <div class="match">
        <div class="match-mob">${sprite(target, 90)}<div><b>${link("monster", target.id)}</b><span>Lv ${target.level} · ${fmt(target.hp)} HP</span>${verdictBadge(mm.verdict)}</div></div>
        <div class="match-grid">
          <div><span>Your damage</span><b>${fmt(mm.min)}–${fmt(mm.max)}</b></div>
          <div><span>${c.hits > 1 ? "Uses" : "Hits"} to kill</span><b>${mm.uses}${mm.worst !== mm.uses ? `<small> (worst ${mm.worst})</small>` : ""}</b></div>
          <div><span>Hit chance</span><b class="${mm.p >= 0.99 ? "ok" : mm.p < 0.5 ? "bad" : "warn"}">${Math.round(mm.p * 100)}%</b></div>
          <div><span>Accuracy for 100%</span><b>${mm.need100 ?? "—"}<small> (you: ${acc})</small></b></div>
          <div><span>${r.magic ? "Magic" : "Weapon"} defense</span><b>${fmt(mm.def)}</b></div>
          <div><span>EXP each</span><b>${fmt(target.exp)}</b></div>
        </div>
        <p class="match-note">${esc(mm.verdict[2])}${mm.el > 1 ? " It's weak to your element (+25%)." : mm.el < 1 ? " It resists your element (−25%)." : ""}${target.level > c.level ? ` It's ${target.level - c.level} levels above you, which lowers your damage${target.level - c.level >= 1 ? " and accuracy" : ""}.` : ""}${mm.p < 1 && mm.withMiss !== Infinity ? ` Counting misses, expect about ${mm.withMiss} ${c.hits > 1 ? "uses" : "attacks"}.` : ""}${where.length ? ` Found in ${where.map((x) => link("map", x.map)).join(", ")}.` : ""}</p>
      </div>`;
  } else {
    $("#calcMatch").innerHTML = `<p class="sub empty">Pick a monster to see if you can take it on: hits to kill, hit chance and the accuracy you need.</p>`;
  }

  // best training
  const all = calcMonsters().map((m) => ({ m, mm: matchup(r, c, m) }));
  const expPer = ({ m, mm }) => (mm.withMiss === Infinity ? 0 : m.exp / mm.withMiss);
  const best = all.filter((x) => !x.m.boss && x.m.exp > 0 && idx.spawnsOf[x.m.id] && x.mm.p >= 0.6 && x.m.level >= c.level - 20 && x.m.level <= c.level + 15)
    .sort((a, b) => expPer(b) - expPer(a)).slice(0, 3);
  const toLevel = expToNext(c.level);
  $("#calcBest").innerHTML = `<div class="card-head"><h3>Best training for you</h3></div>` + (best.length
    ? `<div class="cx-best">${best.map(({ m, mm }, i) => {
        const where = idx.spawnsOf[m.id][0];
        return `<button type="button" class="cx-best-card" data-pick="${m.id}">
          <span class="cx-best-rank">${i + 1}</span><span class="cx-best-spr">${sprite(m, 52)}</span>
          <b>${esc(m.name)}</b><small>Lv ${m.level} · ${mm.uses} ${c.hits > 1 ? "uses" : "hits"} · ${Math.round(mm.p * 100)}% hit</small>
          <strong>${expPer({ m, mm }).toFixed(1)} EXP per attack</strong>
          <small>About ${fmt(Math.ceil(toLevel / m.exp))} kills to level ${c.level + 1}</small>
          <small>${esc(getEntity("map", where.map)?.name || "")} (×${where.count})</small></button>`;
      }).join("")}</div><p class="sub small">Based on EXP per attack with your current damage and hit chance. Busy maps and attack speed aren't counted.</p>`
    : `<p class="sub empty">Nothing near your level looks good yet. Try more attack or accuracy.</p>`);
  $("#calcBest").querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    calc.target = b.dataset.pick; saveCalc();
    $("#c_target").value = calc.target;
    renderCalcOut();
    $("#calcMatch").scrollIntoView({ behavior: "smooth", block: "center" });
  }));

  // table
  const sorters = { exp: (a, b) => expPer(b) - expPer(a), fast: (a, b) => a.mm.withMiss - b.mm.withMiss };
  const shown = all.filter(({ m }) => !c.near || (m.level >= c.level - 15 && m.level <= c.level + 10) || m.boss);
  if (sorters[c.mobSort]) shown.sort(sorters[c.mobSort]);
  const rows = shown.map(({ m, mm }) => {
    return `<tr class="pick ${m.id === c.target ? "selected" : ""}" data-pick="${m.id}">
      <td><span class="spr-cell">${sprite(m, 26)}</span>${esc(m.name)}${m.boss ? ' <span class="badge">Boss</span>' : ""}</td>
      <td class="num">${m.level}</td>
      <td class="num wide-only">${fmt(mm.min)}–${fmt(mm.max)}</td>
      <td class="num"><b>${mm.uses}</b></td>
      <td class="num ${mm.p >= 0.99 ? "" : mm.p < 0.5 ? "bad" : "warn"}">${Math.round(mm.p * 100)}%</td>
      <td class="num">${expPer({ m, mm }).toFixed(1)}</td>
      <td class="num wide-only">${verdictBadge(mm.verdict)}</td></tr>`;
  }).join("");
  $("#calcTable").innerHTML = `<div class="calc-tablewrap"><table><thead><tr><th>Monster</th><th class="num">Lv</th><th class="num wide-only">Damage</th><th class="num">${c.hits > 1 ? "Uses" : "Hits"}</th><th class="num">Hit %</th><th class="num">EXP / attack</th><th class="num wide-only">Verdict</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="sub">No monsters in range.</td></tr>`}</tbody></table></div>
    <p class="sub small">Tap a row to see the full matchup above. Hits = average needed, with crits. Damage is after the monster's defense${r.magic ? ", element" : ""} and the level-gap penalty.</p>
    <p class="sub small">Formulas: NiaDB (<a href="https://meowdb.com/msclassic/formulas/damage" target="_blank" rel="noopener">damage</a>, <a href="https://meowdb.com/msclassic/formulas" target="_blank" rel="noopener">stats and accuracy</a>, <a href="https://meowdb.com/msclassic/formulas/leveling" target="_blank" rel="noopener">HP, AP and EXP</a>), <a href="https://fullboosts.com/blog/maplestory-classic/articles/maplestory-classic-damage-formula-guide" target="_blank" rel="noopener">FullBoosts</a>, <a href="https://ms-classic.com/guides/accuracy-and-hit-rate-explained" target="_blank" rel="noopener">MS-Classic</a>. Skill values: NiaDB skill pages (linked). Monster stats, items and requirements: Classic game files.</p>`;
  $("#calcTable").querySelectorAll("tr[data-pick]").forEach((tr) => tr.addEventListener("click", (e) => {
    calc.target = tr.dataset.pick; saveCalc();
    $("#c_target").value = calc.target;
    renderCalcOut();
    $("#calcMatch").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}
