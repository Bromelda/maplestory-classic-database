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
  element: "None", accExtra: 0, rage: false, precise: false, formula: "majority", near: true, target: "", gear: {}, gearBonus: {}, buffs: {}, potions: [], mobSort: "level", guide: "exp", uptime: 50, party: 1, upSort: "gain",
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
const BUILD_KEYS = Object.keys(DEFAULTS).filter((k) => !["near", "target", "gear", "gearBonus", "buffs", "potions", "mobSort", "guide", "uptime", "party", "upSort"].includes(k));
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
      <button type="button" class="btn ghost" id="charCopy">Copy</button>
      <button type="button" class="btn" id="shareBtn">Share build</button>
      <button type="button" class="btn ghost" id="charBackup">Back up</button>
      <button type="button" class="btn ghost" id="charRestore">Restore</button>
      <input type="file" id="charFile" accept="application/json,.json" hidden>
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
  $("#charCopy").onclick = () => { duplicateCharacter(); $("#charName")?.select(); };
  $("#charBackup").onclick = backupCharacters;
  $("#charRestore").onclick = () => $("#charFile").click();
  $("#charFile").onchange = (e) => { if (e.target.files[0]) restoreCharacters(e.target.files[0]); };
}

function duplicateCharacter() {
  const c = activeChar();
  const id = "c" + Date.now();
  saveCalc();
  chars.list.push({ ...JSON.parse(JSON.stringify(c)), id, name: `${c.name} copy`.slice(0, 24) });
  switchCharacter(id);
  if (state.tab === "calc") renderCalc();
}
function backupCharacters() {
  saveCalc();
  const data = JSON.stringify({ app: "msclassicdb", version: 1, saved: new Date().toISOString(), active: chars.active, list: chars.list }, null, 1);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = "maplestory-classic-characters.json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $("#shareStatus").textContent = `Saved ${chars.list.length} ${chars.list.length === 1 ? "character" : "characters"} to a file. Use Restore on any device to bring them in.`;
}
// only known fields of the right type come in, and restored characters are added rather than replacing any
function cleanCharacter(raw, i) {
  const c = {};
  for (const [k, def] of Object.entries(DEFAULTS)) if (raw.calc && typeof raw.calc[k] === typeof def && Array.isArray(raw.calc[k]) === Array.isArray(def)) c[k] = raw.calc[k];
  if (!WEAPONS[c.cls]) { delete c.cls; delete c.weapon; }
  const skills = {};
  for (const [k, v] of Object.entries(raw.skills || {})) if (/^\d+$/.test(k) && Number.isInteger(v) && v > 0 && v <= 30) skills[k] = v;
  return {
    id: `c${Date.now()}${i}`, name: String(raw.name || "Restored").slice(0, 24), calc: c, skills,
    done: Array.isArray(raw.done) ? raw.done.filter((x) => typeof x === "string") : [],
    job2: Number(raw.job2) || undefined,
    sessions: Array.isArray(raw.sessions) ? raw.sessions.filter((s) => s && typeof s === "object").slice(0, 30) : [],
  };
}
async function restoreCharacters(file) {
  const status = $("#shareStatus");
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.app !== "msclassicdb" || !Array.isArray(parsed.list) || !parsed.list.length) throw new Error("wrong file");
    const added = parsed.list.slice(0, 50).map(cleanCharacter);
    chars.list.push(...added);
    switchCharacter(added[0].id);
    if (state.tab === "calc") renderCalc();
    $("#shareStatus").textContent = `Added ${added.length} ${added.length === 1 ? "character" : "characters"} from your backup.`;
  } catch {
    status.textContent = "That file isn't a character backup from this site.";
  }
}
// run a saved character through the calculator without changing what's on screen
function evalBuild(char) {
  const savedCalc = calc, savedActive = chars.active;
  chars.active = char.id;
  calc = { ...DEFAULTS, ...(char.calc || {}) };
  try {
    if (!WEAPONS[calc.cls]?.[calc.weapon]) calc.weapon = Object.keys(WEAPONS[calc.cls])[0];
    if (calc.skillId !== "basic" && calc.skillId !== "custom" && !skillsForWeapon().some((s) => String(s.id) === String(calc.skillId))) { calc.skillId = defaultSkill(); applySkill(); }
    const c = withGear(calc), r = rawRange(c), fs = sheet(c);
    const hits = ((r.min + r.max) / 2) * (1 + (c.crit / 100) * (c.critdmg / 100)) * c.hits;
    const best = [...guideEntries(c, r).usable].sort((a, b) => b.rate.exp - a.rate.exp)[0];
    const mob = savedCalc.target && getEntity("monster", savedCalc.target);
    const fight = mob ? matchup(r, c, mob) : null;
    const sk = currentSkill();
    return {
      name: char.name, cls: calc.cls, level: calc.level, weapon: wornGear(calc).find((g) => g.slot === "weapon")?.name || calc.weapon,
      skillName: sk?.name || (calc.skillId === "custom" ? "Custom" : "Regular attack"),
      min: clampDmg(r.min), max: clampDmg(r.max), avg: Math.round(hits), acc: accuracy(c), crit: c.crit, hp: fs.hp, mp: fs.mp, wdef: fs.wdef, mdef: fs.mdef, avoid: fs.avoid,
      bestExp: best?.rate.exp ?? null, bestSpot: best?.m.name || "—",
      mobUses: fight && fight.withMiss !== Infinity ? fight.withMiss : null, mobHit: fight ? Math.round(fight.p * 100) : null, mobExp: fight ? hourly(mob, fight, c).exp : null,
    };
  } finally {
    calc = savedCalc;
    chars.active = savedActive;
  }
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
    if (s.attack || !(Object.keys(SKILL_STATS).some((k) => top[k]) || /Booster$/.test(s.name))) continue;
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
  return Object.entries(it.stats).filter(([k]) => k !== "ASPD" && k !== "SLOTS" && !(spellWeapon && k === "ATT"))
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
  const page = byId.items[slugify(it.name)];
  box.innerHTML = `<div class="cx-bonus-head"><span class="cx-ico">${itemIcon(it.gid)}</span><b>${page ? link("item", page.id, it.name) : esc(it.name)}</b>
      <button type="button" class="cx-pick-close" id="gpClose" aria-label="Close">✕</button></div>
    <p class="cf-note">Scrolled it, or got a better or worse roll? Enter the difference here, like +14 Magic ATT from scrolls. Use a minus for a lower roll. It's added to your damage.</p>
    <div class="cx-bonus-grid">${main.map((k) => bonusField(it, k, label(k))).join("")}</div>
    <details class="cx-bonus-more" ${moreSet ? "open" : ""}><summary>More stats</summary>
      <div class="cx-bonus-grid">${more.map(([k, l]) => bonusField(it, k, l)).join("")}</div></details>
    <div class="cx-bonus-actions"><button type="button" class="cx-auto" id="gpChange">Change item</button>
      <button type="button" class="cx-auto" id="gpClear">Clear bonus</button>
      <button type="button" class="cx-auto" id="gpOff">Take it off</button></div>
    ${scrollPanel(it)}`;
  bindScrollPanel(it);
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

// ---------- what to fight: kills, EXP, mesos and drops per hour ----------
// Attack time and spawn supply: NiaDB's formula pages (linked under the results). These are estimates: walking,
// looting and other players are covered only by the "time spent attacking" setting.
const MESO_CHANCE = 0.68; // the average of the player-counted monsters, for those with no count
const SCROLL_CATEGORY = { "1H Sword": "One-Handed Sword", "2H Sword": "Two-Handed Sword", "1H Axe": "One-Handed Axe", "2H Axe": "Two-Handed Axe", "1H Blunt": "One-Handed BW", "2H Blunt": "Two-Handed BW" };
const PRICES_URL = "https://raw.githubusercontent.com/maplefm/maplefm.github.io/live/data/summary-public.json";
const prices = { byName: null, at: null, failed: false };
async function loadPrices() {
  try {
    const res = await fetch(PRICES_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const raw = await res.json();
    prices.byName = Object.fromEntries(raw.rows.map((r) => [r.item.toLowerCase(), r.typ]));
    prices.at = raw.at;
  } catch { prices.failed = true; }
  if (state.tab === "calc" && $("#calcBest")) renderCalcOut();
  if (state.tab === "home") renderHome();
}
function shortNum(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}
function attackSeconds(c) {
  const sk = currentSkill();
  const motion = sk?.rule?.motion || sk?.motion || c.motion;
  const base = c.weapon === "Crossbow" ? 820 : ["Spear", "Polearm"].includes(c.weapon) && motion === "stab" ? 750 : 800;
  const weapon = wornGear(c).find((g) => g.slot === "weapon");
  let tier = isSpell(c) ? 6 : weapon?.stats.ASPD ?? 6;
  for (const row of statSkills()) if (/Booster$/.test(row.skill.name) && calc.buffs[row.skill.name]) tier += skillAt(row.skill, usedLevel(row.skill)).x || 0;
  tier = Math.max(0, Math.min(10, tier));
  return (30 * Math.ceil((base * (10 + tier)) / 16 / 30)) / 1000;
}
function targetsPerAttack() {
  const sk = currentSkill();
  const most = sk?.levels ? skillAt(sk, usedLevel(sk)).mobCount || 1 : sk?.mobs || 1;
  return Math.min(most, 2); // skills that hit more than this rarely find more on every attack
}
// one lucky drop in 20 kills shouldn't look like a 5% rate: a cautious low estimate that gets closer to the counted rate with more kills
function cautiousRate(rate, kills) {
  const p = rate / 100;
  if (!kills) return p;
  const z = 1.28, z2 = z * z;
  return Math.max(0, (p + z2 / (2 * kills) - z * Math.sqrt((p * (1 - p)) / kills + z2 / (4 * kills * kills))) / (1 + z2 / kills));
}
function dropList(m) {
  return m.drops.filter((d) => d.item !== "meso").map((d) => {
    const it = byId.items[d.item];
    return { item: it, id: d.item, name: it?.name || d.item, rate: d.rate, kills: d.kills, price: (it && prices.byName?.[it.name.toLowerCase()]) ?? null, mine: it ? usefulToClass(it) : false };
  });
}
function usefulToClass(it) {
  if (it.type === "Equip") {
    const g = (db.gear || []).find((x) => x.gid === it.gid);
    if (!g) return false;
    return g.slot === "weapon" ? !!WEAPONS[calc.cls][g.weapon] && (!g.job || !!(g.job & CLASS_BIT[calc.cls])) : !!g.job && !!(g.job & CLASS_BIT[calc.cls]);
  }
  if (it.type !== "Use" || !/Scroll/.test(it.name)) return false;
  return it.category === (SCROLL_CATEGORY[calc.weapon] || calc.weapon) || it.name.includes(`${MAIN_STATS[calc.cls][0]} Scroll`);
}
function hourly(m, mm, c) {
  const best = idx.spawnsOf[m.id]?.[0];
  const isBoss = !!m.boss; // bosses come back on their own timers, so a per-hour number would mislead
  const seconds = attackSeconds(c);
  const uptime = (Number(c.uptime) || 50) / 100;
  // a party is counted as same-level members doing the same damage to the same monsters
  const party = Math.max(1, Math.min(6, Number(c.party) || 1));
  const wanted = mm.withMiss === Infinity ? 0 : ((3600 / seconds) * uptime * targetsPerAttack() * party) / mm.withMiss;
  const supply = best ? best.count * (3600 / 7.56) * Math.min(1, 0.75 + 0.05 * (party - 1)) : 0;
  const partyBonus = party > 1 ? Math.min(0.3, 0.1 * (party - 1)) + 0.05 * (party - 1) : 0;
  const kills = isBoss ? 0 : Math.min(wanted, supply);
  const mesoRow = m.drops.find((d) => d.item === "meso");
  const amount = m.meso ? (m.meso.min + m.meso.max) / 2 : Math.floor(2.1 * m.level) + 3;
  const drops = dropList(m);
  const counted = drops.filter((d) => d.rate != null && d.price != null);
  const valuePerKill = counted.reduce((a, d) => a + cautiousRate(d.rate, d.kills) * d.price, 0);
  return {
    kills, best, isBoss, cappedBySpawns: !isBoss && wanted > supply, exp: (kills * m.exp * (1 + partyBonus)) / party,
    meso: (kills * (mesoRow?.rate != null ? mesoRow.rate / 100 : MESO_CHANCE) * amount) / party, mesoGuess: mesoRow?.rate == null || !m.meso,
    value: (kills * valuePerKill) / party, hasCounts: counted.length > 0, killsCounted: Math.max(0, ...counted.map((d) => d.kills || 0)),
    top: [...drops].filter((d) => d.price != null).sort((a, b) => b.price - a.price),
    uncounted: drops.filter((d) => d.rate == null).length,
  };
}
// what a monster's touch does to you (NiaDB's damage taken formulas); monster skills can hit harder
function mobDanger(m, c) {
  const fs = sheet(c);
  const eva = Math.max(0, fs.avoid), gap = Math.max(0, c.level - m.level);
  const A = ((m.acc || 0) * 100) / (5 * (gap + 51));
  const E = eva / (1 + eva / 80) / (1 + gap / 40);
  const f = 0.15 + 0.2 / (1 + Math.exp((A - E) / 12));
  const candidate = E > A * (1 + f) ? Math.max(0.02, Math.min(0.03, Math.exp((A - E) / 18) * 0.03))
    : A > 0 ? Math.max(0, Math.min(1, (1 + f - E / A) / (2 * f))) : 0;
  const def = Math.max(0, fs.wdef);
  const taken = (raw) => Math.max(1, Math.trunc(raw * (1 - def / (def + 300 + 2 * raw)) - (def / 25 + c.level / 10)));
  const low = taken((m.atk || 0) * 1.2), high = taken((m.atk || 0) * 1.4);
  return { chance: candidate + (1 - candidate) * 0.08, low, high, hitsToDie: Math.ceil(Math.max(1, fs.hp) / Math.max(1, high)) };
}

// ---------- best upgrades ----------
const UPGRADE_SLOTS = { weapon: "Weapon", ammo: "Ammo", hat: "Hat", top: "Top", bottom: "Bottom", overall: "Overall", shoes: "Shoes", gloves: "Gloves", cape: "Cape", earrings: "Earrings", shield: "Shield" };
const DAMAGE_STATS = ["ATT", "MATT", "STR", "DEX", "INT", "LUK", "CRIT", "CRITDMG"];
function removedBySlot(slot) {
  const off = slot === "overall" ? ["overall", "top", "bottom"] : slot === "top" || slot === "bottom" ? [slot, "overall"] : [slot];
  const removed = {};
  const take = (stats) => { for (const [k, v] of Object.entries(stats || {})) if (GEAR_FIELD[k]) removed[GEAR_FIELD[k]] = (removed[GEAR_FIELD[k]] || 0) - v; };
  for (const s of off) {
    const it = calc.gear[s] && gearFor(calc, s).find((g) => g.gid === calc.gear[s]);
    if (it) { take(it.stats); take(calc.gearBonus[s]); }
  }
  return removed;
}
let gearByGid = null;
function gearOfItem(it) {
  gearByGid ||= new Map((db.gear || []).map((g) => [g.gid, g]));
  return gearByGid.get(it.gid) || (db.gear || []).find((g) => g.name === it.name) || null;
}
function classCanUse(g) {
  const usable = !g.job || !!(g.job & CLASS_BIT[calc.cls]);
  return g.slot === "weapon" ? usable && !!WEAPONS[calc.cls][g.weapon] : usable;
}
// what this gear would do for the current character, for its item page
function gearComparison(it) {
  const g = gearOfItem(it);
  if (!g) return "";
  if (!classCanUse(g)) return `<div class="sell-advice maybe"><b>Not for your ${esc(calc.cls)}</b><span>${esc(activeChar().name)} can't use this.</span></div>`;
  if (calc.gear[g.slot] === g.gid && (g.slot !== "weapon" || calc.weapon === g.weapon)) return `<div class="sell-advice safe"><b>You're wearing this</b><span>${esc(activeChar().name)} has it in the calculator.</span></div>`;
  const base = withGear(calc), before = avgHit(base);
  const t = { ...base, weapon: g.slot === "weapon" ? g.weapon : base.weapon };
  if (g.slot === "weapon" && !calc.gear.weapon) { t.watk -= calc.watk; t.matk -= calc.matk; }
  for (const [field, v] of Object.entries(removedBySlot(g.slot))) t[field] += v;
  for (const [k, v] of Object.entries(g.stats)) if (GEAR_FIELD[k]) t[GEAR_FIELD[k]] += v;
  const pct = before ? ((avgHit(t) - before) / before) * 100 : 0;
  const needs = gearNeeds(g, t);
  const word = Math.abs(pct) < 0.05 ? "No change in damage" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}% damage`;
  const worn = g.slot === "top" || g.slot === "bottom" ? calc.gear.overall : calc.gear[g.slot];
  return `<div class="sell-advice ${pct > 0.05 ? "safe" : pct < -0.05 ? "keep" : "maybe"}"><b>${word}</b><span>Compared with ${worn ? "what" : "the empty slot"} ${esc(activeChar().name)} ${worn ? "is wearing" : "has"}, on the current skill.${needs.length ? ` Needs ${esc(needs.join(", "))}.` : ""}</span>
    <span><button type="button" class="cx-auto" data-item-wear="${g.gid}">Wear it in the calculator</button></span></div>`;
}
function wearFromItemPage(gid) {
  const g = (db.gear || []).find((x) => x.gid === gid);
  if (!g) return;
  if (g.slot === "weapon") calc.weapon = g.weapon;
  setGear(g.slot, gid);
  picker.slot = null;
  picker.list = false;
  renderPicker();
}
function avgHit(t) { const r = rawRange(t); return ((r.min + r.max) / 2) * (1 + (t.crit / 100) * (t.critdmg / 100)); }
function bestUpgrades(limit) {
  const base = withGear(calc);
  const baseAvg = avgHit(base);
  if (!baseAvg) return [];
  const out = [];
  for (const slot of Object.keys(UPGRADE_SLOTS)) {
    if (slot === "shield" && NO_SHIELD.has(calc.weapon)) continue;
    const removed = removedBySlot(slot);
    const typedWeapon = slot === "weapon" && !calc.gear.weapon;
    for (const g of gearFor(calc, slot)) {
      if (calc.gear[slot] === g.gid || !Object.keys(g.stats).some((k) => DAMAGE_STATS.includes(k))) continue;
      const t = { ...base };
      if (typedWeapon) { t.watk -= calc.watk; t.matk -= calc.matk; }
      for (const [field, v] of Object.entries(removed)) t[field] += v;
      for (const [k, v] of Object.entries(g.stats)) if (GEAR_FIELD[k]) t[GEAR_FIELD[k]] += v;
      if (gearNeeds(g, t).length) continue;
      const gain = avgHit(t) - baseAvg;
      if (gain / baseAvg < 0.002) continue;
      const price = prices.byName?.[g.name.toLowerCase()] ?? null;
      out.push({ g, slot, gain, pct: (gain / baseAvg) * 100, price, perMillion: price ? (gain / price) * 1e6 : null });
    }
  }
  const byValue = (a, b) => (b.perMillion ?? -1) - (a.perMillion ?? -1);
  return out.sort(calc.upSort === "value" ? byValue : (a, b) => b.gain - a.gain).slice(0, limit);
}
function renderSkillTable() {
  const box = $("#calcSkills");
  if (!box) return;
  const saved = { skillId: calc.skillId, skill: calc.skill, hits: calc.hits, mastery: calc.mastery, element: calc.element };
  const target = calc.target && getEntity("monster", calc.target);
  const list = ["basic", ...skillsForWeapon().map((s) => String(s.id))];
  const rows = list.map((id) => {
    calc.skillId = id;
    applySkill();
    const t = withGear(calc), r = rawRange(t), sk = currentSkill();
    const perUse = ((r.min + r.max) / 2) * (1 + (t.crit / 100) * (t.critdmg / 100)) * t.hits;
    const lv = sk?.levels ? usedLevel(sk) : null;
    const reach = sk?.levels ? skillAt(sk, lv).mobCount || 1 : sk?.mobs || 1;
    const fight = target ? matchup(r, t, target) : null;
    return { id, name: sk?.name || "Regular attack", lv, perUse, perSec: perUse / attackSeconds(t), reach, uses: fight?.withMiss };
  });
  Object.assign(calc, saved);
  const top = Math.max(...rows.map((x) => x.perSec));
  box.innerHTML = `<div class="card-head"><h3>Compare your skills</h3></div>
    <div class="calc-tablewrap"><table><thead><tr><th>Skill</th><th class="num">Lv</th><th class="num">Per use</th><th class="num">Per second</th><th class="num">${target ? `Uses on ${esc(target.name)}` : "Targets"}</th></tr></thead>
    <tbody>${rows.map((x) => `<tr class="pick ${String(calc.skillId) === x.id ? "selected" : ""}" data-use-skill="${x.id}"><td>${esc(x.name)}${x.perSec === top ? ' <span class="badge">Best</span>' : ""}</td><td class="num">${x.lv ?? "—"}</td><td class="num">${fmt(Math.round(x.perUse))}</td><td class="num">${fmt(Math.round(x.perSec))}</td><td class="num">${target ? (x.uses === Infinity ? "—" : x.uses) : x.reach}</td></tr>`).join("")}</tbody></table></div>
    <p class="sub small">One target, after crits and before monster defense, at your planned skill levels (or max if you haven't planned them). Attack speed here is by weapon, so skills with their own timing may differ. Tap a row to use that skill.</p>`;
  box.querySelectorAll("[data-use-skill]").forEach((row) => row.addEventListener("click", () => {
    calc.skillId = row.dataset.useSkill;
    applySkill();
    saveCalc();
    renderCalc();
  }));
}
function renderUpgrades() {
  const box = $("#calcUpgrades");
  if (!box) return;
  const list = bestUpgrades(6);
  box.innerHTML = `<div class="card-head"><h3>Best upgrades</h3>
      <select id="upSort" aria-label="Sort upgrades"><option value="gain" ${calc.upSort !== "value" ? "selected" : ""}>Most damage</option><option value="value" ${calc.upSort === "value" ? "selected" : ""}>Best for the price</option></select></div>` +
    (list.length ? `<div class="cx-upgrades">${list.map((u) => `<div class="cx-upgrade"><span class="cx-ico">${itemIcon(u.g.gid)}</span>
        <span class="cx-guide-main"><b>${esc(u.g.name)}</b><small>${UPGRADE_SLOTS[u.slot]} · ${esc(gearStatText(u.g))}</small>
          <small class="cx-mine">+${u.pct.toFixed(1)}% damage${u.price != null ? ` · about ${shortNum(u.price)} mesos` : " · no recent price"}</small></span>
        <button type="button" class="cx-auto" data-wear="${u.g.gid}" data-wear-slot="${u.slot}">Wear it</button></div>`).join("")}</div>
      <p class="sub small">Gear you can wear right now, compared on your current skill. Prices are recent sales from Club FM, and rolls and scrolls can change them.</p>`
      : `<p class="sub empty">Nothing you can wear right now beats your current gear.</p>`);
  $("#upSort").addEventListener("change", (e) => { calc.upSort = e.target.value; saveCalc(); renderUpgrades(); });
  box.querySelectorAll("[data-wear]").forEach((b) => b.addEventListener("click", () => {
    setGear(b.dataset.wearSlot, Number(b.dataset.wear));
    picker.slot = null;
    renderPicker();
  }));
}

// ---------- scroll simulator ----------
const SCROLL_FOR_SLOT = { hat: "Helmet", top: "Topwear", bottom: "Bottomwear", overall: "Overall", shoes: "Shoes", gloves: "Gloves", cape: "Cape", earrings: "Earrings", shield: "Shield" };
const scrollTrial = { gid: null, scrollId: null, left: 0, used: 0, hits: 0, gained: {}, spent: 0, destroyed: false, log: [] };
function scrollsFor(it) {
  const cat = it.slot === "weapon" ? SCROLL_CATEGORY[calc.weapon] || calc.weapon : SCROLL_FOR_SLOT[it.slot];
  const order = { ATT: 0, MATT: 1, INT: 2, STR: 3, DEX: 4, LUK: 5 };
  return (db.scrolls || []).filter((s) => s.category === cat)
    .sort((a, b) => (order[Object.keys(a.stats)[0]] ?? 9) - (order[Object.keys(b.stats)[0]] ?? 9) || b.success - a.success);
}
function resetTrial(it, left) {
  Object.assign(scrollTrial, { gid: it.gid, left: left ?? it.stats.SLOTS ?? 0, used: 0, hits: 0, gained: {}, spent: 0, destroyed: false, log: [] });
}
function scrollText(s) { return gearStatText({ slot: "scroll", stats: s.stats }); }
function useScroll(s) {
  if (scrollTrial.destroyed || scrollTrial.left <= 0) return;
  scrollTrial.left--; scrollTrial.used++;
  scrollTrial.spent += prices.byName?.[s.name.toLowerCase()] || 0;
  if (Math.random() * 100 < s.success) {
    scrollTrial.hits++;
    for (const [k, v] of Object.entries(s.stats)) scrollTrial.gained[k] = (scrollTrial.gained[k] || 0) + v;
    scrollTrial.log.unshift("Worked");
  } else if (s.destroy && Math.random() * 100 < s.destroy) {
    scrollTrial.destroyed = true;
    scrollTrial.log.unshift("Failed, and the item was destroyed");
  } else scrollTrial.log.unshift("Failed");
}
function scrollPanel(it) {
  const list = scrollsFor(it);
  if (!list.length) return "";
  if (scrollTrial.gid !== it.gid) resetTrial(it);
  const chosen = list.find((s) => s.gid === scrollTrial.scrollId) || list[0];
  scrollTrial.scrollId = chosen.gid;
  const left = scrollTrial.left, n = Math.max(0, left), p = chosen.success / 100;
  const price = prices.byName?.[chosen.name.toLowerCase()];
  const gainedText = Object.keys(scrollTrial.gained).length ? gearStatText({ slot: "scroll", stats: scrollTrial.gained }) : "nothing yet";
  const allWork = n ? (p ** n) * 100 : 0;
  const survive = chosen.destroy ? (1 - (1 - p) * (chosen.destroy / 100)) ** n * 100 : null;
  return `<details class="cx-scrolls" ${scrollTrial.used ? "open" : ""}><summary>Try scrolling this item</summary>
    <label class="cx-bonus-field cx-scroll-pick"><span>Scroll</span><select id="scPick">${list.map((s) => `<option value="${s.gid}" ${s.gid === chosen.gid ? "selected" : ""}>${esc(s.name.replace(/ Scroll:/, ":"))} (${s.success}%, ${esc(scrollText(s))})</option>`).join("")}</select></label>
    <label class="cx-bonus-field cx-scroll-slots"><span>Slots left</span><input type="number" id="scLeft" min="0" max="20" value="${left}" inputmode="numeric"></label>
    <p class="cf-note">${chosen.success}% to work${price ? ` · about ${shortNum(price)} mesos each` : ""}${chosen.destroy ? ` · a failure has a ${chosen.destroy}% chance to destroy the item` : ""}. Using all ${n}: ${allWork >= 0.1 ? allWork.toFixed(1) : "under 0.1"}% that they all work, ${(n * p).toFixed(1)} work on average${survive != null ? `, ${survive.toFixed(0)}% the item survives` : ""}.</p>
    <div class="cx-bonus-actions"><button type="button" class="cx-auto" id="scOne" ${scrollTrial.destroyed || left <= 0 ? "disabled" : ""}>Use 1</button>
      <button type="button" class="cx-auto" id="scAll" ${scrollTrial.destroyed || left <= 0 ? "disabled" : ""}>Use all slots</button>
      <button type="button" class="cx-auto" id="scReset">Start over</button>
      <button type="button" class="cx-auto" id="scApply" ${scrollTrial.hits && !scrollTrial.destroyed ? "" : "disabled"}>Add result to bonus</button></div>
    <p class="cx-scroll-result"><b>${scrollTrial.destroyed ? "Item destroyed" : `${scrollTrial.hits} of ${scrollTrial.used} worked`}</b> · gained ${esc(gainedText)}${scrollTrial.spent ? ` · spent about ${shortNum(scrollTrial.spent)} mesos` : ""}${scrollTrial.log[0] ? ` · last: ${esc(scrollTrial.log[0])}` : ""}</p>
    <p class="cf-note">A practice run only. Nothing counts toward your damage unless you add it.</p></details>`;
}
function bindScrollPanel(it) {
  const refresh = () => renderPicker();
  $("#scPick")?.addEventListener("change", (e) => { scrollTrial.scrollId = Number(e.target.value); refresh(); });
  $("#scLeft")?.addEventListener("change", (e) => { resetTrial(it, Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0))); refresh(); });
  const chosen = () => (db.scrolls || []).find((s) => s.gid === scrollTrial.scrollId);
  $("#scOne")?.addEventListener("click", () => { useScroll(chosen()); refresh(); });
  $("#scAll")?.addEventListener("click", () => { while (scrollTrial.left > 0 && !scrollTrial.destroyed) useScroll(chosen()); refresh(); });
  $("#scReset")?.addEventListener("click", () => { resetTrial(it); refresh(); });
  $("#scApply")?.addEventListener("click", () => {
    const stats = { ...calc.gearBonus[it.slot] };
    for (const [k, v] of Object.entries(scrollTrial.gained)) stats[k] = (stats[k] || 0) + v;
    calc.gearBonus = { ...calc.gearBonus, [it.slot]: stats };
    resetTrial(it, scrollTrial.left);
    saveCalc();
    refresh();
    renderCalcOut();
  });
}

