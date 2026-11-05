// Classic World skills (every level) from data/skills.json, which the auto-update downloads
// from the game files (maplestory.io, MCW v1 = launch v1.0.0). A few skills changed in the
// Oct 29, 2026 patch (v1.1.0); those are corrected or flagged below.
// Loaded after app.js and before calc.js.

// Weapon type codes used by the game data.
const WEAPON_CODE = {
  "1H Sword": 30, "1H Axe": 31, "1H Blunt": 32, "Dagger": 33, "2H Sword": 40, "2H Axe": 41, "2H Blunt": 42,
  "Spear": 43, "Polearm": 44, "Bow": 45, "Crossbow": 46, "Claw": 47,
};
const MASTERY_SKILL = {
  "1H Sword": "Sword Mastery", "2H Sword": "Sword Mastery", "1H Axe": "Axe Mastery", "2H Axe": "Axe Mastery",
  "1H Blunt": "Blunt Weapon Mastery", "2H Blunt": "Blunt Weapon Mastery", "Spear": "Spear Mastery", "Polearm": "Polearm Mastery",
  "Bow": "Bow Mastery", "Crossbow": "Crossbow Mastery", "Claw": "Claw Mastery", "Dagger": "Dagger Mastery",
};
// In the launch data the real numbers for these two sit in an unnamed entry.
const SKILL_MERGE = { 2101005: 2101004, 3101005: 3101004 };
// Oct 29 patch (v1.1.0) changes. "add" is applied to every level; "note" is shown on the skill.
const SKILL_PATCH = {
  2101004: { add: { mad: 10 }, note: "Includes the Oct 29 patch (+10 spell power at every level)." },
  2201004: { note: "Buffed in the Oct 29 patch. The new numbers aren't published yet, so these are launch values. Check your in-game tooltip." },
  3001000: { note: "Accuracy raised in the Oct 29 patch. The new numbers aren't published yet, so these are launch values." },
  1101005: { note: "Range at level 10 was fixed in the Oct 29 patch." }, 1201005: { note: "Range at level 10 was fixed in the Oct 29 patch." }, 1301005: { note: "Range at level 10 was fixed in the Oct 29 patch." },
  1301000: { note: "HP absorb is capped at 15% of max HP since the Oct 29 patch." }, 1301001: { note: "HP absorb is capped at 15% of max HP since the Oct 29 patch." },
};
// Skills that use a special damage rule (see calc.js).
const SKILL_RULES = { 4001003: { lucky7: true }, 4101002: { drain: true }, 4001002: { motion: "stab" }, 4201003: { motion: "stab" } };
const NOT_DIRECT_ATTACK = /^Final Attack|^Heal$|^Power Knockback$/;

const SK = { jobs: [], byId: {}, byName: {} };

function buildSkills() {
  const raw = db.skills?.jobs || [];
  const unnamed = {};
  for (const j of raw) for (const s of j.skills) if (SKILL_MERGE[s.id]) unnamed[SKILL_MERGE[s.id]] = s;
  SK.jobs = raw.map((j) => ({
    job: j.job, cls: j.class, name: j.name, tier: j.job % 100 === 0 ? (j.job === 0 ? 0 : 1) : 2,
    skills: j.skills.filter((s) => !SKILL_MERGE[s.id] && s.name).map((s) => {
      const src = unnamed[s.id] || s;
      const p = SKILL_PATCH[s.id];
      const levels = src.levels.map((l) => {
        const out = { ...l };
        if (p?.add) for (const [k, v] of Object.entries(p.add)) if (typeof out[k] === "number") out[k] += v;
        return out;
      });
      const top = levels[levels.length - 1] || {};
      const sk = {
        id: s.id, name: s.name, job: j.job, jobName: j.name, max: s.max, weapons: s.weapons || [], levels,
        note: p?.note || null, rule: SKILL_RULES[s.id] || {},
        magic: (top.mad || 0) > 0, attack: ((top.damage || 0) > 0 || (top.mad || 0) > 0) && !NOT_DIRECT_ATTACK.test(s.name),
      };
      SK.byId[s.id] = sk;
      (SK.byName[s.name] ||= []).push(sk);
      return sk;
    }),
  }));
}
// A skill's icon from the game files. A regular attack or custom value has none, so it gets a plain tile.
function skillIcon(sk) {
  return `<span class="cx-ico">${sk?.levels ? `<img src="assets/skill/${sk.id}.png" alt="" loading="lazy" onerror="this.remove()">` : "<i>⚔</i>"}</span>`;
}
function skillAt(sk, lv) { return lv >= 1 ? sk.levels[Math.min(lv, sk.max) - 1] || {} : {}; }
function skillHits(l) { return Math.max(1, (l.attackCount || 1) * (l.bulletCount && l.bulletCount > 1 ? l.bulletCount : 1)); }
function classJobs(cls) { return SK.jobs.filter((j) => j.cls === cls); }
function secondJobs(cls) { return classJobs(cls).filter((j) => j.tier === 2); }

