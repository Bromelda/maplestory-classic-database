// Live tracker: reads the game by screen share, in this browser only. It only looks at the picture.
// It never touches the game's memory, files or controls, and frames are never uploaded.
// EXP comes from the EXP bar ("EXP 11,513 [15.75%]"): a flat background, and a missed reading costs nothing
// because the next one carries the same total. Mesos and items come from the see-through pickup log, so they can undercount.

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const LIVE_KEY = "msclassicdb.liveRegions";
const LIVE_REGIONS = { exp: { label: "EXP numbers", color: "#ffd24a", box: [0.525, 0.955, 0.09, 0.027] }, map: { label: "Map name", color: "#7fd0ff", box: [0.033, 0.058, 0.076, 0.044] }, log: { label: "Pickup messages", color: "#8fe0ad", box: [0.68, 0.62, 0.32, 0.25] } };

const live = {
  stream: null, video: null, frame: null, image: null, worker: null, workerState: "off", busy: false, timer: null,
  regions: null, marking: null, session: null, raw: { exp: "", map: "", log: "" }, mapId: null, mapName: "", lastExp: null, error: "", note: "",
};

function liveRegions() {
  if (live.regions) return live.regions;
  live.regions = Object.fromEntries(Object.entries(LIVE_REGIONS).map(([k, v]) => [k, [...v.box]]));
  try {
    const saved = JSON.parse(localStorage.getItem(LIVE_KEY) || "null");
    for (const k of Object.keys(live.regions)) if (Array.isArray(saved?.[k]) && saved[k].length === 4 && saved[k].every((n) => typeof n === "number")) live.regions[k] = saved[k];
  } catch { /* storage unavailable */ }
  return live.regions;
}
function saveRegions() { try { localStorage.setItem(LIVE_KEY, JSON.stringify(live.regions)); } catch { /* storage unavailable */ } }

