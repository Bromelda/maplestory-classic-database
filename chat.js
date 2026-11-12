// The Chat page: share the game window, and buddy, party and general chat are kept apart, each in its own tab, as they
// come. Reading is done in this browser only (chatread.js and the text reader). Nothing is uploaded, and nothing is kept
// once the page is closed. It only looks at the picture: it never touches the game, its files or its controls.
(function () {
  "use strict";
  const CR = window.ChatRead;
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const SETTINGS_KEY = "msclassicdb.chat";
  const LOOK_MS = 300;                    // how often the chat box is looked at
  const TICK_MS = 250;                    // how often the page is drawn, and new lines told of
  const FLASHES = 6;                      // the Buddy tab lights up this many times for a new message
  const SIZES = [11, 30];
  const PAGES = [...CR.TABS.map(([name]) => name), "All"];
  const KINDS = Object.fromEntries([...CR.TABS, ["All", CR.SHOWN]]);
  const LABELS = { whisper: "whisper" };

  const $ = (sel, doc = document) => doc.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function loadSettings() {
    try { return { bell: true, size: 15, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { bell: true, size: 15 }; }
  }
  const settings = loadSettings();
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage off */ } }

  const st = {
    stream: null, video: null, image: null, frame: document.createElement("canvas"),
    worker: null, workerState: "off", watch: null, game: null, state: null, lostSince: 0, lastFind: -99, size: "", looking: false,
    status: "", error: "", views: [], ticker: null, started: 0, audio: null,
  };
  st.watch = new CR.ChatWatch(readLine);

  // ---------- the text reader ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load the text reader. Check your connection and try again."));
      document.head.append(s);
    });
  }
  let loading = null;
  function reader() {
    if (st.worker) return Promise.resolve(st.worker);
    loading ||= (async () => {
      st.workerState = "loading";
      paint();
      try {
        if (!window.Tesseract) await loadScript(TESSERACT_URL);
        const w = await window.Tesseract.createWorker("eng");
        await w.setParameters({ tessedit_pageseg_mode: "7" });   // (one line of text a picture)
        st.worker = w;
        st.workerState = "ready";
        return w;
      } catch (err) {
        st.workerState = "off";
        throw err;
      } finally {
        loading = null;
        paint();
      }
    })();
    return loading;
  }
  // (the picture goes to the reader as a plain grey image file, made here: a canvas takes a second a line once the page
  // is out of sight, behind the game)
  async function readLine(pic) {
    const w = await reader();
    const head = new TextEncoder().encode(`P5\n${pic.w} ${pic.h}\n255\n`);
    const file = new Uint8Array(head.length + pic.data.length);
    file.set(head);
    file.set(pic.data, head.length);
    const { data } = await w.recognize(file);
    return data.text || "";
  }

  // ---------- finding the chat box in what's shared ----------
  function frameSize() {
    if (st.stream && st.video?.videoWidth) return [st.video.videoWidth, st.video.videoHeight];
    if (st.image) return [st.image.width, st.image.height];
    return null;
  }
  function source() { return st.stream ? st.video : st.image; }
  function grab(x, y, w, h) {
    const c = st.frame;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source(), x, y, w, h, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    return { w, h, data: d.data };
  }
  // (finding lines is done in a worker, chatread.js again, so this page never stutters)
  const finder = new Worker("chatread.js?v=1");
  const asked = new Map();
  let asks = 0;
  finder.onmessage = ({ data }) => {
    const p = asked.get(data.id);
    asked.delete(data.id);
    if (p) data.error ? p.reject(new Error(data.error)) : p.resolve(data);
  };
  function ask(msg, img) {
    return new Promise((resolve, reject) => {
      const id = ++asks;
      asked.set(id, { resolve, reject });
      finder.postMessage({ ...msg, id, w: img.w, h: img.h, buffer: img.data.buffer }, [img.data.buffer]);
    });
  }
  // The game is the shared window: its bottom and middle are the picture's. What's above it (a title bar) is found in
  // the worker, by trying heights.
  async function findGame() {
    const [W, H] = frameSize();
    const top = Math.round(H * 0.45), lower = grab(0, top, W, H - top);
    const { result } = await ask({ op: "find", top, W, H }, lower);
    return result;
  }

  async function look() {
    const size = frameSize();
    if (st.looking || !size) return;
    st.looking = true;
    try {
      const now = performance.now() / 1000;
      if (st.size !== size.join("x")) { st.size = size.join("x"); st.game = null; }
      if (!st.game) {
        if (now - st.lastFind < 2) return;             // (not found: looked for again every 2 seconds)
        st.lastFind = now;
        const found = await findGame();
        st.state = found ? found.state : null;
        if (!found) return;
        st.game = found.rect;
        st.lostSince = now;
      }
      const rect = st.game, [ax, ay, aw, ah] = CR.area(rect), clockNow = Date.now();
      const img = grab(ax, ay, aw, ah);
      const { result, state } = await ask({ op: "rows", s: rect[3] / CR.REF_H, x0: CR.textX(rect), want: [...st.watch.kinds] }, img);
      st.state = state;
      if (state) {
        st.lostSince = now;
        st.watch.lookRows(result, rect[3], now, clockNow);
      } else if (now - st.lostSince > 5) st.game = null;   // (gone a while: the window may have changed, so it's looked for again)
      st.error = "";
    } catch (err) {
      st.error = String(err.message || err);
    } finally {
      st.looking = false;
    }
  }
  async function readLoop() {
    for (;;) {
      try {
        if (!(await st.watch.readOne())) await sleep(120);
      } catch (err) {
        note(String(err.message || err));
        st.workerState = st.worker ? "ready" : "off";
        await sleep(2000);
      }
    }
  }

  // ---------- sharing ----------
  async function share() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
      stopShare();
      st.stream = stream;
      st.video ||= Object.assign(document.createElement("video"), { muted: true, playsInline: true });
      st.video.srcObject = stream;
      await st.video.play();
      stream.getVideoTracks()[0].addEventListener("ended", () => { stopShare(); paint(); });
      st.image = null; st.game = null; st.state = null; st.lastFind = -99; st.started = Date.now();
      chime(true);
      reader().catch((e) => { note(String(e.message || e)); st.workerState = "off"; });
    } catch (err) {
      note(err.name === "NotAllowedError" ? "Sharing was cancelled." : String(err.message || err));
    }
    paint();
  }
  function stopShare() {
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
    st.game = null; st.state = null;
  }
  async function fromFile(file) {
    let img;
    try { img = await createImageBitmap(file); } catch { note("That file isn't a picture this browser can open."); return; }
    stopShare();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    img.close();
    st.image = c; st.game = null; st.state = null; st.lastFind = -99;
    await look();
    paint();
    reader().catch((e) => { note(String(e.message || e)); st.workerState = "off"; });
  }

  // ---------- the bell ----------
  function chime(silent) {
    try {
      st.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (st.audio.state === "suspended") st.audio.resume();
      if (silent) return;
      const t = st.audio.currentTime;
      for (const [f, at] of [[880, 0], [1320, 0.12]]) {
        const o = st.audio.createOscillator(), g = st.audio.createGain();
        o.frequency.value = f; o.type = "sine";
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
        o.connect(g).connect(st.audio.destination);
        o.start(t + at); o.stop(t + at + 0.4);
      }
    } catch { /* no sound here */ }
  }

  // ---------- the chat views: this page's, and windows opened from it ----------
  const VIEW_CSS = `
    .cv { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .cv-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
    .cv-tab { border: 1px solid var(--line); background: var(--panel); color: var(--muted); padding: 4px 12px; border-radius: 999px; cursor: pointer; font: inherit; font-weight: 600; user-select: none; }
    .cv-tab.on { color: var(--accent); border-color: var(--accent); }
    .cv-tab.new { color: var(--accent); }
    .cv-tab.lit { background: var(--accent); color: #1a120b; border-color: var(--accent); }
    .cv-lines { flex: 1; min-height: 120px; overflow-y: auto; background: #0e0b09; border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; line-height: 1.4; }
    .cv-line { margin: 0 0 2px; overflow-wrap: anywhere; }
    .cv-time, .cv-label { color: var(--muted); font-size: .85em; margin-right: .6em; }
    .cv-who { font-weight: 700; }
    .cv-empty { color: var(--muted); }
    .k-buddy { color: #ffa040; } .k-whisper { color: #7be37b; } .k-party { color: #f5a3d8; } .k-general { color: #f1efe9; }
    .cv-said { color: var(--text); }
    .cv-menu { position: fixed; z-index: 10; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 4px; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
    .cv-menu button { display: block; width: 100%; text-align: left; background: none; border: 0; color: var(--text); font: inherit; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
    .cv-menu button:hover { background: var(--accent-soft); color: var(--accent); }`;
  const POPUP_CSS = `
    :root { color-scheme: dark; --bg: #14100d; --panel: #1f1915; --text: #f1e7dc; --muted: #a8988a; --line: #352b24; --accent: #ff9440; --accent-soft: #3a2414; }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body { background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 8px; }
    #view { height: 100%; }` + VIEW_CSS;

  function makeView(doc, host, page, isMain) {
    host.innerHTML = `<div class="cv"><div class="cv-tabs">${PAGES.map((p) => `<button type="button" class="cv-tab" data-page="${p}">${p}</button>`).join("")}</div><div class="cv-lines" aria-live="polite"></div></div>`;
    const view = { doc, host, page, isMain, seen: Object.fromEntries(PAGES.map((p) => [p, 0])), shown: null, changed: -1, flash: 0, closed: false };
    host.querySelectorAll(".cv-tab").forEach((b) => {
      b.addEventListener("click", () => showPage(view, b.dataset.page));
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); tabMenu(view, e, b.dataset.page); });
    });
    st.views.push(view);
    showPage(view, page);
    return view;
  }
  function showPage(view, page) {
    view.page = page;
    view.shown = null;
    if (page === "Buddy") view.flash = 0;
    if (!view.isMain) view.doc.title = `Chat - ${page}`;
    drawView(view);
  }
  function tabMenu(view, e, page) {
    const doc = view.doc;
    $(".cv-menu", doc)?.remove();
    const m = doc.createElement("div");
    m.className = "cv-menu";
    m.innerHTML = `<button type="button">Open ${page} in a new window</button>`;
    m.style.left = `${e.clientX}px`; m.style.top = `${e.clientY}px`;
    doc.body.append(m);
    m.querySelector("button").addEventListener("click", () => { m.remove(); openWindow(page); });
    setTimeout(() => doc.addEventListener("click", () => m.remove(), { once: true }), 0);
  }
  function setUpWindow(win, page) {
    const doc = win.document;
    doc.title = `Chat - ${page}`;
    const style = doc.createElement("style");
    style.textContent = POPUP_CSS + `.cv-lines { font-size: ${settings.size}px; }`;
    doc.head.append(style);
    doc.body.innerHTML = `<div id="view"></div>`;
    const view = makeView(doc, doc.getElementById("view"), page, false);
    view.win = win;
    win.addEventListener("pagehide", () => { view.closed = true; });
    return view;
  }
  function openWindow(page) {
    const n = st.views.filter((v) => !v.isMain && !v.closed).length;
    const win = window.open("", "", `popup,width=460,height=420,left=${80 + n * 40},top=${80 + n * 40}`);
    if (!win) { note("Your browser blocked the new window. Let this site open pop-ups (the icon at the end of the address bar), then try again."); return; }
    setUpWindow(win, page);
  }
  async function popOut() {
    if (!("documentPictureInPicture" in window)) { openWindow("Buddy"); return; }
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 420, height: 340 });
      setUpWindow(win, mainView?.page || "Buddy");
    } catch (err) {
      note(String(err.message || err));
    }
  }

  function drawView(view) {
    if (view.closed) return;
    const log = st.watch.log;
    const kinds = KINDS[view.page];
    const lines = log.of(kinds);
    view.seen[view.page] = lines.length;
    view.host.querySelectorAll(".cv-tab").forEach((b) => {
      const p = b.dataset.page, n = log.of(KINDS[p]).length, fresh = p === view.page ? 0 : n - view.seen[p];
      b.textContent = fresh > 0 && p !== "All" ? `${p} +${fresh}` : p;
      b.classList.toggle("on", p === view.page);
      b.classList.toggle("new", fresh > 0 && p === "Buddy");
      b.classList.toggle("lit", p === "Buddy" && view.flash % 2 === 1);
    });
    if (view.shown !== null && log.changed === view.changed) return;
    const box = view.host.querySelector(".cv-lines");
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
    box.innerHTML = lines.length ? lines.map((x) => lineHtml(x, view.page)).join("") : `<div class="cv-empty">${emptyText(view.page)}</div>`;
    if (atEnd || view.shown === null) box.scrollTop = box.scrollHeight;
    view.shown = lines.length;
    view.changed = log.changed;
  }
  function emptyText(page) {
    return page === "Buddy" ? "No buddy messages yet. They show here as they come, with the time they came." : "Nothing yet.";
  }
  function lineHtml(x, page) {
    const label = LABELS[x.kind] || (page === "All" ? x.kind : "");
    return `<div class="cv-line"><span class="cv-time">${clock(x.when)}</span>${label ? `<span class="cv-label">${esc(label)}</span>` : ""}${x.who ? `<span class="cv-who k-${x.kind}">${esc(x.who)}</span> : <span class="cv-said">${esc(x.text)}</span>` : `<span class="k-${x.kind}">${esc(x.text)}</span>`}</div>`;
  }

  // ---------- the page ----------
  let mainView = null;
  // (a message for whoever's using the page, shown for a while: not wiped by the next look, like a reading error is)
  function note(text) { st.notice = text; st.noticeUntil = Date.now() + 10000; paint(); }
  function paint() {
    const sharing = !!st.stream, any = sharing || !!st.image;
    $("#chShare").textContent = sharing ? "Stop sharing" : "Share game window";
    $("#chPop").hidden = !any;
    const reading = { loading: "Loading the text reader (only slow the first time)…", ready: "", off: "" }[st.workerState];
    const where = !any ? "" : st.state === "open" ? "Reading your chat box (open)." : st.state === "closed" ? "Reading your chat box (closed: only its last line shows, so open it to catch more)." : sharing ? "Can't see the chat box yet. Share the game window itself (not your whole screen), and keep the chat box showing." : "Couldn't find a chat box in that picture.";
    const waiting = st.watch.waiting.length ? ` ${st.watch.waiting.length} line${st.watch.waiting.length === 1 ? "" : "s"} waiting to be read.` : "";
    $("#chStatus").textContent = (st.notice && Date.now() < st.noticeUntil ? st.notice : "") || st.error || reading || (where && where + waiting) || "";
  }
  function tick() {
    const now = performance.now() / 1000;
    const fresh = st.watch.takeNew(now);
    if (fresh.some((x) => x.kind === "buddy" || x.kind === "whisper") && settings.bell) {
      chime(false);
      for (const v of st.views) v.flash = FLASHES;
    }
    st.views = st.views.filter((v) => !v.closed);
    for (const v of st.views) {
      if (v.flash) v.flash--;
      drawView(v);
    }
    paint();
  }
  // (the page's timers come from a worker: a browser slows a page's own timers right down when it's out of sight)
  function startTicker() {
    const code = `let n = 0; setInterval(() => postMessage(n++), ${Math.min(LOOK_MS, TICK_MS) / 2 | 0});`;
    const w = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
    let lastLook = 0, lastTick = 0;
    w.onmessage = () => {
      const t = performance.now();
      if (t - lastLook >= LOOK_MS && (st.stream || st.image)) { lastLook = t; look(); }
      if (t - lastTick >= TICK_MS) { lastTick = t; tick(); }
    };
    st.ticker = w;
  }
  function setSize(size) {
    settings.size = Math.max(SIZES[0], Math.min(SIZES[1], size));
    saveSettings();
    for (const v of st.views) {
      const box = v.host.querySelector(".cv-lines");
      if (box) box.style.fontSize = `${settings.size}px`;
    }
  }

  function start() {
    const can = !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent);
    if (!can) $("#chNoShare").hidden = false;
    $("#chShare").disabled = !can;
    $("#chShare").addEventListener("click", () => (st.stream ? (stopShare(), paint()) : share()));
    $("#chFile").addEventListener("change", (e) => { if (e.target.files[0]) fromFile(e.target.files[0]); e.target.value = ""; });
    $("#chPop").addEventListener("click", popOut);
    if (!("documentPictureInPicture" in window)) $("#chPop").textContent = "Open in a new window";
    $("#viewCss").textContent = VIEW_CSS;
    $("#chBell").checked = settings.bell;
    $("#chBell").addEventListener("change", (e) => { settings.bell = e.target.checked; saveSettings(); if (settings.bell) chime(true); });
    $("#chSmaller").addEventListener("click", () => setSize(settings.size - 2));
    $("#chBigger").addEventListener("click", () => setSize(settings.size + 2));
    $("#chClear").addEventListener("click", () => {
      st.watch = new CR.ChatWatch(readLine);
      for (const v of st.views) v.shown = null;
      tick();
    });
    mainView = makeView(document, $("#chView"), "Buddy", true);
    setSize(settings.size);
    startTicker();
    window.addEventListener("pagehide", () => { for (const v of st.views) if (v.win) try { v.win.close(); } catch { /* gone already */ } });
    readLoop();
    paint();
    window.chatPage = { st, look, findGame, fromFile, setUpWindow };       // (for checking it in the browser's console)
  }
  start();
})();
