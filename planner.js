// Planner tab: crafting, leveling, quests and comparing two builds.
// Loaded last; uses helpers from app.js, skills.js and calc.js.

const planner = { mode: "craft", craftId: "", qty: 1, recipe: 0, have: {}, material: "", target: 0, percent: 0, questSort: "exp", locked: false, a: "", b: "" };

function renderPlanner() {
  const modes = [["craft", "Crafting"], ["level", "Leveling"], ["quests", "Quests"], ["compare", "Compare builds"]];
  $("#plannerView").innerHTML = `
    <section class="cx-intro"><div><h2>Planner</h2><p>Work out what to craft, how long a level takes, which quests pay best, and which build wins.</p></div></section>
    <div class="cx-modes plan-modes" role="radiogroup" aria-label="Planner">${modes.map(([v, t]) => `<button type="button" class="cx-mode ${planner.mode === v ? "on" : ""}" data-plan-mode="${v}" role="radio" aria-checked="${planner.mode === v}">${t}</button>`).join("")}</div>
    <div id="planBody"></div>`;
  document.querySelectorAll("[data-plan-mode]").forEach((b) => b.addEventListener("click", () => { planner.mode = b.dataset.planMode; renderPlanner(); }));
  ({ craft: renderCraftPlan, level: renderLevelPlan, quests: renderQuestPlan, compare: renderComparePlan })[planner.mode]();
}