// ---------- reading text out of pictures ----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("couldn't load the text reader"));
    document.head.append(s);
  });
}
async function liveWorker() {
  if (live.worker) return live.worker;
  live.workerState = "loading";
  paintLive();
  if (!window.Tesseract) await loadScript(TESSERACT_URL);
  live.worker = await window.Tesseract.createWorker("eng");
  live.workerState = "ready";
  paintLive();
  return live.worker;
}
// crop, enlarge and turn into dark text on white, which reads far better
function cropForReading(source, box, mode) {
  const w = source.width || source.videoWidth, h = source.height || source.videoHeight;
  const sx = Math.max(0, Math.round(box[0] * w)), sy = Math.max(0, Math.round(box[1] * h));
  const sw = Math.max(1, Math.min(w - sx, Math.round(box[2] * w))), sh = Math.max(1, Math.min(h - sy, Math.round(box[3] * h)));
  const scale = Math.min(4, Math.max(2, Math.round(60 / Math.max(1, sh / (mode === "log" ? 6 : mode === "map" ? 2 : 1)))));
  const out = document.createElement("canvas");
  out.width = sw * scale; out.height = sh * scale;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const px = ctx.getImageData(0, 0, out.width, out.height);
  const d = px.data, cut = mode === "exp" ? 150 : 185;
  for (let i = 0; i < d.length; i += 4) {
    // bright, near-neutral text stands out; for the log, yellow party lines count too
    const low = mode === "log" ? Math.max(Math.min(d[i], d[i + 1]), Math.min(d[i + 1], d[i + 2])) : Math.min(d[i], d[i + 1], d[i + 2]);
    const v = low >= cut ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(px, 0, 0);
  return out;
}
const READ_SETTINGS = {
  exp: { tessedit_char_whitelist: "EXPexp0123456789,.[]()%: ", tessedit_pageseg_mode: "7" },
  map: { tessedit_char_whitelist: "", tessedit_pageseg_mode: "6" },
  log: { tessedit_char_whitelist: "", tessedit_pageseg_mode: "6" },
};
async function readBox(source, kind) {
  const worker = await liveWorker();
  await worker.setParameters(READ_SETTINGS[kind]);
  const { data } = await worker.recognize(cropForReading(source, liveRegions()[kind], kind));
  return data.text.trim();
}

// find the status bar and minimap by their own words, so any window size and UI size works
async function wordsIn(source, sx, sy, sw, sh) {
  const worker = await liveWorker();
  const c = document.createElement("canvas");
  c.width = sw * 2; c.height = sh * 2;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "11" });
  const { data } = await worker.recognize(c, {}, { blocks: true, text: true });
  return (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))).map((word) => ({
    text: word.text, x0: word.bbox.x0 / 2 + sx, x1: word.bbox.x1 / 2 + sx, y0: word.bbox.y0 / 2 + sy, y1: word.bbox.y1 / 2 + sy,
  }));
}
async function autoFindBoxes(source) {
  const w = source.width, h = source.height;
  const found = [];
  const bottom = Math.round(h * 0.85);
  const low = await wordsIn(source, 0, bottom, w, h - bottom);
  const exp = low.find((x) => /^EXP/i.test(x.text));
  if (exp) {
    const size = Math.max(8, exp.y1 - exp.y0);
    live.regions.exp = [Math.max(0, exp.x0 - size * 0.4) / w, Math.max(0, exp.y0 - size * 0.45) / h, (size * 13) / w, (size * 1.9) / h];
    found.push("EXP");
  }
  const topW = Math.round(w * 0.45), topH = Math.round(h * 0.25);
  const high = await wordsIn(source, 0, 0, topW, topH);
  const miniWord = high.find((x) => /^MINI$/i.test(x.text));
  const mapWord = high.find((x) => /^MAP$/i.test(x.text));
  const mini = miniWord || mapWord;
  const world = high.find((x) => /^WORLD$/i.test(x.text));
  if (mini) {
    const size = Math.max(8, mini.y1 - mini.y0);
    const left = miniWord ? mini.x0 : Math.max(0, mini.x0 - size * 3.5);
    const right = world ? world.x1 + size : left + size * 20;
    // the two-line name sits under the header, to the right of the map's small emblem
    live.regions.map = [(left + (right - left) * 0.27) / w, (mini.y1 + size * 0.45) / h, ((right - left) * 0.73) / w, (size * 4.3) / h];
    found.push("map");
  }
  saveRegions();
  return found;
}

