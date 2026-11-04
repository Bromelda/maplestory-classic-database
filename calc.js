// Damage calculator for MapleStory Classic World.
// Damage formulas: community-datamined Classic formulas (NiaMeowDB, FullBoosts, MS-Classic agree),
// with an optional MapleClassic Wiki variant for physical hits.
// Accuracy / hit chance: NiaMeowDB and MS-Classic (they match).
// Skill presets: max-level values, each read from its own NiaDB skill page (linked).
// Loaded after app.js; uses its helpers (db, idx, $, esc, fmt, link, sprite, getEntity).

const NIADB = "https://meowdb.com/msclassic/skills/";

// Weapon multipliers (Classic): [swing, stab]; ranged weapons shoot at 2.5.
const WEAPONS = {
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
  Magician: { "Wand": { magic: true }, "Staff": { magic: true } },
  Bowman: {
    "Bow": { shoot: 2.5, stats: ["DEX", "STR"] },
    "Crossbow": { shoot: 2.5, stats: ["DEX", "STR"] },
  },
  Thief: {
    "Claw": { shoot: 2.5, stats: ["LUK", "STR+DEX"] },
    "Dagger": { mult: [1.0, 2.0], stats: ["LUK", "STR+DEX"] },
  },
};
const CLASS_ICON = { Warrior: "⚔️", Magician: "🔮", Bowman: "🏹", Thief: "🗡️" };

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
  element: "None", accExtra: 0, rage: false, precise: false, formula: "majority", near: true, target: "", gear: {},
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
const BUILD_KEYS = Object.keys(DEFAULTS).filter((k) => !["near", "target", "gear"].includes(k));
function encodeBuild(name) {
  const o = { n: name };
  for (const k of BUILD_KEYS) if (calc[k] !== DEFAULTS[k]) o[k] = calc[k];
  if (Object.keys(calc.gear).length) o.g = calc.gear;
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
    calc = { ...DEFAULTS, ...clean, gear };
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
function passive(name, field) {
  if (!hasSkillData()) return 0;
  const s = classSkill(name);
  return s ? skillAt(s, planLevel(s.id))[field] || 0 : 0;
}
function masterySkill() { return hasSkillData() ? classSkill(MASTERY_SKILL[calc.weapon]) : null; }

// ---------- gear ----------
// Picked items are added to what's typed in, so the typed numbers stay as they are if the gear changes.
const CLASS_BIT = { Warrior: 1, Magician: 2, Bowman: 4, Thief: 8 };
const ARMOR_SLOTS = [["hat", "Hat"], ["top", "Top"], ["bottom", "Bottom"], ["overall", "Overall"], ["shoes", "Shoes"], ["gloves", "Gloves"], ["cape", "Cape"], ["earrings", "Earrings"], ["shield", "Shield"]];
const NO_SHIELD = new Set(["2H Sword", "2H Axe", "2H Blunt", "Spear", "Polearm", "Bow", "Crossbow", "Claw"]);
const GEAR_FIELD = { STR: "STR", DEX: "DEX", INT: "INT", LUK: "LUK", ATT: "watk", MATT: "matk", ACC: "accExtra", CRIT: "crit", CRITDMG: "critdmg" };
const GEAR_LABEL = { ATT: "ATT", MATT: "Magic ATT", ACC: "accuracy", CRIT: "crit rate", CRITDMG: "crit damage" };
let armorOpen = false;

function gearFor(c, slot) {
  return (db.gear || []).filter((g) => g.slot === slot && (slot === "weapon" ? g.weapon === c.weapon : !g.job || g.job & CLASS_BIT[c.cls]));
}
function wornGear(c) {
  return Object.entries(c.gear).flatMap(([slot, gid]) => {
    if (slot === "shield" && NO_SHIELD.has(c.weapon)) return [];
    const it = gearFor(c, slot).find((g) => g.gid === gid);
    return it ? [it] : [];
  });
}
function withGear(c) {
  const total = { ...c };
  for (const it of wornGear(c)) for (const [k, v] of Object.entries(it.stats)) total[GEAR_FIELD[k]] += v;
  return total;
}
function gearStatText(stats, magic) {
  return Object.entries(stats).filter(([k]) => !(magic && k === "ATT")).map(([k, v]) => `${v > 0 ? "+" : ""}${v}${/CRIT/.test(k) ? "%" : ""} ${GEAR_LABEL[k] || k}`).join(", ");
}
function gearSelect(slot, label) {
  const magic = !!WEAPONS[calc.cls][calc.weapon].magic;
  const opts = gearFor(calc, slot).map((g) => {
    const stats = gearStatText(g.stats, magic);
    return `<option value="${g.gid}" ${calc.gear[slot] === g.gid ? "selected" : ""}>Lv ${g.level} · ${esc(g.name)}${stats ? ` (${esc(stats)})` : ""}</option>`;
  }).join("");
  return `<label class="cf full"><span>${label}</span><select data-slot="${slot}"><option value="">None</option>${opts}</select></label>`;
}
function setGear(slot, gid) {
  const g = { ...calc.gear };
  if (gid) g[slot] = gid; else delete g[slot];
  if (gid && slot === "overall") { delete g.top; delete g.bottom; }
  if (gid && (slot === "top" || slot === "bottom")) delete g.overall;
  // the attack typed so far was standing in for a weapon, so the real one replaces it
  if (gid && slot === "weapon" && !calc.gear.weapon) { calc.watk = 0; calc.matk = 0; }
  calc.gear = g;
  saveCalc();
  renderCalc();
  $(`[data-slot="${slot}"]`)?.focus({ preventScroll: true });
}
function gearNote() {
  const magic = !!WEAPONS[calc.cls][calc.weapon].magic;
  const worn = wornGear(calc);
  const total = {};
  for (const it of worn) for (const [k, v] of Object.entries(it.stats)) total[k] = (total[k] || 0) + v;
  const stats = gearStatText(total, magic);
  const tooHigh = worn.filter((g) => g.level > calc.level).map((g) => `${esc(g.name)} needs level ${g.level}.`).join(" ");
  const noAttack = !calc.gear.weapon && !(magic ? calc.matk : calc.watk) ? "Pick your weapon, or type its attack under Attack." : "";
  return [stats && `Gear adds ${esc(stats)}.`, tooHigh, noAttack].filter(Boolean).join(" ");
}

// ---------- damage math ----------
function masteryFactor(level, formula) {
  return (level / 10 + 0.1) * (formula === "wiki" ? 0.8 : 0.7);
}
function totalAP(c) {
  if (hasSkillData()) return c.ap + (c.cls === "Warrior" ? passive("Rage", "indiePad") : 0);
  return c.ap + (c.cls === "Warrior" && c.rage ? 40 : 0);
}
function critRate(c) {
  if (hasSkillData()) return c.crit + (c.cls === "Warrior" ? passive("Precise Strikes", "crtX") : 0);
  return c.crit + (c.cls === "Warrior" && c.precise ? 5 : 0);
}
// physical mastery comes from the planned level of the weapon's Mastery skill
function physMastery(c) {
  const ms = masterySkill();
  if (!ms) return c.mastery;
  return skillAt(ms, planLevel(ms.id)).mastery || 0;
}

function rawRange(c) {
  const sk = currentSkill();
  const S = c.skill / 100;
  const w = WEAPONS[c.cls][c.weapon];
  if (w.magic) {
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
    Warrior: common / 2.5 + 10, Bowman: common / 4.8 + 20, Thief: common / 4 + 15,
    Magician: (1.2 * c.INT + 2 * c.level + 0.6 * c.LUK) / 5.1 + 20,
  }[c.cls];
  if (hasSkillData()) {
    const ms = masterySkill();
    const bonus = (ms ? skillAt(ms, planLevel(ms.id)).x || 0 : 0)
      + (c.cls === "Warrior" ? passive("Precise Strikes", "accX") : 0)
      + (c.cls === "Bowman" ? passive("Focus", "indieAcc") : 0);
    return Math.floor(base) + (c.accExtra || 0) + bonus;
  }
  return Math.floor(base) + (c.accExtra || 0) + (c.cls === "Warrior" && c.precise ? 20 : 0);
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
function chk(id, label, hint = "") {
  return `<label class="cf-toggle full"><input type="checkbox" id="c_${id}" ${calc[id] ? "checked" : ""}><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ""}</span></label>`;
}
function calcMonsters() {
  return db.monsters.filter((m) => !m.variant && m.level < 200 && !m.name.startsWith("Tutorial") && (m.drops.length || idx.spawnsOf[m.id]))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function applySkill() {
  const sk = currentSkill();
  if (!sk) { if (calc.skillId === "basic") { calc.skill = 100; calc.hits = 1; } return; }
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
  const badBasic = calc.skillId === "basic" && WEAPONS[calc.cls][calc.weapon].magic;
  if (badBasic || (calc.skillId !== "basic" && calc.skillId !== "custom" && !skillsForWeapon().some((s) => String(s.id) === String(calc.skillId)))) {
    calc.skillId = defaultSkill();
    applySkill();
  }
  // gear this class or weapon can't use comes off
  const wearable = {};
  for (const [slot, gid] of Object.entries(calc.gear)) if (gearFor(calc, slot).some((g) => g.gid === gid)) wearable[slot] = gid;
  calc.gear = wearable;
  const w = WEAPONS[calc.cls][calc.weapon];
  const magic = !!w.magic;
  const sk = currentSkill();
  const hasGear = wornGear(calc).length > 0;
  const armor = ARMOR_SLOTS.filter(([slot]) => !(slot === "shield" && NO_SHIELD.has(calc.weapon)));
  const skillOpts = [...(magic ? [] : [["basic", "Regular attack (100%)"]]),
    ...skillsForWeapon().map((s) => [s.id, s.levels ? `${s.name}${s.jobName !== calc.cls ? ` · ${s.jobName.replace(/^Wizard \((.+)\)$/, "$1")}` : ""}` : `${s.name} · Lv ${s.lv}${s.pct != null ? ` · ${s.pct}%${s.hits > 1 ? ` ×${s.hits}` : ""}` : ""}`]),
    ["custom", "Custom (type the % yourself)"]];
  const ms = masterySkill();
  const mobs = calcMonsters();
  view.innerHTML = `
    <section class="calc-hero">
      <div>
        <h2>Damage calculator</h2>
        <p>Enter your character, pick a skill, and see your damage, your hit chance, and how many hits every monster takes. Uses Classic World's own formulas.</p>
      </div>
      <div class="class-pick" role="radiogroup" aria-label="Class">
        ${Object.keys(WEAPONS).map((k) => `<button type="button" class="class-btn ${calc.cls === k ? "on" : ""}" data-cls="${k}" role="radio" aria-checked="${calc.cls === k}"><span>${CLASS_ICON[k]}</span>${k}</button>`).join("")}
      </div>
    </section>
    ${charBar()}
    <div class="calc-grid">
      <form class="calc-form" onsubmit="return false">
        <fieldset><legend>Character</legend>
          ${sel("weapon", "Weapon type", Object.keys(WEAPONS[calc.cls]).map((k) => [k, k]), false)}
          ${num("level", "Level", 1, 200)}
          ${db.gear?.length ? gearSelect("weapon", "Weapon") : ""}
          ${w.mult && !sk?.motion ? sel("motion", "Attack motion", [["avg", "Average (60% swing / 40% stab)"], ["swing", "Swing"], ["stab", "Stab"]]) : ""}
          <p class="cf-note full" id="gearNote"></p>
        </fieldset>
        ${db.gear?.length ? `<details class="calc-more" id="armorMore" ${armorOpen || armor.some(([slot]) => calc.gear[slot]) ? "open" : ""}><summary>Armor &amp; accessories</summary>
          <fieldset>${armor.map(([slot, label]) => gearSelect(slot, label)).join("")}</fieldset>
        </details>` : ""}
        <fieldset><legend>${hasGear ? "Base stats (without gear)" : "Total stats (with gear)"}</legend>
          ${num("STR", "STR")}${num("DEX", "DEX")}${num("INT", "INT")}${num("LUK", "LUK")}
          <p class="cf-note full">${hasGear ? "The gear you picked is added to these for you." : "If you pick your gear above, enter your stats without it instead."}</p>
        </fieldset>
        <fieldset><legend>Skill</legend>
          ${sel("skillId", "Skill", skillOpts)}
          ${sk?.levels ? `<label class="cf"><span>Skill level</span><input type="number" id="c_skLv" min="1" max="${sk.max}" value="${usedLevel(sk)}" inputmode="numeric"><small>1–${sk.max}. Saved to your skill plan.</small></label>` : ""}
          ${num("skill", magic ? "Spell power" : "Damage %", 1, 9999, sk?.levels ? (sk.note ? esc(sk.note) : "From the game files") : sk ? `<a href="${NIADB}${sk.src}" target="_blank" rel="noopener">Max level value · NiaDB ↗</a>${sk.note ? ` ${esc(sk.note)}` : ""}` : calc.skillId === "custom" ? "From your skill's tooltip" : "")}
          ${num("hits", "Hits per use", 1, 10)}
          ${magic ? sel("element", "Spell element", ELEMENTS.map((e) => [e, e]), false) : ""}
          ${sk?.mobs > 1 ? `<p class="cf-note full">Hits up to ${sk.mobs} monsters at once.</p>` : ""}
        </fieldset>
        <fieldset><legend>Attack</legend>
          ${magic ? num("matk", "Magic Attack", 0, 9999, hasGear ? "On top of your gear: scrolls and buffs" : "Wand/staff + gear (not INT)") : num("watk", "Weapon Attack", 0, 9999, hasGear ? (calc.weapon === "Claw" ? "On top of your gear: stars, scrolls and buffs" : calc.cls === "Bowman" ? "On top of your gear: arrows, scrolls and buffs" : "On top of your gear: scrolls and buffs") : calc.weapon === "Claw" ? "Claw + gloves + stars" : calc.cls === "Bowman" ? "Bow/crossbow + gear + arrows" : "Weapon + gloves + gear")}
          ${!magic && ms ? `<label class="cf"><span>${esc(ms.name)} level</span><input type="number" id="c_msLv" min="0" max="${ms.max}" value="${planLevel(ms.id)}" inputmode="numeric"><small>0–${ms.max} · mastery ${physMastery(calc)}, +${skillAt(ms, planLevel(ms.id)).x || 0} accuracy</small></label>`
            : num("mastery", magic ? "Spell mastery" : "Mastery", 0, 10, magic ? "0–10. Set by the spell's level" : "0–10. Mastery skill level ÷ 2")}
          ${magic ? "" : num("ap", "Attack Power", 0, 999, "Other buffs / consumables")}
          ${num("accExtra", "Bonus accuracy", 0, 999, hasGear ? "On top of your gear and skills" : "From gear and skills")}
          ${hasSkillData() ? buffInputs() : calc.cls === "Warrior" ? chk("rage", "Rage (Fighter)", "+40 Attack Power at max level") + chk("precise", "Precise Strikes (max)", "+20 accuracy, +5% crit rate") : ""}
        </fieldset>
        <details class="calc-more"><summary>Critical hits &amp; formula</summary>
          <fieldset>
            ${num("crit", "Crit rate %", 0, 100, "Base 5%")}${num("critdmg", "Crit damage %", 0, 500, "Base 20%")}
            ${sel("formula", "Formula version", [["majority", "NiaDB / most sites (default)"], ["wiki", "MapleClassic Wiki"]])}
            <p class="cf-note full">Sources disagree on two small details (mastery ×0.7 vs ×0.8, Attack Power counted twice vs once).${magic ? " Spells always use the NiaDB formula." : ""} If you test in game, let us know which matches!</p>
          </fieldset>
        </details>
      </form>
      <div class="calc-out">
        <div id="calcSummary"></div>
        <section class="calc-card">
          <div class="card-head"><h3>Fight a monster</h3>
            <select id="c_target" aria-label="Pick a monster"><option value="">Pick a monster…</option>
              ${mobs.map((m) => `<option value="${m.id}" ${calc.target === m.id ? "selected" : ""}>Lv ${m.level} · ${esc(m.name)}${m.boss ? " (boss)" : ""}</option>`).join("")}
            </select></div>
          <div id="calcMatch"></div>
        </section>
        <section class="calc-card" id="calcMatchCard">
          <div class="card-head"><h3>Every monster</h3>
            <label class="check"><input type="checkbox" id="c_near" ${calc.near ? "checked" : ""}> Near my level only</label></div>
          <div id="calcTable"></div>
        </section>
      </div>
    </div>
    <button type="button" id="calcBar" class="calc-bar" aria-label="Jump to results"></button>`;

  bindCharBar();
  view.querySelectorAll("[data-slot]").forEach((el) => el.addEventListener("change", () => setGear(el.dataset.slot, Number(el.value) || 0)));
  $("#armorMore")?.addEventListener("toggle", (e) => { armorOpen = e.target.open; });
  view.querySelectorAll("[data-plan]").forEach((el) => el.addEventListener("input", () => {
    setPlanLevel(Number(el.dataset.plan), Number(el.value) || 0); renderCalcOut();
    const hint = el.parentElement.querySelector("small[data-desc]"); const s = SK.byId[Number(el.dataset.plan)];
    if (hint && s) hint.textContent = describeLevel(s, skillAt(s, planLevel(s.id)));
  }));
  const skLv = $("#c_skLv");
  if (skLv) skLv.addEventListener("input", () => { const s = currentSkill(); setPlanLevel(s.id, Number(skLv.value) || 1); applySkill(); saveCalc(); renderCalc(); });
  const msLv = $("#c_msLv");
  if (msLv) msLv.addEventListener("input", () => { setPlanLevel(masterySkill().id, Number(msLv.value) || 0); renderCalcOut(); msLv.parentElement.querySelector("small").textContent = `0–${masterySkill().max} · mastery ${physMastery(calc)}, +${skillAt(masterySkill(), planLevel(masterySkill().id)).x || 0} accuracy`; });
  view.querySelectorAll(".class-btn").forEach((b) => b.addEventListener("click", () => {
    calc.cls = b.dataset.cls;
    calc.weapon = Object.keys(WEAPONS[calc.cls])[0];
    calc.skillId = defaultSkill();
    applySkill();
    saveCalc(); renderCalc();
  }));
  view.querySelectorAll(".calc-form input:not([data-plan]):not(#c_skLv):not(#c_msLv), .calc-form select:not([data-slot]), #c_target, #c_near").forEach((el) => el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
    const id = el.id.slice(2);
    calc[id] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value) || 0;
    if (id === "skillId") applySkill();
    if (["skill", "hits"].includes(id) && currentSkill()) calc.skillId = "custom";
    saveCalc();
    if (["weapon", "skillId"].includes(id)) renderCalc(); else renderCalcOut();
  }));
  renderCalcOut();
}