// ---------- crafting ----------
function itemByName(text) {
  const lc = text.trim().toLowerCase();
  return db.items.find((i) => i.name.toLowerCase() === lc) || null;
}
function itemSourceText(it) {
  if (!it) return "";
  const shop = it.shops && [...it.shops].filter((s) => s.price != null).sort((a, b) => a.price - b.price)[0];
  const drop = (idx.droppedBy[it.id] || [])[0];
  const parts = [];
  if (shop) parts.push(`${fmt(shop.price)} mesos from ${link("npc", shop.npc, shop.name)}`);
  if (drop) parts.push(`drops from ${link("monster", drop.monster)}${drop.rate != null ? ` (${rateText(drop.rate)})` : ""}`);
  if (!parts.length && it.crafts) parts.push("crafted");
  return parts.join(" · ") || "no known source yet";
}
function craftBreakdown(id, qty, recipeIndex, raw, steps, stack) {
  const it = byId.items[id];
  const recipe = it?.crafts?.[stack.size === 0 ? recipeIndex : 0];
  if (!recipe || stack.has(id)) { raw[id] = (raw[id] || 0) + qty; return; }
  const batches = Math.ceil(qty / (recipe.makes || 1));
  steps.push({ id, batches, recipe });
  const next = new Set(stack).add(id);
  for (const m of recipe.materials) craftBreakdown(m.item, batches * m.count, 0, raw, steps, next);
  if (recipe.catalyst) raw[recipe.catalyst.item] = (raw[recipe.catalyst.item] || 0) + batches * recipe.catalyst.count;
}
function renderCraftPlan() {
  const body = $("#planBody");
  const craftable = db.items.filter((i) => i.crafts);
  body.innerHTML = `<section class="calc-card plan-form">
      <label class="cf"><span>Item to craft</span><input id="crItem" type="search" list="crItems" value="${esc(byId.items[planner.craftId]?.name || "")}" placeholder="Start typing an item…" autocomplete="off"></label>
      <label class="cf plan-small"><span>How many</span><input id="crQty" type="number" min="1" max="9999" value="${planner.qty}" inputmode="numeric"></label>
      <datalist id="crItems">${craftable.map((i) => `<option value="${esc(i.name)}"></option>`).join("")}</datalist>
    </section>
    <section class="calc-card" id="crResult"></section>
    <section class="calc-card"><h3 class="plan-h">What can I make with this?</h3>
      <label class="cf"><span>Material you have</span><input id="crMat" type="search" list="crMats" value="${esc(planner.material)}" placeholder="Start typing a material…" autocomplete="off"></label>
      <datalist id="crMats">${Object.keys(idx.usedIn).map((id) => byId.items[id]).filter(Boolean).map((i) => `<option value="${esc(i.name)}"></option>`).join("")}</datalist>
      <div id="crUses"></div></section>`;
  const paintUses = () => {
    const it = itemByName(planner.material);
    const uses = it ? (idx.usedIn[it.id] || []).map((id) => byId.items[id]) : [];
    $("#crUses").innerHTML = !planner.material.trim() ? "" : uses.length
      ? `<ul class="home-list">${uses.map((u) => { const r = u.crafts.find((x) => x.materials.some((m) => m.item === it.id)); return `<li><span class="home-text">${link("item", u.id)} <small>${esc(r.skill)} ${r.level}</small></span><button type="button" class="cx-auto" data-craft="${esc(u.id)}">Plan it</button></li>`; }).join("")}</ul>`
      : `<p class="sub empty">No recipe uses that yet.</p>`;
    $("#crUses").querySelectorAll("[data-craft]").forEach((b) => b.addEventListener("click", () => { planner.craftId = b.dataset.craft; planner.recipe = 0; renderCraftPlan(); }));
  };
  const paint = () => {
    const box = $("#crResult");
    const it = byId.items[planner.craftId];
    if (!it?.crafts) { box.innerHTML = `<p class="sub empty">Pick an item to see everything it takes. ${craftable.length} items can be crafted.</p>`; return; }
    const index = Math.min(planner.recipe, it.crafts.length - 1);
    const raw = {}, steps = [];
    craftBreakdown(it.id, Math.max(1, planner.qty), index, raw, steps, new Set());
    const recipe = it.crafts[index];
    const skills = {};
    for (const s of steps) skills[s.recipe.skill] = Math.max(skills[s.recipe.skill] || 0, s.recipe.level);
    const merged = new Map();
    for (const s of [...steps].reverse()) {
      const seen = merged.get(s.id);
      if (seen) seen.batches += s.batches; else merged.set(s.id, { ...s });
    }
    const rawRows = Object.entries(raw).sort((a, b) => (byId.items[a[0]]?.name || a[0]).localeCompare(byId.items[b[0]]?.name || b[0]));
    box.innerHTML = `<h3 class="plan-h">${link("item", it.id)}${recipe.makes > 1 ? ` <span class="sub">makes ${recipe.makes} per craft</span>` : ""}</h3>
      ${it.crafts.length > 1 ? `<label class="cf"><span>Recipe</span><select id="crRecipe">${it.crafts.map((r, i) => `<option value="${i}" ${i === index ? "selected" : ""}>${esc(r.skill)} ${r.level}: ${r.materials.map((m) => `${m.count}× ${byId.items[m.item]?.name || m.item}`).join(", ")}</option>`).join("")}</select></label>` : ""}
      <p class="sub small">Skills needed: ${Object.entries(skills).map(([k, v]) => `${esc(k)} level ${v}`).join(", ")}.</p>
      ${steps.length > 1 ? `<h4 class="cx-drops-title">Crafting steps</h4><ol class="plan-steps">${[...merged.values()].map((s) => `<li>Craft ${s.batches}× ${link("item", s.id)} <span class="sub">(${esc(s.recipe.skill)} ${s.recipe.level})</span></li>`).join("")}</ol>` : ""}
      <h4 class="cx-drops-title">Everything you need to gather</h4>
      <div class="plan-mats">${rawRows.map(([id, n]) => `<div class="plan-mat"><span class="home-text">${link("item", id)} <small>${itemSourceText(byId.items[id])}</small></span>
        <label class="plan-have"><span>Have</span><input type="number" min="0" data-have="${esc(id)}" data-need="${n}" value="${planner.have[id] || ""}" placeholder="0" inputmode="numeric" aria-label="How many you have"></label>
        <b class="plan-left" data-left="${esc(id)}">${Math.max(0, n - (planner.have[id] || 0))} of ${n}</b></div>`).join("")}</div>`;
    $("#crRecipe")?.addEventListener("change", (e) => { planner.recipe = Number(e.target.value); paint(); });
    box.querySelectorAll("[data-have]").forEach((el) => el.addEventListener("input", () => {
      planner.have[el.dataset.have] = parseInt(el.value, 10) || 0;
      const n = Number(el.dataset.need);
      box.querySelector(`[data-left="${CSS.escape(el.dataset.have)}"]`).textContent = `${Math.max(0, n - planner.have[el.dataset.have])} of ${n}`;
    }));
  };
  $("#crItem").addEventListener("input", (e) => {
    const it = itemByName(e.target.value);
    if (it?.crafts) { planner.craftId = it.id; planner.recipe = 0; paint(); } else if (!e.target.value.trim()) { planner.craftId = ""; paint(); }
  });
  $("#crQty").addEventListener("input", (e) => { const n = parseInt(e.target.value, 10); if (n >= 1) { planner.qty = n; paint(); } });
  $("#crQty").addEventListener("blur", (e) => { e.target.value = planner.qty; });
  $("#crMat").addEventListener("input", (e) => { planner.material = e.target.value; paintUses(); });
  paint();
  paintUses();
}