// Plain-language summary of one level.
function describeLevel(sk, l) {
  if (!l || !Object.keys(l).length) return "Not learned";
  const parts = [];
  if (l.damage) parts.push(`${l.damage}% damage`);
  if (l.mad) parts.push(`${l.mad} spell power`);
  const hits = skillHits(l);
  if ((l.damage || l.mad) && hits > 1) parts.push(`${hits} hits`);
  if (l.mobCount > 1) parts.push(`up to ${l.mobCount} monsters`);
  if (l.mastery && /Mastery/.test(sk.name)) parts.push(`mastery ${l.mastery}`);
  else if (l.mastery && sk.magic) parts.push(`mastery ${l.mastery}`);
  if (l.x && /Mastery/.test(sk.name)) parts.push(`+${l.x} accuracy`);
  if (l.indiePad) parts.push(`+${l.indiePad} attack`);
  if (l.indieMad) parts.push(`+${l.indieMad} magic attack`);
  if (l.indiePdd) parts.push(`${l.indiePdd > 0 ? "+" : ""}${l.indiePdd} weapon DEF`);
  if (l.indiePddR) parts.push(`+${l.indiePddR}% weapon DEF`);
  if (l.indieMdd) parts.push(`+${l.indieMdd} magic DEF`);
  if (l.indieAcc || l.accX) parts.push(`+${l.indieAcc || l.accX} accuracy`);
  if (l.indieEva || l.evaX) parts.push(`+${l.indieEva || l.evaX} avoid`);
  if (l.crtX) parts.push(`+${l.crtX}% crit rate`);
  if (l.crdX) parts.push(`+${l.crdX}% crit damage`);
  if (l.indieSpeed) parts.push(`+${l.indieSpeed} speed`);
  if (l.indieJump) parts.push(`+${l.indieJump} jump`);
  if (l.y && /HP Recovery/.test(sk.name)) parts.push(`+${l.y} HP recovered`);
  if (l.y && /MP Recovery/.test(sk.name)) parts.push(`+${l.y} MP recovered`);
  if (l.mhpR) parts.push(`+${l.mhpR}% max HP`);
  if (l.mmpR) parts.push(`+${l.mmpR}% max MP`);
  if (l.dot) parts.push(`${l.dot} damage over ${l.dotTime || "?"}s`);
  if (l.prop && l.prop < 100) parts.push(`${l.prop}% chance`);
  if (l.time && l.time >= 10) parts.push(`lasts ${l.time >= 60 ? Math.round(l.time / 60) + " min" : l.time + "s"}`);
  if (l.cooltime) parts.push(`${l.cooltime}s cooldown`);
  if (l.mpCon) parts.push(`${l.mpCon} MP`);
  if (l.hpCon) parts.push(`${l.hpCon} HP`);
  return parts.join(" · ") || "Passive effect";
}

// ---------- the character's skill plan ----------
function plan() { return typeof shared !== "undefined" && shared ? (shared.skills ||= {}) : (activeChar().skills ||= {}); }
function planLevel(id) { return plan()[id] || 0; }
function setPlanLevel(id, lv) {
  const sk = SK.byId[id];
  const v = Math.max(0, Math.min(sk ? sk.max : 30, lv | 0));
  if (v) plan()[id] = v; else delete plan()[id];
  saveChars();
}
// level a skill is used at: the plan if set, else max
function usedLevel(sk) { return planLevel(sk.id) || sk.max; }

// ---------- Skills tab (skill-point planner) ----------
function spAvailable(level, tier) {
  // Each job advancement gives 1 SP, then every level gives 3 (NiaDB's leveling formulas,
  // https://meowdb.com/msclassic/formulas/leveling).
  if (tier === 1) return level >= 10 ? 1 + (Math.min(level, 30) - 10) * 3 : 0;
  if (tier === 2) return level >= 30 ? 1 + (Math.min(level, 70) - 30) * 3 : 0;
  return 0;
}