// ---------- making sense of what was read ----------
function parseExpText(text) {
  // the percent is the most reliable anchor: read it first, then take the number before it
  const clean = String(text).replace(/\s+/g, " ");
  const pct = clean.match(/(\d{1,2})[.,](\d{2})\s*%/);
  if (!pct) return null;
  const before = clean.slice(0, pct.index).replace(/^[^\d]*/, "");
  const number = before.match(/^\d{1,3}(?:[,.]\s?\d{3})*|^\d+/);
  if (!number) return null;
  const value = parseInt(number[0].replace(/\D/g, ""), 10);
  return Number.isFinite(value) ? { value, pct: parseFloat(`${pct[1]}.${pct[2]}`) } : null;
}
// the EXP table doubles as a misread check: the number and percent have to agree on a real level
function expLevel(value, pct, near) {
  const fits = (lv) => {
    const need = expToNext(lv);
    return value < need && Math.abs((value / need) * 100 - pct) <= 0.02; // the game shows two decimals
  };
  if (near && fits(near)) return near;
  if (near && fits(near + 1)) return near + 1;
  for (let lv = 1; lv < 120; lv++) if (fits(lv) && (pct >= 1 || near == null)) return lv;
  return null;
}
function similar(a, b) {
  if (a === b) return 1;
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[m] / Math.max(n, m);
}
const plainText = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function bestName(text, list, minScore) {
  const q = plainText(text);
  if (q.length < 3) return null;
  let best = null, score = minScore;
  for (const row of list) {
    const s = similar(q, plainText(row.name));
    if (s >= score) { best = row; score = s; }
  }
  return best;
}
function matchMapText(text) {
  const lines = String(text).split(/\n|:/).map((l) => l.trim()).filter(Boolean);
  for (const line of [...lines].reverse()) {
    const hit = bestName(line.replace(/<\s*\d+\s*>/, ""), db.maps, 0.78);
    if (hit) return hit;
  }
  return null;
}
// Wording as reported by other Classic trackers: "You received EXP (+32)", "You have gained mesos (+15)", "Lupin's Banana x1 earned."
// It hasn't been checked on a capture here yet, so this stays a little loose on purpose.
function parseLogLine(line) {
  const t = line.trim();
  if (t.length < 6) return null;
  if (/\bexp\b/i.test(t)) { const m = t.match(/([\d,]+)\D*$/); return { kind: "exp", amount: m ? parseInt(m[1].replace(/,/g, ""), 10) : 0, party: /party/i.test(t) }; }
  if (/meso/i.test(t)) { const m = t.match(/(\d[\d,]*)/); return m ? { kind: "meso", amount: parseInt(m[1].replace(/,/g, ""), 10) } : null; }
  const body = t.replace(/^you\s+(have\s+)?(received|obtained|gained|got)\s*/i, "").replace(/\s*(earned|obtained|gained)\.?\s*$/i, "");
  const qty = body.match(/(?:\(\s*\+?\s*|\bx\s*)(\d+)\s*\)?\s*$/i);
  const item = bestName(body.replace(/\(.*$/, "").replace(/\bx\s*\d+\s*$/i, ""), db.items, 0.8);
  return item ? { kind: "item", item, amount: qty ? parseInt(qty[1], 10) : 1 } : null;
}
// lines only ever move up, so anything below the part seen last time is new
function newLogLines(before, after) {
  const clean = (rows) => rows.map(plainText).filter((x) => x.length >= 6);
  const prev = clean(before), rows = after.map((r) => [plainText(r), r]).filter(([p]) => p.length >= 6);
  const cur = rows.map(([p]) => p);
  for (let overlap = Math.min(prev.length, cur.length); overlap > 0; overlap--) {
    const tail = prev.slice(-overlap);
    if (tail.every((line, i) => similar(line, cur[i]) >= 0.8)) return rows.slice(overlap).map(([, r]) => r);
  }
  return rows.map(([, r]) => r);
}

// ---------- a tracked session ----------
function newLiveSession() {
  return { started: Date.now(), expGained: 0, expLost: 0, levelUps: 0, level: null, value: null, pct: null, meso: 0, items: {}, logRows: [], logLines: [], partyLines: 0, goodExp: 0, badExp: 0, pending: null };
}
function applyExpReading(s, parsed) {
  if (!parsed) { s.badExp++; return false; }
  let level = expLevel(parsed.value, parsed.pct, s.level);
  // a misread digit shouldn't stall tracking: the percent alone gets close to the real number once the level is known
  if (level == null && parsed.pct != null && (s.level || calc.level)) {
    const guess = s.level || calc.level;
    const rebuilt = Math.round((parsed.pct / 100) * expToNext(guess));
    if (s.value == null || Math.abs(rebuilt - s.value) < expToNext(guess) * 0.1) {
      parsed = { value: rebuilt, pct: parsed.pct };
      level = guess;
      s.approxExp = (s.approxExp || 0) + 1;
    }
  }
  if (level == null) { s.badExp++; return false; }
  // right after a level-up the percent can fit both levels, but a bar that fell from high to almost nothing leveled
  if (s.value != null && level === s.level && s.pct > 50 && parsed.pct < 5 && expToNext(level + 1) > parsed.value) level = s.level + 1;
  s.goodExp++;
  if (s.value == null) { Object.assign(s, { level, value: parsed.value, pct: parsed.pct }); return true; }
  if (level > s.level) {
    let gained = expToNext(s.level) - s.value + parsed.value;
    for (let lv = s.level + 1; lv < level; lv++) gained += expToNext(lv);
    s.expGained += gained;
    s.levelUps += level - s.level;
  } else if (level < s.level) {
    s.badExp++; // levels don't go down, so this was a misread
    s.goodExp--;
    return false;
  } else if (parsed.value >= s.value) {
    // a big jump has to be read twice in a row before it counts
    const jump = parsed.value - s.value;
    if (jump > expToNext(level) * 0.1 && (!s.pending || s.pending !== parsed.value)) { s.pending = parsed.value; return false; }
    s.expGained += jump;
  } else {
    // going down within a level means a death, or a misread, so that has to be read twice too
    if (s.pending !== parsed.value) { s.pending = parsed.value; return false; }
    s.expLost += s.value - parsed.value;
  }
  s.pending = null;
  Object.assign(s, { level, value: parsed.value, pct: parsed.pct });
  return true;
}
function applyLogReading(s, text) {
  const rows = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const fresh = newLogLines(s.logRows, rows);
  s.logRows = rows;
  for (const line of fresh) {
    const hit = parseLogLine(line);
    s.logLines.unshift(line);
    if (s.logLines.length > 12) s.logLines.pop();
    if (!hit) continue;
    if (hit.kind === "meso") s.meso += hit.amount;
    if (hit.kind === "item") s.items[hit.item.id] = (s.items[hit.item.id] || 0) + hit.amount;
    if (hit.kind === "exp" && hit.party) s.partyLines++;
  }
}

// ---------- the reading loop ----------
function liveSource() {
  if (live.stream && live.video?.videoWidth) {
    live.frame ||= document.createElement("canvas");
    live.frame.width = live.video.videoWidth;
    live.frame.height = live.video.videoHeight;
    live.frame.getContext("2d").drawImage(live.video, 0, 0);
    return live.frame;
  }
  return live.image;
}
let liveTick = 0;
async function liveStep() {
  const source = liveSource();
  if (!source || live.busy) return;
  live.busy = true;
  liveTick++;
  try {
    const s = live.session;
    live.raw.exp = await readBox(source, "exp");
    live.lastExp = parseExpText(live.raw.exp);
    if (s) applyExpReading(s, live.lastExp);
    if (liveTick % 8 === 1) {
      live.raw.map = await readBox(source, "map");
      const m = matchMapText(live.raw.map);
      live.mapId = m?.id || null;
      live.mapName = m?.name || live.raw.map.split("\n").pop() || "";
    }
    if (s) {
      live.raw.log = await readBox(source, "log");
      applyLogReading(s, live.raw.log);
    }
    live.error = "";
  } catch (err) {
    live.error = String(err.message || err);
  }
  live.busy = false;
  paintLive();
}
function startLiveLoop() {
  clearInterval(live.timer);
  live.timer = setInterval(liveStep, 1500);
  liveStep();
}
async function shareGame() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    live.stream = stream;
    live.video ||= Object.assign(document.createElement("video"), { muted: true, playsInline: true });
    live.video.srcObject = stream;
    await live.video.play();
    stream.getVideoTracks()[0].addEventListener("ended", () => { stopShare(); if (state.tab === "planner" && planner.mode === "live") renderPlanner(); });
    live.image = null;
    await new Promise((r) => setTimeout(r, 400));
    await findBoxesNow();
    startLiveLoop();
  } catch (err) {
    live.error = err.name === "NotAllowedError" ? "Screen sharing was cancelled." : String(err.message || err);
  }
  renderPlanner();
}
function stopShare() {
  clearInterval(live.timer);
  live.timer = null;
  live.stream?.getTracks().forEach((t) => t.stop());
  live.stream = null;
}
async function findBoxesNow() {
  const source = liveSource();
  if (!source) return;
  live.busy = true;
  liveRegions();
  try {
    const found = await autoFindBoxes(source);
    live.note = found.length ? `Found the ${found.join(" and ")} boxes. The pickup box is a guess, so check it.` : "Couldn't find the boxes by myself, so please drag them into place.";
  } catch (err) {
    live.error = String(err.message || err);
  }
  live.busy = false;
  paintLive();
}
async function liveFromFile(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  stopShare();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  live.image = c;
  URL.revokeObjectURL(img.src);
  renderPlanner();
  await findBoxesNow();
  await liveStep();
}

