// Damage calculator for MapleStory Classic World.
// Damage formulas: community-datamined Classic formulas (NiaMeowDB, FullBoosts, MS-Classic agree),
// with an optional MapleClassic Wiki variant for physical hits.
// Accuracy / hit chance: NiaMeowDB and MS-Classic (they match).
// Skill presets: max-level values, each read from its own NiaDB skill page (linked).
// Loaded after app.js; uses its helpers (db, idx, $, esc, fmt, link, sprite, getEntity).

const CALC_KEY = "msclassicdb.calc";
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
  Magician: { "Wand / Staff": { magic: true } },
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
  element: "None", accExtra: 0, rage: false, precise: false, formula: "majority", near: true, target: "",
};

let calc = { ...DEFAULTS };
try { Object.assign(calc, JSON.parse(localStorage.getItem(CALC_KEY) || "{}")); } catch { /* storage unavailable */ }
function saveCalc() { try { localStorage.setItem(CALC_KEY, JSON.stringify(calc)); } catch { /* ignore */ } }

function currentSkill() {
  return (SKILLS[calc.cls] || []).find((s) => s.id === calc.skillId) || null;
}
function skillsForWeapon() {
  return (SKILLS[calc.cls] || []).filter((s) => !s.weapons || s.weapons.includes(calc.weapon));
}

// ---------- damage math ----------
function masteryFactor(level, formula) {
  return (level / 10 + 0.1) * (formula === "wiki" ? 0.8 : 0.7);
}
function totalAP(c) { return c.ap + (c.cls === "Warrior" && c.rage ? 40 : 0); }
function critRate(c) { return c.crit + (c.cls === "Warrior" && c.precise ? 5 : 0); }

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
  const motion = sk?.motion || c.motion;
  let M = w.shoot ?? (motion === "swing" ? w.mult[0] : motion === "stab" ? w.mult[1] : 0.6 * w.mult[0] + 0.4 * w.mult[1]);
  let m = masteryFactor(c.mastery, c.formula);
  if (sk?.lucky7) { M = 3.0; m = 0.5; }
  if (sk?.drain) M = 2.5;
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
  if (sk.pct != null) calc.skill = sk.pct;
  calc.hits = sk.hits;
  if (sk.mastery != null) calc.mastery = sk.mastery;
  if (sk.element) calc.element = sk.element;
}

function renderCalc() {
  const view = $("#calcView");
  if (!WEAPONS[calc.cls][calc.weapon]) calc.weapon = Object.keys(WEAPONS[calc.cls])[0];
  if (calc.skillId !== "basic" && calc.skillId !== "custom" && !skillsForWeapon().some((s) => s.id === calc.skillId)) {
    calc.skillId = WEAPONS[calc.cls][calc.weapon].magic ? "energy-bolt" : "basic";
    applySkill();
  }
  const w = WEAPONS[calc.cls][calc.weapon];
  const magic = !!w.magic;
  const sk = currentSkill();
  const skillOpts = [...(magic ? [] : [["basic", "Regular attack (100%)"]]),
    ...skillsForWeapon().map((s) => [s.id, `${s.name} · Lv ${s.lv}${s.pct != null ? ` · ${s.pct}%${s.hits > 1 ? ` ×${s.hits}` : ""}` : ""}`]),
    ["custom", "Custom (type the % yourself)"]];
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
    <div class="calc-grid">
      <form class="calc-form" onsubmit="return false">
        <fieldset><legend>Character</legend>
          ${sel("weapon", "Weapon", Object.keys(WEAPONS[calc.cls]).map((k) => [k, k]), false)}
          ${num("level", "Level", 1, 200)}
          ${w.mult && !sk?.motion ? sel("motion", "Attack motion", [["avg", "Average (60% swing / 40% stab)"], ["swing", "Swing"], ["stab", "Stab"]]) : ""}
        </fieldset>
        <fieldset><legend>Total stats (with gear)</legend>
          ${num("STR", "STR")}${num("DEX", "DEX")}${num("INT", "INT")}${num("LUK", "LUK")}
        </fieldset>
        <fieldset><legend>Skill</legend>
          ${sel("skillId", "Skill", skillOpts)}
          ${num("skill", magic ? "Spell power" : "Damage %", 1, 9999, sk ? `<a href="${NIADB}${sk.src}" target="_blank" rel="noopener">Max level value · NiaDB ↗</a>${sk.note ? ` ${esc(sk.note)}` : ""}` : calc.skillId === "custom" ? "From your skill's tooltip" : "")}
          ${num("hits", "Hits per use", 1, 10)}
          ${magic ? sel("element", "Spell element", ELEMENTS.map((e) => [e, e]), false) : ""}
          ${sk?.mobs > 1 ? `<p class="cf-note full">Hits up to ${sk.mobs} monsters at once.</p>` : ""}
        </fieldset>
        <fieldset><legend>Attack</legend>
          ${magic ? num("matk", "Magic Attack", 0, 9999, "Wand/staff + gear (not INT)") : num("watk", "Weapon Attack", 0, 9999, calc.weapon === "Claw" ? "Claw + gloves + stars" : calc.cls === "Bowman" ? "Bow/crossbow + gear + arrows" : "Weapon + gloves + gear")}
          ${num("mastery", magic ? "Spell mastery" : "Mastery", 0, 10, magic ? "0–10. Max-level spells = 10" : "0–10. Mastery skill level ÷ 2")}
          ${magic ? "" : num("ap", "Attack Power", 0, 999, "Other buffs / consumables")}
          ${num("accExtra", "Bonus accuracy", 0, 999, "From gear and skills")}
          ${calc.cls === "Warrior" ? chk("rage", "Rage (Fighter)", "+40 Attack Power at max level") + chk("precise", "Precise Strikes (max)", "+20 accuracy, +5% crit rate") : ""}
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
        <section class="calc-card">
          <div class="card-head"><h3>Every monster</h3>
            <label class="check"><input type="checkbox" id="c_near" ${calc.near ? "checked" : ""}> Near my level only</label></div>
          <div id="calcTable"></div>
        </section>
      </div>
    </div>`;

  view.querySelectorAll(".class-btn").forEach((b) => b.addEventListener("click", () => {
    calc.cls = b.dataset.cls;
    calc.weapon = Object.keys(WEAPONS[calc.cls])[0];
    calc.skillId = calc.cls === "Magician" ? "energy-bolt" : "basic";
    applySkill();
    saveCalc(); renderCalc();
  }));
  view.querySelectorAll(".calc-form input, .calc-form select, #c_target, #c_near").forEach((el) => el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
    const id = el.id.slice(2);
    calc[id] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value) || 0;
    if (id === "skillId") applySkill();
    if (["skill", "hits"].includes(id) && currentSkill()) calc.skillId = "custom";
    saveCalc();
    if (["weapon", "skillId"].includes(id)) renderCalc(); else renderCalcOut();
  }));
  renderCalcOut();
}

function verdictBadge(v) { return `<span class="verdict ${v[0]}">${v[1]}</span>`; }

function renderCalcOut() {
  const c = calc;
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