function renderSkillsTab() {
  const view = $("#skillsView");
  if (!SK.jobs.length) { view.innerHTML = `<p class="sub">Skill data is still loading. It arrives with the next automatic update.</p>`; return; }
  const c = activeChar();
  const k = { ...DEFAULTS, ...(c.calc || {}) };
  const cls = k.cls;
  const seconds = secondJobs(cls);
  if (!seconds.some((j) => j.job === c.job2)) c.job2 = seconds[0]?.job;
  const first = classJobs(cls).find((j) => j.tier === 1);
  const second = seconds.find((j) => j.job === c.job2);
  const tree = (j, tier) => {
    if (!j) return "";
    const spent = j.skills.reduce((a, s) => a + planLevel(s.id), 0);
    const avail = spAvailable(k.level, tier);
    const over = spent > avail;
    return `<section class="sk-tree">
      <div class="sk-head"><h3>${esc(j.name)} <span class="sub">${tier === 1 ? "1st job" : "2nd job"}</span></h3>
        <span class="sp ${over ? "over" : ""}"><b>${spent}</b> / ${avail} SP</span></div>
      ${j.skills.map((s) => {
        const lv = planLevel(s.id);
        const next = lv < s.max ? describeLevel(s, skillAt(s, lv + 1)) : null;
        return `<div class="sk-row ${lv ? "on" : ""}">
          ${skillIcon(s)}
          <div class="sk-main"><span class="sk-name"><b>${esc(s.name)}</b>${s.attack ? '<span class="badge">Attack</span>' : ""}</span>
            <span class="sk-now">${lv ? esc(describeLevel(s, skillAt(s, lv))) : "Not learned"}</span>
            ${next ? `<span class="sk-next">Next: ${esc(next)}</span>` : ""}
            ${s.note ? `<span class="sk-note">${esc(s.note)}</span>` : ""}</div>
          <div class="stepper" role="group" aria-label="${esc(s.name)} level">
            <button type="button" data-sk="${s.id}" data-d="-1" ${lv ? "" : "disabled"} aria-label="Lower">−</button>
            <span><b>${lv}</b>/${s.max}</span>
            <button type="button" data-sk="${s.id}" data-d="1" ${lv < s.max ? "" : "disabled"} aria-label="Raise">+</button>
            <button type="button" class="mx" data-sk="${s.id}" data-d="99" ${lv < s.max ? "" : "disabled"}>Max</button>
          </div></div>`;
      }).join("")}
    </section>`;
  };
  view.innerHTML = `
    <section class="calc-hero sk-hero">
      <div><h2>Skill planner</h2>
        <p>Plan where your skill points go and see exactly what each skill does at every level. The plan is saved to <b>${esc(c.name)}</b> and the calculator uses it automatically.</p></div>
      <div class="sk-pick">
        <label class="cf"><span>Class</span><select id="sk_cls">${Object.keys(WEAPONS).map((x) => `<option ${x === cls ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="cf"><span>2nd job</span><select id="sk_job2">${seconds.map((j) => `<option value="${j.job}" ${j.job === c.job2 ? "selected" : ""}>${esc(j.name)}</option>`).join("")}</select></label>
        <label class="cf"><span>Level</span><input id="sk_level" type="number" min="1" max="200" value="${k.level}" inputmode="numeric"></label>
      </div>
    </section>
    <div class="sk-actions"><button type="button" class="btn ghost" id="sk_reset">Reset plan</button>
      <span class="sub small">Skill values come from the Classic game files. SP shown as 1 per job advancement plus 3 per level (<a href="https://meowdb.com/msclassic/formulas/leveling" target="_blank" rel="noopener">NiaDB</a>).</span></div>
    ${first ? "" : `<p class="sub">Beginners don't have job skills to plan here yet. Pick a class to see its skills.</p>`}
    <div class="sk-grid">${tree(first, 1)}${tree(second, 2)}</div>`;
  view.querySelectorAll(".stepper button").forEach((b) => b.addEventListener("click", () => {
    const id = Number(b.dataset.sk), d = Number(b.dataset.d), sk = SK.byId[id];
    setPlanLevel(id, d === 99 ? sk.max : planLevel(id) + d);
    renderSkillsTab();
  }));
  $("#sk_cls").onchange = (e) => { c.calc = { ...k, cls: e.target.value, weapon: Object.keys(WEAPONS[e.target.value])[0], skillId: "basic" }; saveChars(); loadCalcFromChar(); renderSkillsTab(); };
  $("#sk_job2").onchange = (e) => { c.job2 = Number(e.target.value); saveChars(); renderSkillsTab(); };
  $("#sk_level").onchange = (e) => { c.calc = { ...k, level: Number(e.target.value) || 1 }; saveChars(); loadCalcFromChar(); renderSkillsTab(); };
  let armed = false;
  $("#sk_reset").onclick = (e) => {
    if (!armed) { armed = true; e.target.textContent = "Tap again to reset"; setTimeout(() => { armed = false; if (e.target.isConnected) e.target.textContent = "Reset plan"; }, 3000); return; }
    c.skills = {}; saveChars(); renderSkillsTab();
  };
}