// ---------- leveling ----------
function renderLevelPlan() {
  const body = $("#planBody");
  if (!planner.target || planner.target <= calc.level) planner.target = Math.min(calc.level + 5, 200);
  body.innerHTML = `<section class="calc-card plan-form">
      <label class="cf plan-small"><span>Your level</span><input id="lvFrom" type="number" min="1" max="199" value="${calc.level}" inputmode="numeric"></label>
      <label class="cf plan-small"><span>EXP so far %</span><input id="lvPct" type="number" min="0" max="99" value="${planner.percent || ""}" placeholder="0" inputmode="decimal"></label>
      <label class="cf plan-small"><span>Target level</span><input id="lvTo" type="number" min="2" max="200" value="${planner.target}" inputmode="numeric"></label>
    </section><section class="calc-card" id="lvResult"></section>`;
  const paint = () => {
    const box = $("#lvResult");
    const from = calc.level, to = planner.target;
    if (to <= from) { box.innerHTML = `<p class="sub empty">Pick a target above your level.</p>`; return; }
    const c = withGear(calc), r = rawRange(c);
    const best = [...guideEntries(c, r).usable].sort((a, b) => b.rate.exp - a.rate.exp)[0];
    let total = -expToNext(from) * ((planner.percent || 0) / 100);
    const rows = [];
    for (let lv = from; lv < to; lv++) { total += expToNext(lv); if ((lv + 1) % 5 === 0 || lv + 1 === to) rows.push([lv + 1, total]); }
    const hours = best?.rate.exp ? total / best.rate.exp : null;
    const time = (h) => (h == null ? "—" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h.toFixed(h < 10 ? 1 : 0)} hours`);
    const spFor = (lv) => spAvailable(lv, 1) + spAvailable(lv, 2);
    box.innerHTML = `<div class="match-grid plan-grid">
        <div><span>EXP needed</span><b>${shortNum(total)}</b></div>
        <div><span>At your best spot</span><b>${time(hours)}</b></div>
        <div><span>AP at level ${to}</span><b>${AP_AT(to)}</b></div>
        <div><span>SP at level ${to}</span><b>${spFor(to)}</b></div>
      </div>
      ${best ? `<p class="sub small">Best spot right now: ${link("monster", best.m.id)} in ${link("map", best.rate.best.map)}, about ${shortNum(best.rate.exp)} EXP an hour with your calculator setup. You'd speed up as you level and upgrade, so treat the time as a ceiling.</p>` : `<p class="sub small">Add your gear in the calculator to estimate the time.</p>`}
      ${from < 30 && to >= 30 ? `<p class="sub small">2nd job advancement opens at level 30.</p>` : ""}
      <div class="calc-tablewrap"><table><thead><tr><th>Reach level</th><th class="num">Total EXP</th><th class="num">Time</th></tr></thead><tbody>${rows.map(([lv, e]) => `<tr><td>${lv}</td><td class="num">${fmt(Math.round(e))}</td><td class="num">${time(best?.rate.exp ? e / best.rate.exp : null)}</td></tr>`).join("")}</tbody></table></div>`;
  };
  $("#lvFrom").addEventListener("input", (e) => { const n = parseInt(e.target.value, 10); if (n >= 1) { calc.level = n; saveCalc(); paint(); } });
  $("#lvFrom").addEventListener("blur", (e) => { e.target.value = calc.level; });
  $("#lvPct").addEventListener("input", (e) => { planner.percent = Math.max(0, Math.min(99.99, parseFloat(e.target.value) || 0)); paint(); });
  $("#lvTo").addEventListener("input", (e) => { const n = parseInt(e.target.value, 10); if (n >= 1) { planner.target = Math.min(n, 200); paint(); } });
  paint();
}

// ---------- quests ----------
function renderQuestPlan() {
  const body = $("#planBody");
  const lv = calc.level, cls = calc.cls;
  const fits = (q) => !isDone(q.id) && !q.event && q.level <= lv && (!q.max_level || q.max_level >= lv) && (!q.jobs || lv < 10 || cls === "Beginner" || q.jobs.includes(cls));
  const ready = (q) => q.pre.every(isDone);
  let list = db.quests.filter(fits);
  const openCount = list.filter(ready).length;
  if (!planner.locked) list = list.filter(ready);
  const sorters = { exp: (a, b) => (b.exp || 0) - (a.exp || 0), meso: (a, b) => (b.meso || 0) - (a.meso || 0), level: (a, b) => b.level - a.level };
  list = [...list].sort(sorters[planner.questSort] || sorters.exp);
  const totals = db.quests.filter((q) => fits(q) && ready(q));
  const totalExp = totals.reduce((a, q) => a + (q.exp || 0), 0), totalMeso = totals.reduce((a, q) => a + (q.meso || 0), 0);
  body.innerHTML = `<section class="calc-card">
      <div class="card-head"><h3>For ${esc(activeChar().name)}: ${esc(cls)}, level ${lv}</h3>
        <select id="qpSort" aria-label="Sort quests">${[["exp", "Most EXP"], ["meso", "Most mesos"], ["level", "Highest level"]].map(([v, t]) => `<option value="${v}" ${planner.questSort === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <label class="check plan-check"><input id="qpLocked" type="checkbox" ${planner.locked ? "checked" : ""}> Show quests that need another quest first</label>
      <p class="sub small">${openCount} quests open now, worth ${shortNum(totalExp)} EXP${expToNext(lv) ? ` (${Math.round((totalExp / expToNext(lv)) * 100)}% of this level)` : ""} and ${shortNum(totalMeso)} mesos. Your finished quests are left out.</p>
      ${list.length ? `<div class="cx-guide">${list.slice(0, 40).map((q) => {
        const spot = q.giver && getEntity("npc", q.giver)?.locations[0];
        const lockedBy = q.pre.filter((id) => !isDone(id));
        const rewards = [...q.rewards.map((x) => x.item), ...q.choice.map((x) => x.item)].slice(0, 3).map((id) => byId.items[id]?.name).filter(Boolean);
        return `<div class="plan-quest"><span class="cx-guide-main"><b>${link("quest", q.id)}</b>
            <small>Lv ${q.level} · ${esc(q.giver_name || q.area)}${spot ? ` · ${esc(getEntity("map", spot.map)?.name || "")}` : ""}</small>
            <span class="cx-guide-nums"><i class="${planner.questSort === "exp" ? "on" : ""}"><b>${shortNum(q.exp || 0)}</b> EXP</i><i class="${planner.questSort === "meso" ? "on" : ""}"><b>${shortNum(q.meso || 0)}</b> mesos</i></span>
            ${rewards.length ? `<small>Rewards: ${esc(rewards.join(", "))}</small>` : ""}
            ${q.cost ? `<small>Costs ${fmt(q.cost)} mesos to do</small>` : ""}
            ${lockedBy.length ? `<small class="cx-danger">First finish: ${lockedBy.slice(0, 2).map((id) => link("quest", id)).join(", ")}</small>` : ""}</span>
          ${spot ? `<button type="button" class="cx-auto" data-route-to="${esc(spot.map)}">Route</button>` : ""}</div>`;
      }).join("")}</div>${list.length > 40 ? `<p class="sub small">Showing the top 40 of ${list.length}.</p>` : ""}` : `<p class="sub empty">No quests match right now.</p>`}
    </section>`;
  $("#qpSort").addEventListener("change", (e) => { planner.questSort = e.target.value; renderQuestPlan(); });
  $("#qpLocked").addEventListener("change", (e) => { planner.locked = e.target.checked; renderQuestPlan(); });
}

// ---------- compare builds ----------
function renderComparePlan() {
  const body = $("#planBody");
  if (shared) { body.innerHTML = `<section class="calc-card"><p class="sub empty">Save or leave the shared build in the calculator first.</p></section>`; return; }
  if (chars.list.length < 2) {
    body.innerHTML = `<section class="calc-card"><p class="sub empty">You need two characters to compare. Copy this one, then change its gear or stats in the calculator.</p>
      <button type="button" class="btn" id="cmpCopy">Copy ${esc(activeChar().name)}</button></section>`;
    $("#cmpCopy").addEventListener("click", () => { duplicateCharacter(); switchTab("planner"); });
    return;
  }
  if (!chars.list.some((x) => x.id === planner.a)) planner.a = chars.active;
  if (!chars.list.some((x) => x.id === planner.b) || planner.b === planner.a) planner.b = (chars.list.find((x) => x.id !== planner.a) || {}).id;
  const options = (id) => chars.list.map((x) => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${esc(x.name)}${charSummary(x) ? ` · ${esc(charSummary(x))}` : ""}</option>`).join("");
  const a = evalBuild(chars.list.find((x) => x.id === planner.a));
  const b = evalBuild(chars.list.find((x) => x.id === planner.b));
  const mob = calc.target && getEntity("monster", calc.target);
  const row = (label, key, format = fmt, lowerBetter = false) => {
    const x = a[key], y = b[key];
    const win = x === y || x == null || y == null ? "" : (x > y) !== lowerBetter ? "a" : "b";
    return `<tr><td>${label}</td><td class="num ${win === "a" ? "cmp-win" : ""}">${x == null ? "—" : format(x)}</td><td class="num ${win === "b" ? "cmp-win" : ""}">${y == null ? "—" : format(y)}</td></tr>`;
  };
  const text = (label, x, y) => `<tr><td>${label}</td><td class="num">${esc(x)}</td><td class="num">${esc(y)}</td></tr>`;
  body.innerHTML = `<section class="calc-card plan-form">
      <label class="cf"><span>Build A</span><select id="cmpA">${options(planner.a)}</select></label>
      <label class="cf"><span>Build B</span><select id="cmpB">${options(planner.b)}</select></label>
    </section>
    <section class="calc-card"><div class="calc-tablewrap"><table class="cmp-table"><thead><tr><th></th><th class="num">${esc(a.name)}</th><th class="num">${esc(b.name)}</th></tr></thead><tbody>
      ${text("Class and level", `${a.cls} ${a.level}`, `${b.cls} ${b.level}`)}
      ${text("Weapon", a.weapon, b.weapon)}
      <tr><td>Skill</td>${[a, b].map((x) => `<td class="num"><span class="sk-cell">${skillIcon(x.skill)}<span>${esc(x.skillName)}</span></span></td>`).join("")}</tr>
      ${row("Lowest hit", "min")}${row("Highest hit", "max")}${row("Average per use", "avg")}
      ${row("Accuracy", "acc")}${row("Crit rate %", "crit")}${row("HP", "hp")}${row("MP", "mp")}
      ${row("Weapon DEF", "wdef")}${row("Magic DEF", "mdef")}${row("Avoid", "avoid")}
      ${row("Best EXP per hour", "bestExp", shortNum)}
      ${text("Best spot", a.bestSpot, b.bestSpot)}
      ${mob ? row(`${esc(mob.name)}: hits to kill`, "mobUses", fmt, true) + row(`${esc(mob.name)}: hit chance %`, "mobHit") + row(`${esc(mob.name)}: EXP per hour`, "mobExp", shortNum) : ""}
    </tbody></table></div>
    <p class="sub small">Green marks the better number. ${mob ? "" : "Pick a monster in the calculator to compare a fight too. "}Each build uses its own saved gear, skills and buffs.</p>
    <button type="button" class="cx-auto" id="cmpCopy">Copy ${esc(activeChar().name)} as a new build</button></section>`;
  $("#cmpA").addEventListener("change", (e) => { planner.a = e.target.value; renderComparePlan(); });
  $("#cmpB").addEventListener("change", (e) => { planner.b = e.target.value; renderComparePlan(); });
  $("#cmpCopy").addEventListener("click", () => { duplicateCharacter(); switchTab("planner"); });
}