// ---------- grind tracker ----------
const TRACK_KEY = "msclassicdb.trackerStart";
let trackerTick = null;
function trackerStart() { try { return Number(localStorage.getItem(TRACK_KEY)) || 0; } catch { return 0; } }
function clockText(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
}
function renderTracker() {
  const box = $("#calcTracker");
  if (!box) return;
  clearInterval(trackerTick);
  const started = trackerStart();
  const char = activeChar();
  const past = char.sessions || [];
  const target = calc.target && getEntity("monster", calc.target);
  box.innerHTML = `<div class="card-head"><h3>Grind tracker</h3><span class="cx-clock" id="trkClock">${started ? clockText(Date.now() - started) : ""}</span></div>
    ${started ? `<p class="sub small">Timing a session${target ? ` on ${esc(target.name)}` : ""}. When you stop, enter what you gained. It keeps running if you close this page.</p>
      <div class="cx-bonus-grid cx-track-grid">
        <label class="cx-bonus-field"><span>EXP gained</span><input type="number" id="trkExp" min="0" inputmode="numeric"></label>
        <label class="cx-bonus-field"><span>Mesos gained</span><input type="number" id="trkMeso" min="0" inputmode="numeric"></label>
        <label class="cx-bonus-field"><span>Kills</span><input type="number" id="trkKills" min="0" inputmode="numeric"></label>
      </div>
      <div class="cx-bonus-actions"><button type="button" class="btn" id="trkStop">Save session</button><button type="button" class="btn ghost" id="trkCancel">Cancel</button></div>`
    : `<p class="sub small">Time a real session to see your actual numbers next to the estimates. ${target ? `Timing ${esc(target.name)}.` : "Pick a monster above to compare it with the estimate."}</p>
      <button type="button" class="btn" id="trkStart">Start timer</button>`}
    ${past.length ? `<div class="calc-tablewrap cx-track-table"><table><thead><tr><th>Monster</th><th class="num">Time</th><th class="num">EXP/hr</th><th class="num">Mesos/hr</th><th class="num">Kills/hr</th></tr></thead><tbody>${past.slice(0, 8).map((s) => {
      const per = 3600000 / Math.max(1, s.ms);
      return `<tr><td>${esc(s.mobName || "Any")}<small class="cx-track-est">${s.estExp ? ` est. ${shortNum(s.estExp)} EXP/hr` : ""}</small></td><td class="num">${clockText(s.ms)}</td><td class="num">${shortNum(s.exp * per)}</td><td class="num">${shortNum(s.meso * per)}</td><td class="num">${s.kills ? shortNum(s.kills * per) : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>
    ${(() => { const last = past.find((s) => s.estKills && s.kills); if (!last) return ""; const ratio = (last.kills * 3600000) / Math.max(1, last.ms) / last.estKills; return `<p class="sub small">Your last session ran at ${Math.round(ratio * 100)}% of the estimated kills per hour. Set "Time spent attacking" above to match if it's far off.</p>`; })()}
    <button type="button" class="cx-auto" id="trkClear">Clear history</button>` : ""}`;
  $("#trkStart")?.addEventListener("click", () => {
    try { localStorage.setItem(TRACK_KEY, String(Date.now())); } catch { /* storage unavailable */ }
    renderTracker();
  });
  $("#trkCancel")?.addEventListener("click", () => { try { localStorage.removeItem(TRACK_KEY); } catch { /* storage unavailable */ } renderTracker(); });
  $("#trkClear")?.addEventListener("click", () => { char.sessions = []; saveChars(); renderTracker(); });
  $("#trkStop")?.addEventListener("click", () => {
    const num = (id) => parseInt($(id).value, 10) || 0;
    const c = withGear(calc);
    const rate = target ? hourly(target, matchup(rawRange(c), c, target), c) : null;
    char.sessions = [{ mobName: target?.name || "", ms: Date.now() - trackerStart(), exp: num("#trkExp"), meso: num("#trkMeso"), kills: num("#trkKills"), estExp: rate?.exp || 0, estKills: rate?.kills || 0, date: Date.now() }, ...(char.sessions || [])].slice(0, 30);
    try { localStorage.removeItem(TRACK_KEY); } catch { /* storage unavailable */ }
    saveChars();
    renderTracker();
  });
  if (started) trackerTick = setInterval(() => {
    const el = $("#trkClock");
    if (!el) { clearInterval(trackerTick); return; }
    el.textContent = clockText(Date.now() - started);
  }, 1000);
}

function dropLine(d) {
  const chance = d.rate != null ? `${rateText(d.rate)}${d.kills && d.kills < 100 ? ` (only ${d.kills} kills counted)` : ""}` : "chance not counted yet";
  return `<li>${d.item ? link("item", d.id, d.name) : esc(d.name)}${d.mine ? ' <span class="badge">For you</span>' : ""}<span class="right">${d.price != null ? `${shortNum(d.price)} · ` : ""}${chance}</span></li>`;
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
        <section class="calc-card" id="calcSkills"></section>
        <section class="calc-card">
          <div class="card-head"><h3>Fight a monster</h3>
            <select id="c_target" aria-label="Pick a monster"><option value="">Pick a monster…</option>
              ${mobs.map((m) => `<option value="${m.id}" ${calc.target === m.id ? "selected" : ""}>Lv ${m.level} · ${esc(m.name)}${m.boss ? " (boss)" : ""}</option>`).join("")}
            </select></div>
          <div id="calcMatch"></div>
        </section>
        <section class="calc-card" id="calcBest"></section>
        <section class="calc-card" id="calcUpgrades"></section>
        <section class="calc-card" id="calcTracker"></section>
        <section class="calc-card" id="calcMatchCard">
          <div class="card-head"><h3>Every monster</h3>
            <select id="c_mobSort" aria-label="Sort monsters">
              ${[["level", "By level"], ["exp", "Most EXP per hour"], ["meso", "Most mesos per hour"], ["drops", "Best drops per hour"], ["fast", "Fewest attacks"]].map(([v, t]) => `<option value="${v}" ${calc.mobSort === v ? "selected" : ""}>${t}</option>`).join("")}
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
  renderTracker();
  if (!prices.byName && !prices.failed && !prices.loading) { prices.loading = true; loadPrices(); }
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

function guideEntries(c, r) {
  const all = calcMonsters().map((m) => { const mm = matchup(r, c, m); return { m, mm, rate: hourly(m, mm, c), danger: mobDanger(m, c) }; });
  return { all, usable: all.filter((x) => !x.m.boss && x.m.exp > 0 && x.rate.best && x.mm.p >= 0.5 && x.mm.withMiss !== Infinity && x.m.level <= c.level + 15) };
}
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
    const rate = hourly(target, mm, c);
    const danger = mobDanger(target, c);
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
          <div><span>It hits you for</span><b>${fmt(danger.low)}–${fmt(danger.high)}</b></div>
          <div><span>Chance it hits you</span><b>${Math.round(danger.chance * 100)}%</b></div>
          <div><span>Hits to kill you</span><b class="${danger.hitsToDie <= 2 ? "bad" : danger.hitsToDie <= 4 ? "warn" : "ok"}">${danger.hitsToDie}</b></div>
          ${rate.isBoss ? "" : `<div><span>Kills / hour</span><b>${shortNum(rate.kills)}</b></div>
          <div><span>EXP / hour</span><b>${shortNum(rate.exp)}</b></div>
          <div><span>Mesos / hour</span><b>${shortNum(rate.meso)}${rate.mesoGuess ? "<small> est.</small>" : ""}</b></div>
          <div><span>Drop value / hour</span><b>${rate.hasCounts ? shortNum(rate.value) : "—"}${rate.hasCounts ? "" : "<small> not counted</small>"}</b></div>`}
        </div>
        ${rate.best ? `<p class="cx-route-link"><button type="button" class="btn ghost" data-route-to="${esc(rate.best.map)}">Route to ${esc(getEntity("map", rate.best.map)?.name || "this map")}</button></p>` : ""}
        ${rate.top.length ? `<h4 class="cx-drops-title">Most valuable drops</h4><ul class="cx-drops">${rate.top.slice(0, 5).map(dropLine).join("")}</ul>` : ""}
        <p class="match-note">${esc(mm.verdict[2])}${mm.el > 1 ? " It's weak to your element (+25%)." : mm.el < 1 ? " It resists your element (−25%)." : ""}${target.level > c.level ? ` It's ${target.level - c.level} levels above you, which lowers your damage${target.level - c.level >= 1 ? " and accuracy" : ""}.` : ""}${mm.p < 1 && mm.withMiss !== Infinity ? ` Counting misses, expect about ${mm.withMiss} ${c.hits > 1 ? "uses" : "attacks"}.` : ""}${where.length ? ` Found in ${where.map((x) => link("map", x.map)).join(", ")}.` : ""}</p>
      </div>`;
  } else {
    $("#calcMatch").innerHTML = `<p class="sub empty">Pick a monster to see if you can take it on: hits to kill, hit chance and the accuracy you need.</p>`;
  }

  // what to fight
  const { all, usable } = guideEntries(c, r);
  const toLevel = expToNext(c.level);
  const mode = ["exp", "meso", "drops"].includes(c.guide) ? c.guide : "exp";
  const byMode = {
    exp: (a, b) => b.rate.exp - a.rate.exp,
    meso: (a, b) => b.rate.meso - a.rate.meso,
    // monsters with counted drops first, then the rest by their most valuable drop
    drops: (a, b) => b.rate.value - a.rate.value || (b.rate.top[0]?.price || 0) - (a.rate.top[0]?.price || 0),
  };
  const picks = [...usable].sort(byMode[mode]).slice(0, 5);
  // monsters that could be great for drops but have no counted rates can't be ranked, so they're listed apart
  const unknowns = mode !== "drops" ? [] : usable.filter((x) => !x.rate.hasCounts && x.rate.top.length)
    .sort((a, b) => Number(!!b.rate.top.find((d) => d.mine)) - Number(!!a.rate.top.find((d) => d.mine)) || b.rate.top[0].price - a.rate.top[0].price).slice(0, 4);
  const hitWord = (n) => `${n} ${c.hits > 1 ? (n === 1 ? "use" : "uses") : (n === 1 ? "hit" : "hits")}`;
  const topDrops = (rate) => {
    const top = rate.top[0], mine = rate.top.find((d) => d.mine);
    const say = (d) => `${esc(d.name)} (${shortNum(d.price)}${d.rate != null ? `, ${rateText(d.rate)}` : ", chance not counted"})`;
    return (top ? `<small>Top drop: ${say(top)}</small>` : "") + (mine && mine !== top ? `<small class="cx-mine">For you: ${say(mine)}</small>` : top?.mine ? `<small class="cx-mine">That's useful for your class</small>` : "");
  };
  const uptimeNow = Number(c.uptime) || 50;
  const countedCount = usable.filter((x) => x.rate.hasCounts).length;
  $("#calcBest").innerHTML = `<div class="card-head"><h3>What to fight</h3>
      <div class="cx-guide-opts"><label class="cx-uptime"><span>Attacking</span><select id="guideUptime" aria-label="Time spent attacking">${[[30, "30% of the time"], [50, "50% of the time"], [70, "70% of the time"]].map(([v, t]) => `<option value="${v}" ${uptimeNow === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="cx-uptime"><span>Party</span><select id="guideParty" aria-label="Party size">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${(Number(c.party) || 1) === n ? "selected" : ""}>${n === 1 ? "Solo" : `${n} players`}</option>`).join("")}</select></label></div></div>
    <div class="cx-modes" role="radiogroup" aria-label="What to fight for">
      ${[["exp", "Fastest levels"], ["meso", "Most mesos"], ["drops", "Best drops"]].map(([v, t]) => `<button type="button" class="cx-mode ${mode === v ? "on" : ""}" data-guide="${v}" role="radio" aria-checked="${mode === v}">${t}</button>`).join("")}
    </div>` + (picks.length
    ? `<div class="cx-guide">${picks.map(({ m, mm, rate, danger }, i) => {
        const hoursLeft = rate.exp > 0 ? toLevel / rate.exp : null;
        return `<button type="button" class="cx-guide-row" data-pick="${m.id}">
          <span class="cx-guide-rank">${i + 1}</span><span class="cx-guide-spr">${sprite(m, 44)}</span>
          <span class="cx-guide-main"><b>${esc(m.name)}</b>
            <small>Lv ${m.level} · ${hitWord(mm.uses)} · ${Math.round(mm.p * 100)}% hit · ${esc(getEntity("map", rate.best.map)?.name || "")}</small>
            <span class="cx-guide-nums"><i class="${mode === "exp" ? "on" : ""}"><b>${shortNum(rate.exp)}</b> EXP/hr</i><i class="${mode === "meso" ? "on" : ""}"><b>${shortNum(rate.meso)}</b> mesos/hr</i><i class="${mode === "drops" ? "on" : ""}"><b>${rate.hasCounts ? shortNum(rate.value) : "?"}</b> drop value/hr</i></span>
            <small>${shortNum(rate.kills)} kills/hr${hoursLeft != null ? ` · about ${hoursLeft < 1 ? `${Math.max(1, Math.round(hoursLeft * 60))} min` : `${hoursLeft.toFixed(hoursLeft < 10 ? 1 : 0)} hours`} to level ${c.level + 1}` : ""}${rate.cappedBySpawns ? " · limited by spawns" : ""}</small>
            ${danger.hitsToDie <= 3 ? `<small class="cx-danger">Careful: ${danger.hitsToDie} ${danger.hitsToDie === 1 ? "hit" : "hits"} can kill you</small>` : ""}
            ${rate.hasCounts && rate.killsCounted < 100 ? `<small>Drop value is from only ${rate.killsCounted} counted kills, so it could be off</small>` : ""}
            ${topDrops(rate)}
          </span></button>`;
      }).join("")}</div>`
    : `<p class="sub empty">Nothing you can reliably hit yet. Try more accuracy or a lower-level area.</p>`) +
    (unknowns.length ? `<h4 class="cx-drops-title">Valuable drops, but no rates counted yet</h4><div class="cx-guide">${unknowns.map(({ m, mm, rate }) => `<button type="button" class="cx-guide-row" data-pick="${m.id}">
        <span class="cx-guide-spr">${sprite(m, 44)}</span>
        <span class="cx-guide-main"><b>${esc(m.name)}</b><small>Lv ${m.level} · ${hitWord(mm.uses)} · ${shortNum(rate.exp)} EXP/hr · ${shortNum(rate.meso)} mesos/hr</small>${topDrops(rate)}</span></button>`).join("")}</div>` : "") +
    `<p class="sub small">Rough estimates${(Number(c.party) || 1) > 1 ? ` per player, for a party of same-level members doing similar damage and all hitting monsters, with the party bonus. Kills are the whole party's` : " for one person hunting alone"}, counting your attack speed, hit chance, up to 2 monsters per attack for skills that hit several, and monster spawns. Real numbers depend on the map, other players and how fast you loot.</p>
    <p class="sub small">Drop value is rate × recent price, from <a href="https://maplefm.gg" target="_blank" rel="noopener">Club FM</a>${prices.at ? ` (${new Date(prices.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` : ""}. ${prices.failed ? "Prices couldn't be loaded right now. " : !prices.byName ? "Prices are loading. " : ""}Only ${countedCount} of these ${usable.length} monsters have counted drop rates so far, so drop value is only a guide. Rates from only a few kills are counted cautiously. "?" means no rate has been counted yet. Meso estimates use a formula by azzybish and ohmi, shared on NiaDB.</p>`;
  $("#calcBest").querySelectorAll("[data-guide]").forEach((b) => b.addEventListener("click", () => {
    calc.guide = b.dataset.guide; saveCalc(); renderCalcOut();
    $(`[data-guide="${calc.guide}"]`)?.focus({ preventScroll: true });
  }));
  $("#guideUptime").addEventListener("change", (e) => { calc.uptime = Number(e.target.value); saveCalc(); renderCalcOut(); });
  $("#guideParty").addEventListener("change", (e) => { calc.party = Number(e.target.value); saveCalc(); renderCalcOut(); });
  $("#calcBest").querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    calc.target = b.dataset.pick; saveCalc();
    $("#c_target").value = calc.target;
    renderCalcOut();
    renderTracker();
    $("#calcMatch").scrollIntoView({ behavior: "smooth", block: "center" });
  }));

  // table
  const hourCell = (rate, v) => (rate.isBoss ? "—" : shortNum(v));
  const sorters = { exp: (a, b) => b.rate.exp - a.rate.exp, meso: (a, b) => b.rate.meso - a.rate.meso, drops: (a, b) => b.rate.value - a.rate.value, fast: (a, b) => a.mm.withMiss - b.mm.withMiss };
  const shown = all.filter(({ m }) => !c.near || (m.level >= c.level - 15 && m.level <= c.level + 10) || m.boss);
  if (sorters[c.mobSort]) shown.sort(sorters[c.mobSort]);
  const rows = shown.map(({ m, mm, rate }) => {
    return `<tr class="pick ${m.id === c.target ? "selected" : ""}" data-pick="${m.id}">
      <td><span class="spr-cell">${sprite(m, 26)}</span>${esc(m.name)}${m.boss ? ' <span class="badge">Boss</span>' : ""}</td>
      <td class="num">${m.level}</td>
      <td class="num wide-only">${fmt(mm.min)}–${fmt(mm.max)}</td>
      <td class="num"><b>${mm.uses}</b></td>
      <td class="num ${mm.p >= 0.99 ? "" : mm.p < 0.5 ? "bad" : "warn"}">${Math.round(mm.p * 100)}%</td>
      <td class="num">${hourCell(rate, rate.exp)}</td>
      <td class="num wide-only">${hourCell(rate, rate.meso)}</td>
      <td class="num wide-only">${rate.hasCounts ? hourCell(rate, rate.value) : "—"}</td>
      <td class="num wide-only">${verdictBadge(mm.verdict)}</td></tr>`;
  }).join("");
  $("#calcTable").innerHTML = `<div class="calc-tablewrap"><table><thead><tr><th>Monster</th><th class="num">Lv</th><th class="num wide-only">Damage</th><th class="num">${c.hits > 1 ? "Uses" : "Hits"}</th><th class="num">Hit %</th><th class="num">EXP/hr</th><th class="num wide-only">Mesos/hr</th><th class="num wide-only">Drops/hr</th><th class="num wide-only">Verdict</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="9" class="sub">No monsters in range.</td></tr>`}</tbody></table></div>
    <p class="sub small">Tap a row to see the full matchup above. Hits = average needed, with crits. Damage is after the monster's defense${r.magic ? ", element" : ""} and the level-gap penalty.</p>
    <p class="sub small">Formulas: NiaDB (<a href="https://meowdb.com/msclassic/formulas/damage" target="_blank" rel="noopener">damage</a>, <a href="https://meowdb.com/msclassic/formulas" target="_blank" rel="noopener">stats and accuracy</a>, <a href="https://meowdb.com/msclassic/formulas/leveling" target="_blank" rel="noopener">HP, AP, EXP and mesos</a>, <a href="https://meowdb.com/msclassic/formulas/attack-speed" target="_blank" rel="noopener">attack speed</a>, <a href="https://meowdb.com/msclassic/formulas/spawns" target="_blank" rel="noopener">spawns</a>, <a href="https://meowdb.com/msclassic/formulas/damage-taken" target="_blank" rel="noopener">damage taken</a>), <a href="https://fullboosts.com/blog/maplestory-classic/articles/maplestory-classic-damage-formula-guide" target="_blank" rel="noopener">FullBoosts</a>, <a href="https://ms-classic.com/guides/accuracy-and-hit-rate-explained" target="_blank" rel="noopener">MS-Classic</a>. Skill values: NiaDB skill pages (linked). Monster stats, items and requirements: Classic game files.</p>`;
  renderUpgrades();
  renderSkillTable();
  $("#calcTable").querySelectorAll("tr[data-pick]").forEach((tr) => tr.addEventListener("click", (e) => {
    calc.target = tr.dataset.pick; saveCalc();
    $("#c_target").value = calc.target;
    renderCalcOut();
    $("#calcMatch").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}
