// Damage calculator for MapleStory Classic World.
// Formulas: community-datamined Classic formulas as documented by NiaMeowDB, FullBoosts
// and MS-Classic (majority), with an optional MapleClassic Wiki variant for physical hits.
// Loaded after app.js; uses its helpers (db, $, esc, fmt, link, sprite, getEntity).

const CALC_KEY = "msclassicdb.calc";

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
  Magician: { "Wand / Staff (spells)": { magic: true } },
  Bowman: {
    "Bow": { shoot: 2.5, stats: ["DEX", "STR"] },
    "Crossbow": { shoot: 2.5, stats: ["DEX", "STR"] },
  },
  Thief: {
    "Claw": { shoot: 2.5, stats: ["LUK", "STR+DEX"] },
    "Dagger": { mult: [1.0, 2.0], stats: ["LUK", "STR+DEX"] },
  },
};
const ELEMENTS = ["None", "Fire", "Ice", "Lightning", "Poison", "Holy"];
const DEFAULTS = {
  cls: "Warrior", weapon: "1H Sword", motion: "avg", level: 30, STR: 132, DEX: 30, INT: 4, LUK: 4,
  watk: 47, matk: 0, ap: 0, mastery: 0, skill: 100, hits: 1, crit: 5, critdmg: 20, element: "None",
  lucky7: false, formula: "majority", near: true,
};

let calc = { ...DEFAULTS };
try { Object.assign(calc, JSON.parse(localStorage.getItem(CALC_KEY) || "{}")); } catch { /* storage unavailable */ }
function saveCalc() { try { localStorage.setItem(CALC_KEY, JSON.stringify(calc)); } catch { /* ignore */ } }

// ---------- the math ----------
function masteryFactor(level, formula) {
  return (level / 10 + 0.1) * (formula === "wiki" ? 0.8 : 0.7);
}

// Raw damage before the monster (defense, element, level gap, crit).
function rawRange(c) {
  const S = c.skill / 100;
  const w = WEAPONS[c.cls][c.weapon];
  if (w.magic) {
    const m = masteryFactor(c.mastery, "majority");
    const total = Math.floor(c.INT / 2) + c.matk;
    return { min: S * total * (1 + (c.INT * m) / 125), max: S * total * (1 + c.INT / 125), magic: true };
  }
  const val = (k) => (k === "STR+DEX" ? c.STR + c.DEX : c[k]);
  const P = val(w.stats[0]), Q = val(w.stats[1]);
  let M = w.shoot ?? (c.motion === "swing" ? w.mult[0] : c.motion === "stab" ? w.mult[1] : 0.6 * w.mult[0] + 0.4 * w.mult[1]);
  let m = masteryFactor(c.mastery, c.formula);
  if (c.lucky7 && c.weapon === "Claw") { M = 3.0; m = 0.5; }
  const A = (c.formula === "wiki" ? 1 : 2) * c.ap;
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
  const k = (100 / (def + 100)) * elementMult(mob, r.magic ? c.element : "None") * levelScale(mob.level, c.level);
  const min = clampDmg(r.min * k), max = clampDmg(r.max * k);
  const critMult = 1 + (c.crit / 100) * (c.critdmg / 100);
  const avg = ((min + max) / 2) * critMult;
  return { min, max, avg, critMax: clampDmg(max * (1 + c.critdmg / 100)) };
}