function defaultSkill() {
  if (!WEAPONS[calc.cls][calc.weapon].magic) return "basic";
  const first = skillsForWeapon()[0];
  return first ? String(first.id) : "custom";
}

function buffInputs() {
  const rows = { Warrior: [["Rage", "Attack Power buff (Fighter)"], ["Precise Strikes", "Accuracy and crit rate (passive)"]], Bowman: [["Focus", "Accuracy buff"]] }[calc.cls] || [];
  return rows.map(([name, what]) => {
    const s = classSkill(name);
    if (!s) return "";
    const lv = planLevel(s.id);
    return `<label class="cf"><span>${esc(name)} level</span><input type="number" data-plan="${s.id}" min="0" max="${s.max}" value="${lv}" inputmode="numeric"><small data-desc>${esc(lv ? describeLevel(s, skillAt(s, lv)) : what + ". 0 = not used")}</small></label>`;
  }).join("");
}

function verdictBadge(v) { return `<span class="verdict ${v[0]}">${v[1]}</span>`; }

function renderCalcOut() {
  const c = withGear(calc);
  $("#gearNote").textContent = gearNote();
  const r = rawRange(c);
  const acc = accuracy(c);
  const cr = critRate(c);
  const avgRaw = ((r.min + r.max) / 2) * (1 + (cr / 100) * (c.critdmg / 100));
  const sk = currentSkill();
  const skillName = sk ? sk.name : c.skillId === "custom" ? `Custom ${c.skill}%` : "Regular attack";
  $("#calcSummary").innerHTML = `
    <section class="calc-big">
      <div class="calc-big-label">${esc(skillName)}${c.hits > 1 ? ` · ${c.hits} hits` : ""}</div>
      <div class="calc-big-num">${fmt(clampDmg(r.min))}<span>–</span>${fmt(clampDmg(r.max))}</div>
      <div class="calc-stats">
        <div><b>${fmt(Math.round(avgRaw * c.hits))}</b><span>avg per ${c.hits > 1 ? "use" : "hit"}</span></div>
        <div><b>${fmt(clampDmg(r.max * (1 + c.critdmg / 100)))}</b><span>max crit</span></div>
        <div><b>${acc}</b><span>accuracy</span></div>
        <div><b>${cr}%</b><span>crit rate</span></div>
      </div>
      <p>Before monster defense. ${r.magic ? "Spells use INT and Magic Attack." : ""}</p>
    </section>`;

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

  // table
  const mobs = calcMonsters().filter((m) => !c.near || (m.level >= c.level - 15 && m.level <= c.level + 10) || m.boss);
  const rows = mobs.map((m) => {
    const mm = matchup(r, c, m);
    return `<tr class="pick ${m.id === c.target ? "selected" : ""}" data-pick="${m.id}">
      <td><span class="spr-cell">${sprite(m, 26)}</span>${esc(m.name)}${m.boss ? ' <span class="badge">Boss</span>' : ""}</td>
      <td class="num">${m.level}</td>
      <td class="num wide-only">${fmt(mm.min)}–${fmt(mm.max)}</td>
      <td class="num"><b>${mm.uses}</b></td>
      <td class="num ${mm.p >= 0.99 ? "" : mm.p < 0.5 ? "bad" : "warn"}">${Math.round(mm.p * 100)}%</td>
      <td class="num wide-only">${verdictBadge(mm.verdict)}</td></tr>`;
  }).join("");
  $("#calcTable").innerHTML = `<div class="calc-tablewrap"><table><thead><tr><th>Monster</th><th class="num">Lv</th><th class="num wide-only">Damage</th><th class="num">${c.hits > 1 ? "Uses" : "Hits"}</th><th class="num">Hit %</th><th class="num wide-only">Verdict</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="sub">No monsters in range.</td></tr>`}</tbody></table></div>
    <p class="sub small">Tap a row to see the full matchup above. Hits = average needed, with crits. Damage is after the monster's defense${r.magic ? ", element" : ""} and the level-gap penalty.</p>
    <p class="sub small">Formulas: <a href="https://meowdb.com/msclassic/formulas/damage" target="_blank" rel="noopener">NiaDB</a>, <a href="https://fullboosts.com/blog/maplestory-classic/articles/maplestory-classic-damage-formula-guide" target="_blank" rel="noopener">FullBoosts</a>, <a href="https://ms-classic.com/guides/accuracy-and-hit-rate-explained" target="_blank" rel="noopener">MS-Classic</a>. Skill values: NiaDB skill pages (linked). Monster stats: Classic game files.</p>`;
  $("#calcTable").querySelectorAll("tr[data-pick]").forEach((tr) => tr.addEventListener("click", (e) => {
    calc.target = tr.dataset.pick; saveCalc();
    $("#c_target").value = calc.target;
    renderCalcOut();
    $("#calcMatch").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}