// ---------- the page ----------
function liveRates() {
  const s = live.session;
  const ms = s ? Date.now() - s.started : 0;
  const per = ms > 0 ? 3600000 / ms : 0;
  return { ms, exp: (s?.expGained || 0) * per, meso: (s?.meso || 0) * per };
}
function drawLivePreview() {
  const canvas = $("#ltPreview");
  const source = liveSource();
  if (!canvas || !source) return;
  const w = source.width, h = source.height;
  canvas.width = Math.min(960, w);
  canvas.height = Math.round((canvas.width / w) * h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  ctx.font = "13px system-ui, sans-serif";
  for (const [k, def] of Object.entries(LIVE_REGIONS)) {
    const b = liveRegions()[k];
    ctx.strokeStyle = ctx.fillStyle = def.color;
    ctx.strokeRect(b[0] * canvas.width, b[1] * canvas.height, b[2] * canvas.width, b[3] * canvas.height);
    ctx.fillText(def.label, b[0] * canvas.width + 2, Math.max(13, b[1] * canvas.height - 4));
  }
}
function paintLive() {
  if (state.tab !== "planner" || planner.mode !== "live" || !$("#ltStatus")) return;
  drawLivePreview();
  const s = live.session, r = liveRates();
  const reader = { off: "", loading: "Loading the text reader. This only takes a while the first time.", ready: "" }[live.workerState];
  $("#ltStatus").textContent = live.error || reader || live.note || (live.stream ? "Watching your game window." : live.image ? "Reading your screenshot." : "");
  if (!$("#ltRead")) return; // nothing shared yet
  $("#ltRead").innerHTML = `<div><span>EXP numbers</span><b>${live.lastExp ? `${fmt(live.lastExp.value)} [${live.lastExp.pct}%]` : "not read yet"}</b><small>${esc(live.raw.exp)}</small></div>
    <div><span>Map</span><b>${live.mapId ? link("map", live.mapId, live.mapName) : esc(live.mapName || "not read yet")}</b><small>${esc(live.raw.map.replace(/\n/g, " / "))}</small></div>`;
  if (!s) { $("#ltStats").innerHTML = ""; return; }
  const items = Object.entries(s.items).sort((a, b) => b[1] - a[1]);
  const total = s.goodExp + s.badExp;
  $("#ltStats").innerHTML = `<div class="match-grid plan-grid">
      <div><span>Time</span><b>${clockText(r.ms)}</b></div>
      <div><span>EXP gained</span><b>${fmt(Math.round(s.expGained))}</b></div>
      <div><span>EXP / hour</span><b>${shortNum(r.exp)}</b></div>
      <div><span>Level</span><b>${s.level ?? "—"}${s.levelUps ? `<small> +${s.levelUps}</small>` : ""}</b></div>
      <div><span>Mesos</span><b>${fmt(s.meso)}</b></div>
      <div><span>Mesos / hour</span><b>${shortNum(r.meso)}</b></div>
      <div><span>Good EXP reads</span><b>${total ? Math.round((s.goodExp / total) * 100) : 0}%</b></div>
      <div><span>EXP lost</span><b>${fmt(s.expLost)}</b></div>
    </div>
    ${items.length ? `<h4 class="cx-drops-title">Items picked up</h4><ul class="cx-drops">${items.slice(0, 12).map(([id, n]) => `<li>${link("item", id)}<span class="right">×${n}</span></li>`).join("")}</ul>` : ""}
    ${s.partyLines ? `<p class="sub small">Looks like party play, so this isn't a solo rate.</p>` : ""}
    <details class="lt-raw"><summary>What the pickup log looked like</summary><pre>${esc(s.logLines.join("\n") || "Nothing read yet.")}</pre></details>`;
}
function renderLive() {
  const body = $("#planBody");
  const can = !!navigator.mediaDevices?.getDisplayMedia && !isPhone();
  const active = !!(live.stream || live.image);
  body.innerHTML = `<section class="calc-card">
      <div class="card-head"><h3>Live tracker <span class="badge">Early test</span></h3></div>
      <p class="sub small">Share your game window and this reads your EXP, map and pickup messages. It only looks at the picture, and your screen stays on your computer. It never touches the game or plays for you. <b>Use at your own risk:</b> we couldn't find a clear Nexon rule on tools that read the screen, so check their rules before using it on an account you care about.</p>
      <div class="cx-bonus-actions lt-actions">
        ${can ? `<button type="button" class="btn" id="ltShare">${live.stream ? "Stop sharing" : "Share game window"}</button>` : `<span class="sub small">Screen sharing needs Chrome or Edge on a computer.</span>`}
        <label class="btn ghost lt-file">Try a screenshot<input type="file" id="ltFile" accept="image/*" hidden></label>
        ${active ? `<button type="button" class="btn ${live.session ? "ghost" : ""}" id="ltSession">${live.session ? "Save session" : "Start tracking"}</button>` : ""}
        ${live.session ? `<button type="button" class="btn ghost" id="ltCancel">Cancel</button>` : ""}
      </div>
      <p class="cf-note" id="ltStatus" aria-live="polite"></p>
    </section>
    ${active ? `<section class="calc-card">
      <h3 class="plan-h">Check the boxes</h3>
      <p class="sub small">Each box should sit tightly around its text. To move one, pick it below, then drag on the picture.</p>
      <button type="button" class="cx-auto" id="ltFind">Find the boxes again</button>
      <div class="cx-bonus-actions lt-actions">${Object.entries(LIVE_REGIONS).map(([k, v]) => `<button type="button" class="cx-auto ${live.marking === k ? "on" : ""}" data-lt-mark="${k}" style="border-color:${v.color}">${v.label}</button>`).join("")}</div>
      <canvas id="ltPreview" class="lt-preview"></canvas>
      <div class="lt-read" id="ltRead"></div>
    </section>
    <section class="calc-card" id="ltStats"></section>
    <p class="sub small">Keep this window visible beside the game, since browsers slow down hidden tabs. Kills and monster matching come next.</p>` : ""}`;
  $("#ltShare")?.addEventListener("click", () => { if (live.stream) { stopShare(); renderPlanner(); } else shareGame(); });
  $("#ltFile").addEventListener("change", (e) => { if (e.target.files[0]) liveFromFile(e.target.files[0]); });
  $("#ltSession")?.addEventListener("click", () => {
    if (live.session) saveLiveSession(); else live.session = newLiveSession();
    renderPlanner();
  });
  $("#ltFind")?.addEventListener("click", async () => { await findBoxesNow(); liveStep(); });
  $("#ltCancel")?.addEventListener("click", () => { live.session = null; renderPlanner(); });
  body.querySelectorAll("[data-lt-mark]").forEach((b) => b.addEventListener("click", () => { live.marking = live.marking === b.dataset.ltMark ? null : b.dataset.ltMark; renderPlanner(); }));
  const canvas = $("#ltPreview");
  if (canvas) {
    let start = null;
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    canvas.addEventListener("pointerdown", (e) => { if (live.marking) { start = at(e); canvas.setPointerCapture(e.pointerId); } });
    canvas.addEventListener("pointermove", (e) => {
      if (!start) return;
      const p = at(e);
      live.regions[live.marking] = [Math.min(start[0], p[0]), Math.min(start[1], p[1]), Math.abs(p[0] - start[0]), Math.abs(p[1] - start[1])];
      drawLivePreview();
    });
    canvas.addEventListener("pointerup", () => { if (start) { start = null; saveRegions(); liveStep(); } });
  }
  liveRegions();
  paintLive();
}
function saveLiveSession() {
  const s = live.session;
  const char = activeChar();
  const target = calc.target && getEntity("monster", calc.target);
  const c = withGear(calc);
  const rate = target ? hourly(target, matchup(rawRange(c), c, target), c) : null;
  char.sessions = [{ mobName: (live.mapId && live.mapName) || target?.name || "Live session", ms: Date.now() - s.started, exp: Math.round(s.expGained), meso: s.meso, kills: 0, estExp: live.mapId ? 0 : rate?.exp || 0, estKills: 0, date: Date.now() }, ...(char.sessions || [])].slice(0, 30);
  saveChars();
  live.session = null;
}