// ---------- the page ----------
function num(id, label, min = 0, max = 99999, hint = "") {
  return `<label class="cf"><span>${label}</span><input type="number" id="c_${id}" min="${min}" max="${max}" value="${esc(calc[id])}" inputmode="numeric">${hint ? `<small>${hint}</small>` : ""}</label>`;
}
function sel(id, label, options) {
  return `<label class="cf"><span>${label}</span><select id="c_${id}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(calc[id]) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
}

function renderCalc() {
  const view = $("#calcView");
  if (!WEAPONS[calc.cls][calc.weapon]) calc.weapon = Object.keys(WEAPONS[calc.cls])[0];
  const w = WEAPONS[calc.cls][calc.weapon];
  const magic = !!w.magic;
  const melee = !!w.mult;
  view.innerHTML = `
    <div class="market-bar"><div><strong>Damage calculator</strong><br><span class="sub">Enter your character to see your damage range and how many hits each monster takes. Uses Classic World's formulas, which changed from the original game. Results are estimates.</span></div></div>
    <div class="calc-grid">
      <form class="calc-form" onsubmit="return false">
        <fieldset><legend>Character</legend>
          ${sel("cls", "Class", Object.keys(WEAPONS).map((k) => [k, k]))}
          ${sel("weapon", "Weapon", Object.keys(WEAPONS[calc.cls]).map((k) => [k, k]))}
          ${melee ? sel("motion", "Attack motion", [["avg", "Average (60% swing / 40% stab)"], ["swing", "Swing"], ["stab", "Stab"]]) : ""}
          ${num("level", "Level", 1, 200)}
        </fieldset>
        <fieldset><legend>Stats (total, with gear)</legend>
          ${num("STR", "STR")}${num("DEX", "DEX")}${num("INT", "INT")}${num("LUK", "LUK")}
        </fieldset>
        <fieldset><legend>Attack</legend>
          ${magic ? num("matk", "Magic Attack", 0, 9999, "From your wand/staff and gear, not counting INT") : num("watk", "Weapon Attack", 0, 9999, calc.weapon === "Claw" ? "Claw + gloves + throwing stars" : calc.cls === "Bowman" ? "Bow/crossbow + gear + arrows" : "Weapon + gloves + other gear")}
          ${magic ? "" : num("ap", "Attack Power", 0, 999, "From buffs like Rage, or consumables")}
          ${num("mastery", magic ? "Spell mastery (0–10)" : "Mastery (0–10)", 0, 10, magic ? "0 if unsure" : "Your weapon Mastery skill level ÷ 2 (Lv 20 = 10). 0 without one.")}
        </fieldset>
        <fieldset><legend>Skill</legend>
          ${num("skill", magic ? "Spell power %" : "Skill damage %", 1, 9999, magic ? "From the spell's tooltip" : "100 = regular attack. Power Strike at max = 260")}
          ${num("hits", "Hits per use", 1, 10, "e.g. 2 for Double Stab, Magic Claw, Lucky Seven")}
          ${calc.weapon === "Claw" ? `<label class="check cf-check"><input type="checkbox" id="c_lucky7" ${calc.lucky7 ? "checked" : ""}> Lucky Seven (uses its own multiplier)</label>` : ""}
          ${magic ? sel("element", "Spell element", ELEMENTS.map((e) => [e, e])) : ""}
        </fieldset>
        <fieldset><legend>Critical</legend>
          ${num("crit", "Crit rate %", 0, 100, "Base 5%")}${num("critdmg", "Crit damage %", 0, 500, "Base 20%")}
        </fieldset>
        <fieldset><legend>Formula</legend>
          ${sel("formula", "Version", [["majority", "NiaDB / most sites (default)"], ["wiki", "MapleClassic Wiki"]])}
          <small class="sub">Sources disagree on two details: mastery (×0.7 or ×0.8) and Attack Power (counted twice or once).${magic ? " Spells always use the NiaDB formula." : ""} If you test in game, tell us which matches!</small>
        </fieldset>
      </form>
      <div id="calcOut"></div>
    </div>`;
  view.querySelectorAll("input, select").forEach((el) => el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
    const id = el.id.slice(2);
    calc[id] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value) || 0;
    saveCalc();
    if (["cls", "weapon"].includes(id)) renderCalc(); else renderCalcOut();
  }));
  renderCalcOut();
}

function renderCalcOut() {
  const c = calc;
  const r = rawRange(c);
  const critMult = 1 + (c.crit / 100) * (c.critdmg / 100);
  const avgRaw = ((r.min + r.max) / 2) * critMult;
  const mobs = db.monsters.filter((m) => !m.variant && m.level < 200 && !m.name.startsWith("Tutorial") && (m.drops.length || idx.spawnsOf[m.id]))
    .filter((m) => !c.near || (m.level >= c.level - 15 && m.level <= c.level + 10) || m.boss)
    .sort((a, b) => a.level - b.level);
  const rows = mobs.map((m) => {
    const d = vsMonster(r, c, m);
    const perUse = d.avg * c.hits;
    const uses = Math.max(1, Math.ceil(m.hp / perUse));
    const worst = Math.ceil(m.hp / (d.min * c.hits));
    const oneShot = d.min * c.hits >= m.hp;
    return `<tr class="${oneShot ? "one-shot" : ""}">
      <td><span class="spr-cell">${sprite(m, 26)}</span>${link("monster", m.id)}${m.boss ? ' <span class="badge">Boss</span>' : ""}</td>
      <td class="num">${m.level}</td><td class="num wide-only">${fmt(m.hp)}</td>
      <td class="num">${fmt(d.min)}–${fmt(d.max)}</td>
      <td class="num"><b>${uses}</b>${worst !== uses ? `<span class="sub">–${worst}</span>` : ""}</td>
      <td class="num wide-only">${fmt(Math.round((m.exp / uses) * 10) / 10)}</td></tr>`;
  }).join("");
  $("#calcOut").innerHTML = `
    <div class="calc-result">
      <div class="sub">Your damage per hit (before monster defense)</div>
      <div class="price-big">${fmt(clampDmg(r.min))} – ${fmt(clampDmg(r.max))}</div>
      <div class="sub">Average with crits ≈ ${fmt(Math.round(avgRaw))} per hit${c.hits > 1 ? ` · ×${c.hits} hits = ≈${fmt(Math.round(avgRaw * c.hits))} per use` : ""} · max crit ${fmt(clampDmg(r.max * (1 + c.critdmg / 100)))}</div>
    </div>
    <div class="calc-table-head"><h3>Hits to kill</h3>
      <label class="check"><input type="checkbox" id="c_near" ${c.near ? "checked" : ""}> Only monsters near my level (−15 / +10) and bosses</label></div>
    <div class="calc-tablewrap"><table><thead><tr><th>Monster</th><th class="num">Lv</th><th class="num wide-only">HP</th><th class="num">Damage</th><th class="num">${c.hits > 1 ? "Uses" : "Hits"}</th><th class="num wide-only">EXP / ${c.hits > 1 ? "use" : "hit"}</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="sub">No monsters in range.</td></tr>`}</tbody></table></div>
    <p class="sub">Damage after each monster's ${r.magic ? "magic" : "weapon"} defense${r.magic && c.element !== "None" ? ", elemental weakness/resistance" : ""} and the level-gap penalty. Bold = average number needed (with crits); the small number is the worst case if every hit rolls minimum. Green rows die in one ${c.hits > 1 ? "use" : "hit"}. Accuracy and misses aren't included.</p>
    <p class="sub">Formulas: <a href="https://meowdb.com/msclassic/formulas/damage" target="_blank" rel="noopener">NiaDB</a>, <a href="https://fullboosts.com/blog/maplestory-classic/articles/maplestory-classic-damage-formula-guide" target="_blank" rel="noopener">FullBoosts</a>, <a href="https://ms-classic.com/tools/damage-calculator" target="_blank" rel="noopener">MS-Classic</a>${c.formula === "wiki" ? ', <a href="https://mapleclassic.wiki/wiki/Damage" target="_blank" rel="noopener">MapleClassic Wiki</a>' : ""}. Monster stats from the Classic game files.</p>`;
  $("#c_near").addEventListener("change", (e) => { calc.near = e.target.checked; saveCalc(); renderCalcOut(); });
}
