// Reading the game's chat box from a shared screen picture, for the Chat page (chat.html). The same reading as the
// desktop tracker's (tracker/chatwatch.py), in plain JavaScript: which lines are buddy, whisper, party and general chat,
// and their letters, made ready for the text reader. It only ever looks at the picture. Nothing is sent anywhere.
//
// A picture here is { w, h, data } with data in RGBA order (a canvas's getImageData), the chat area of the game window.
// Sizes are in pixels of a 1440-tall game, scaled by s = the game's height / 1440, measured from the window's middle.
(function (root) {
  "use strict";

  const REF_H = 1440;
  const LEFT = -780, RIGHT = 300, BOTTOM_UP = 70, TALL = 620;
  const TEXT_X = -726, TEXT_NEAR = 14, LOOK_W = 700, TEXT_W = 960;
  const CLOSED = [42, 14], OPEN = [85, 61], BAR_X = [200, 600], GREY_BAR = 115;
  const GRID_SLACK = 6, GRID_LINES = 6, END_GAP = 40;
  const PATCHY = 41, PATCHY_W = 260, OPEN_K = 7, NAME_W = 110, PITCH = 30.25;
  const INK = 60, FILLED = 0.04, BACKDROP = 160, EVEN = 60, BLOCK = 170, BLOCK_EVEN = 13;
  const RED_BLOCK = [165, 40, 90], SOLID = 12, LIGHTER = 40, DARKER = 15, GREY_SAT = 60;
  const WHISPER_BAR = [55, 170, 90, 80, 15], BRIGHT_SAT = 140, BOLD = 5, NEAR_COLOUR = 70;
  const SAME = 0.82, SAME_NEAR = 0.7, NEAR_S = 30, SAME_WORDS = 0.9, REMEMBER_S = 15 * 60;
  const SHAPES = 600, WAITING = 60, NAME_SAME = 0.7, CAPITAL_SHARE = 0.15, RECENT_LINES = 400;
  const SETTLE_S = 1.0, SETTLE_LOOKS = 3, ONCE_S = 2.0, SCENERY_S = 2.0, TRIES = 4;

  const TABS = [["Buddy", ["buddy", "whisper"]], ["Party", ["party"]], ["General", ["general"]]];
  const SHOWN = TABS.flatMap(([, kinds]) => kinds);
  const FIRST = ["buddy", "whisper", "party", "guild", "other", "general", "notice", "speaker", "box"];

  // ---------- small helpers, as Python and OpenCV do them ----------
  const int = Math.trunc;
  function pyRound(x) {                       // (Python rounds halves to even)
    const f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  function odd(n) { return n | 1; }
  function sorted(a) { return Float64Array.from(a).sort(); }
  function median(a) {
    if (!a.length) return NaN;
    const s = sorted(a), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function percentileOf(s, q) {               // s sorted; numpy's linear way
    if (!s.length) return NaN;
    const at = (q / 100) * (s.length - 1), lo = Math.floor(at), hi = Math.ceil(at);
    return s[lo] + (s[hi] - s[lo]) * (at - lo);
  }
  function mean(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return a.length ? t / a.length : NaN; }
  function std(a) {
    if (!a.length) return NaN;
    const m = mean(a);
    let t = 0;
    for (let i = 0; i < a.length; i++) t += (a[i] - m) * (a[i] - m);
    return Math.sqrt(t / a.length);
  }
  function hsv(r, g, b) {                     // OpenCV's 8-bit HSV: [hue in degrees (even), saturation 0..255]
    r = Math.round(r); g = Math.round(g); b = Math.round(b);
    const v = Math.max(r, g, b), mn = Math.min(r, g, b), d = v - mn;
    const sat = v ? Math.round((255 * d) / v) : 0;
    let h = 0;
    if (d) {
      if (v === r) h = (60 * (g - b)) / d;
      else if (v === g) h = 120 + (60 * (b - r)) / d;
      else h = 240 + (60 * (r - g)) / d;
      if (h < 0) h += 360;
    }
    let h2 = Math.round(h / 2);
    if (h2 >= 180) h2 -= 180;
    return [h2 * 2, sat];
  }
  // a channel-by-channel median of the picture's pixels where pick is set: [r, g, b]
  function medianColour(pic, pick) {
    const r = [], g = [], b = [];
    for (let i = 0; i < pick.length; i++) if (pick[i]) { r.push(pic.data[i * 4]); g.push(pic.data[i * 4 + 1]); b.push(pic.data[i * 4 + 2]); }
    return [median(r), median(g), median(b)];
  }

  // a box blur (OpenCV's blur: the edges mirrored, not repeating the edge pixel), of a w×h plane of floats
  function boxBlur(src, w, h, kw, kh) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const rx = kw >> 1, ry = kh >> 1;
    const mx = (x) => (w === 1 ? 0 : x < 0 ? -x : x >= w ? 2 * w - 2 - x : x);
    const my = (y) => (h === 1 ? 0 : y < 0 ? -y : y >= h ? 2 * h - 2 - y : y);
    for (let y = 0; y < h; y++) {                 // (a running sum: add the one coming in, take off the one going out)
      const row = y * w;
      let t = 0;
      for (let d = -rx; d <= rx; d++) t += src[row + mx(d)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = t / kw;
        t += src[row + mx(x + rx + 1)] - src[row + mx(x - rx)];
      }
    }
    for (let x = 0; x < w; x++) {
      let t = 0;
      for (let d = -ry; d <= ry; d++) t += tmp[my(d) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = t / kh;
        t += tmp[my(y + ry + 1) * w + x] - tmp[my(y - ry) * w + x];
      }
    }
    return out;
  }
  // a k×k square's min (erode) or max (dilate), with what's past the edges left out, of a w×h plane
  function minMax(src, w, h, k, isMax) {
    const r = k >> 1, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const a = x - r < 0 ? 0 : x - r, b = x + r > w - 1 ? w - 1 : x + r;
        let v = src[row + a];
        if (isMax) { for (let d = a + 1; d <= b; d++) if (src[row + d] > v) v = src[row + d]; }
        else for (let d = a + 1; d <= b; d++) if (src[row + d] < v) v = src[row + d];
        tmp[row + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      const a = y - r < 0 ? 0 : y - r, b = y + r > h - 1 ? h - 1 : y + r;
      for (let x = 0; x < w; x++) {
        let v = tmp[a * w + x];
        if (isMax) { for (let d = a + 1; d <= b; d++) if (tmp[d * w + x] > v) v = tmp[d * w + x]; }
        else for (let d = a + 1; d <= b; d++) if (tmp[d * w + x] < v) v = tmp[d * w + x];
        out[y * w + x] = v;
      }
    }
    return out;
  }
  function opening(src, w, h, k) { return minMax(minMax(src, w, h, k, false), w, h, k, true); }

  // ---------- where the chat box is ----------
  function area(rect) {
    const [wx, wy, ww, wh] = rect;
    const s = wh / REF_H, mid = wx + ww / 2;
    const x0 = Math.max(wx, int(mid + LEFT * s)), x1 = Math.min(wx + ww, int(mid + RIGHT * s));
    const y1 = int(wy + wh - BOTTOM_UP * s);
    const y0 = Math.max(wy, int(y1 - TALL * s));
    return [x0, y0, x1 - x0, y1 - y0];
  }
  function textX(rect) {
    const [wx, , ww, wh] = rect;
    return int(wx + ww / 2 + (TEXT_X * wh) / REF_H) - area(rect)[0];
  }

  function kindOf([r, g, b]) {
    const [hue, sat] = hsv(r, g, b);
    if (sat < GREY_SAT) return "general";
    if (hue >= 48 && hue < 72) return "notice";
    if (hue >= 12 && hue < 48) return sat >= BRIGHT_SAT ? "buddy" : "party";
    if (hue >= 72 && hue < 170) return "whisper";
    if (hue >= 250 && hue < 300) return "guild";
    if (hue >= 300 || hue < 12) return "party";
    return "other";
  }
  function blockColour([r, g, b]) {
    const [hue, sat] = hsv(r, g, b);
    if (sat < 30) return "grey";
    if (hue < 20 || hue >= 345) return "red";
    if (hue < 75) return "yellow";
    if (hue < 260) return "blue";
    return "pink";
  }
  function whisperBar([r, g, b], bright, spread) {
    const [hue, sat] = hsv(r, g, b);
    const [lo, hi, minSat, light, even] = WHISPER_BAR;
    return hue >= lo && hue < hi && sat >= minSat && bright >= light && spread <= even;
  }

  // the letters' pixels, light or dark: those that stand out from what's around them
  // (only columns xa..xb are needed: the rest of the picture, past what the blur reaches, is left out, and left 0)
  function ink(img, s, xa = 0, xb = img.w) {
    const { w, h, data } = img;
    const k = Math.max(5, odd(pyRound(9 * s))), r = k >> 1;
    const a = Math.max(0, xa - r - 1), b = Math.min(w, xb + r + 1), cw = b - a, n = cw * h;
    const on = new Uint8Array(w * h), sum = new Float32Array(n), plane = new Float32Array(n);
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < cw; x++) plane[y * cw + x] = data[(y * w + a + x) * 4 + c];
      const blur = boxBlur(plane, cw, h, k, k);
      for (let i = 0; i < n; i++) sum[i] += Math.abs(plane[i] - blur[i]);
    }
    for (let y = 0; y < h; y++) for (let x = Math.max(a, xa); x < Math.min(b, xb); x++) on[y * w + x] = sum[y * cw + x - a] >= INK ? 1 : 0;
    return on;
  }

  // "open" (the white bar you type in shows), "closed" (the grey bar with the latest line), or null (no chat box here)
  function boxState(img, s, x0) {
    const { w, h, data } = img;
    const xa = Math.max(0, x0 + int(BAR_X[0] * s)), xb = Math.min(w, x0 + int(BAR_X[1] * s));
    const ya = Math.max(0, int(h - CLOSED[0] * s)), yb = Math.min(h, int(h - CLOSED[1] * s));
    if (xb <= xa || yb <= ya) return null;
    let white = 0, all = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const i = (y * w + x) * 4;
      all++;
      if (Math.min(data[i], data[i + 1], data[i + 2]) >= 230) white++;
    }
    if (white / all >= 0.6) return "open";
    let grey = 0, n = 0;
    const strips = [[int(h - (CLOSED[0] + 6) * s), int(h - (CLOSED[0] + 1) * s)], [int(h - (CLOSED[1] - 3) * s), int(h - (CLOSED[1] - 8) * s)]];
    for (const [a, b] of strips) for (let y = Math.max(0, a); y < Math.min(h, b); y++) for (let x = xa; x < xb; x++) {
      const i = (y * w + x) * 4, mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]);
      n++;
      if (mx - mn <= 10 && Math.abs(mx - GREY_BAR) <= 18) grey++;
    }
    return n && grey / n >= 0.7 ? "closed" : null;
  }

  function gridShift(count, H, s, n) {
    const cost = (o) => {
      let t = 0;
      for (let k = 0; k < Math.min(n, GRID_LINES); k++) {
        const y = pyRound(H - (OPEN[0] + 1.5 + k * PITCH) * s) + o;
        if (y < 0 || y >= H) continue;
        for (let yy = Math.max(0, y - 2); yy < Math.min(H, y + 3); yy++) t += count[yy];
      }
      return t;
    };
    const here = cost(0), slack = int(GRID_SLACK * s);
    let best = 0, bestCost = Infinity;
    for (let o = -slack; o <= slack; o++) {
      const c = cost(o);
      if (c < bestCost || (c === bestCost && Math.abs(o) < Math.abs(best))) { best = o; bestCost = c; }
    }
    return bestCost < 0.5 * here ? best : 0;
  }

  // a part of a picture: { w, h, data } (RGBA), rows y0..y1 and columns x0..x1
  function crop(img, x0, y0, x1, y1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(img.w, x1); y1 = Math.min(img.h, y1);
    const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x1) * 4), y * w * 4);
    return { w, h, data };
  }
  // a small copy of a line's letters, to know it again: averaged down to (cols × 8)
  function shrink(mask, w, h, cols) {
    const out = new Float32Array(cols * 8);
    for (let oy = 0; oy < 8; oy++) {
      const ya = (oy * h) / 8, yb = ((oy + 1) * h) / 8;
      for (let ox = 0; ox < cols; ox++) {
        const xa = (ox * w) / cols, xb = ((ox + 1) * w) / cols;
        let t = 0, a = 0;
        for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
          const fy = Math.min(yb, y + 1) - Math.max(ya, y);
          if (fy <= 0) continue;
          for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
            const fx = Math.min(xb, x + 1) - Math.max(xa, x);
            if (fx <= 0) continue;
            t += mask[y * w + x] * fx * fy; a += fx * fy;
          }
        }
        out[oy * cols + ox] = a ? t / a : 0;
      }
    }
    return { w: cols, h: 8, data: out };
  }

  // The chat lines in a picture of the chat area, top to bottom: { top, bottom, kind, colour, shape, mask: {w, h, data} }.
  // x0: where lines start in it. want: the kinds whose letters are needed (the rest are still told apart, but left bare).
  function rows(img, s, x0, want) {
    const { w: W, h: H, data } = img;
    const near = int(TEXT_NEAR * s);
    const lo = Math.max(0, x0 - near), hi = Math.min(W, x0 + int(LOOK_W * s)), bw = hi - lo;
    const on = ink(img, s, lo, hi);
    const count = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      let t = 0;
      for (let x = lo; x < hi; x++) t += on[y * W + x];
      if (t > 0.9 * bw) on.fill(0, y * W, (y + 1) * W);        // (the box's edges are lines right across: not letters)
      else count[y] = t;
    }
    const V = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) V[i] = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const state = boxState(img, s, x0);
    if (!state) return [];
    const slots = state === "closed" ? [CLOSED] : Array.from({ length: int((TALL - OPEN[0]) / PITCH) + 1 }, (_, k) => [OPEN[0] + k * PITCH, OPEN[1] + k * PITCH]);
    const shift = state === "open" ? gridShift(count, H, s, slots.length) : 0;
    const out = [];
    for (const [up0, up1] of [...slots].reverse()) {
      const y0 = pyRound(H - up0 * s) - 2 + shift, y1r = pyRound(H - up1 * s) + 2 + shift;
      if (y0 < 0) continue;
      const y1 = Math.min(H, y1r), bh = y1 - y0;
      if (bh <= 0) continue;
      const n = bw * bh;
      const band = new Uint8Array(n), v = new Float32Array(n);
      let filled = 0;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = (y0 + y) * W + lo + x;
        band[y * bw + x] = on[i]; v[y * bw + x] = V[i]; filled += on[i];
      }
      if (filled / n < FILLED) continue;
      const pic = crop(img, lo, y0, hi, y1);
      const nearL = minMax(band, bw, bh, 5, true);
      const behindPick = new Uint8Array(n), behind = [];
      for (let i = 0; i < n; i++) if (!nearL[i]) { behindPick[i] = 1; behind.push(v[i]); }
      if (behind.length < 50) continue;
      const sb = sorted(behind);
      let bg = median(behind);
      const spread = std(behind);
      const q1 = percentileOf(sb, 25), q3 = percentileOf(sb, 75);
      let block = bg >= BLOCK && q3 - q1 <= BLOCK_EVEN;
      if (!block) {
        const lit = behind.filter((x) => x >= BLOCK + 20);
        if (lit.length >= 0.4 * behind.length) {
          block = std(lit) <= BLOCK_EVEN / 2;
          if (block) bg = median(lit);
        }
      }
      let boxed = false;
      const behindColour = medianColour(pic, behindPick);
      if (!block && bg >= RED_BLOCK[0] && spread <= RED_BLOCK[1]) {
        boxed = hsv(...behindColour)[1] >= RED_BLOCK[2] && blockColour(behindColour) === "red";
      }
      if (!block && !boxed && (bg > BACKDROP || spread > EVEN)) continue;
      if (!block && !boxed) {
        // (scenery above the open box can look like a line, but what's behind it is patchy, where the box's backdrop is even)
        const k = Math.max(3, odd(pyRound(OPEN_K * s)));
        const sw = Math.min(bw, int(PATCHY_W * s)), start = new Float32Array(sw * bh);
        for (let y = 0; y < bh; y++) for (let x = 0; x < sw; x++) start[y * sw + x] = v[y * bw + x];
        const opened = opening(start, sw, bh, k);
        const keep = [], all = Array.from(opened);
        for (let y = 0; y < bh; y++) {
          let lit = 0;
          for (let x = 0; x < sw; x++) lit += start[y * sw + x] >= BLOCK + 20 ? 1 : 0;
          if (!(lit / sw > 0.6)) for (let x = 0; x < sw; x++) keep.push(opened[y * sw + x]);
        }
        if ((keep.length >= 8 * sw ? std(keep) : std(all)) > PATCHY) continue;
      }
      const light = new Uint8Array(n), dark = new Uint8Array(n);
      let nLight = 0, nDark = 0;
      for (let i = 0; i < n; i++) {
        if (!band[i]) continue;
        if (v[i] >= bg + LIGHTER) { light[i] = 1; nLight++; }
        if (v[i] <= bg - DARKER) { dark[i] = 1; nDark++; }
      }
      const colourBehind = block || boxed ? blockColour(behindColour) : "grey";
      let letters, kind = null;
      if (boxed || (block && colourBehind === "red" && nLight > nDark)) { letters = light; kind = "box"; }
      else if (block || (spread <= SOLID && nDark > nLight)) { letters = dark; kind = "speaker"; }
      else letters = light;
      // a line of words: it starts where every line does, with many letters close together
      const colSum = new Uint16Array(bw);
      let total = 0;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { colSum[x] += letters[y * bw + x]; total += letters[y * bw + x]; }
      const cols = [];
      for (let x = 0; x < bw; x++) if (colSum[x] >= 2) cols.push(x);
      if (!cols.length || cols[0] + lo > x0 + near) continue;
      const span = int(200 * s);
      let runs = 0, prev = 0;
      const startRow = new Uint8Array(span + 2);
      for (const c of cols) if (c < cols[0] + span) startRow[c - cols[0] + 1] = 1;
      for (let i = 0; i < startRow.length; i++) { if (startRow[i] && !prev) runs++; prev = startRow[i]; }
      if (runs < 6 || total < 20) continue;
      if (kind === null) {
        // their colour, from the name at the start, and from the pixels that stand out most there
        const name = Uint8Array.from(letters);
        const cut = cols[0] + int(NAME_W * s);
        let nName = 0;
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
          if (x >= cut) name[y * bw + x] = 0;
          nName += name[y * bw + x];
        }
        if (nName >= 20) {
          const blur = boxBlur(v, bw, bh, 9, 9), sharp = new Float32Array(n), picked = [];
          for (let i = 0; i < n; i++) { sharp[i] = v[i] - blur[i]; if (name[i]) picked.push(sharp[i]); }
          const cutoff = percentileOf(sorted(picked), 60);
          letters = new Uint8Array(n);
          for (let i = 0; i < n; i++) letters[i] = name[i] && sharp[i] >= cutoff ? 1 : 0;
        }
      }
      const colour = medianColour(pic, letters).map((c) => int(c));
      if (kind === null && whisperBar(behindColour, bg, spread)) kind = "whisper";
      kind = kind || kindOf(colour);
      const row = { top: y0, bottom: y1r, kind, colour, start: lo + cols[0], shape: null, mask: null };
      if (want && !want.has(kind)) { out.push(row); continue; }
      if (kind === "speaker" || kind === "box") { out.push(row); continue; }   // (not read on this page)
      // its letters, the whole line's length, by how strongly each pixel has their colour, from where it starts
      const fx0 = lo + Math.max(0, cols[0] - 2), full = crop(img, fx0, y0, x0 + int(TEXT_W * s), y1);
      const fw = full.w, fh = full.h, fn = fw * fh;
      const fv = new Float32Array(fn), off = new Float32Array(fn);
      for (let i = 0; i < fn; i++) {
        const r = full.data[i * 4], g = full.data[i * 4 + 1], b = full.data[i * 4 + 2];
        fv[i] = Math.max(r, g, b);
        off[i] = Math.max(Math.abs(r - colour[0]), Math.abs(g - colour[1]), Math.abs(b - colour[2]));
      }
      const k = Math.max(3, odd(pyRound(OPEN_K * s)));
      const around = opening(fv, fw, fh, k);
      const depth = Math.max(8, Math.max(...colour) - median(around));
      const mask = new Float32Array(fn);
      for (let i = 0; i < fn; i++) {
        mask[i] = Math.min(1, Math.max(0, (fv[i] - around[i]) / (0.8 * depth))) * Math.min(1, Math.max(0, 1.5 - off[i] / NEAR_COLOUR));
      }
      const colOn = new Uint16Array(fw), rowOn = new Uint16Array(fh);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (mask[y * fw + x] > 0.5) { colOn[x]++; rowOn[y]++; }
      for (let x = 0; x < fw; x++) if (colOn[x] / fh > 0.8) for (let y = 0; y < fh; y++) mask[y * fw + x] = 0;   // (a block's or the box's edge)
      for (let y = 0; y < fh; y++) if (rowOn[y] / fw > 0.6) mask.fill(0, y * fw, (y + 1) * fw);                  // (a block's top or bottom)
      const strong = new Uint16Array(fw), weak = new Uint16Array(fw);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const m = mask[y * fw + x];
        if (m > 0.5) strong[x]++;
        if (m > 0.25) weak[x]++;
      }
      let xs = [];
      for (let x = 0; x < fw; x++) if (strong[x] >= 2) xs.push(x);
      if (!xs.length) continue;
      const faint = [];
      for (let x = 0; x < fw; x++) if (weak[x] >= 2) faint.push(x);
      for (let i = 0; i + 1 < faint.length; i++) {         // (the line ends at the first wide gap: past it, it's scenery)
        if (faint[i + 1] - faint[i] > END_GAP * s) { const end = faint[i]; xs = xs.filter((x) => x <= end); break; }
      }
      if (!xs.length) continue;
      const mw = Math.min(fw, xs[xs.length - 1] + 3), m2 = new Float32Array(mw * fh);
      for (let y = 0; y < fh; y++) for (let x = 0; x < mw; x++) m2[y * mw + x] = mask[y * fw + x];
      row.mask = { w: mw, h: fh, data: m2 };
      row.shape = shrink(m2, mw, fh, Math.max(8, int(mw / 4)));
      out.push(row);
    }
    return out;
  }

  // Where the game is in a shared picture W×H, from its lower part img (rows top..H, the whole width). The game is the
  // shared window, so its bottom and middle are the picture's; what's above it (a title bar) is found by trying heights, and
  // keeping the one where the chat box shows, with the most lines, starting where they should. { rect, state } or null.
  function findGame(img, top, W, H) {
    const score = (cut) => {
      const rect = [0, cut, W, H - cut], s = rect[3] / REF_H;
      const [ax, ay, aw, ah] = area(rect);
      const keep = Math.min(ah, Math.ceil((OPEN[0] + 7 * PITCH) * s));           // (the bottom few lines are enough)
      if (ay + ah - keep < top || aw < 50 || keep < 30) return null;
      const part = crop(img, ax, ay + ah - keep - top, ax + aw, ay + ah - top), x0 = textX(rect);
      const state = boxState(part, s, x0);
      return state ? { rect, state, lines: rows(part, s, x0, new Set()).length } : null;
    };
    const most = Math.min(96, Math.floor(H * 0.08));
    // The chat box's bar (white when it's open, grey when it's closed) starts at the same spot for the game's size: where it
    // starts says how big the game is, so how much is above it. Then the few sizes around that are checked.
    const guess = barCut(img, top, W, H, most);
    let best = null;
    const tries = guess === null ? Array.from({ length: (most >> 2) + 1 }, (_, i) => i * 4) : Array.from({ length: 7 }, (_, i) => guess - 3 + i).filter((c) => c >= 0 && c <= most);
    for (const cut of tries) {
      const t = score(cut);
      if (!t) continue;
      t.rank = t.lines * 10 - Math.abs(cut - (guess ?? 0));
      if (!best || t.rank > best.rank) best = t;
    }
    return best && { rect: best.rect, state: best.state };
  }
  const BAR_LEFT = { open: 747, closed: 743 };    // where the bar starts, left of the window's middle
  function barCut(img, top, W, H, most) {
    const ya = Math.max(top, Math.round(H - 0.1 * H)), yb = Math.round(H - 0.045 * H);
    const mid = W / 2, xa = Math.max(1, Math.floor(mid - 760 * (H / REF_H))), xb = Math.ceil(mid - 735 * ((H - most) / REF_H));
    if (xb <= xa || yb <= ya) return null;
    let best = null;
    for (const [state, is] of [["open", (r, g, b) => Math.min(r, g, b) >= 230], ["closed", (r, g, b) => { const mx = Math.max(r, g, b); return mx - Math.min(r, g, b) <= 10 && Math.abs(mx - GREY_BAR) <= 18; }]]) {
      const count = new Int32Array(xb - xa + 1);
      for (let x = xa - 1; x <= xb; x++) {
        let n = 0;
        for (let y = ya; y < yb; y++) { const i = ((y - top) * img.w + x) * 4; if (is(img.data[i], img.data[i + 1], img.data[i + 2])) n++; }
        if (x >= xa) count[x - xa] = n;
        else count.prev = n;
      }
      for (let x = xa; x <= xb; x++) {
        const jump = count[x - xa] - (x === xa ? count.prev : count[x - xa - 1]);
        if (jump >= (25 / REF_H) * H && (!best || jump > best.jump)) best = { jump, x, state };
      }
    }
    if (!best) return null;
    const s = (mid - best.x) / BAR_LEFT[best.state];
    return Math.max(0, Math.round(H - s * REF_H));
  }

  // ---------- a line's letters, made ready for the text reader ----------
  // OpenCV's bicubic (a = -0.75), the edges repeated
  function cubicW(t) {
    const a = -0.75, x = Math.abs(t);
    if (x <= 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
    if (x < 2) return ((a * x - 5 * a) * x + 8 * a) * x - 4 * a;
    return 0;
  }
  function resizeCubic(src, w, h, f) {
    const W = Math.round(w * f), H = Math.round(h * f);
    const tmp = new Float32Array(W * h), out = new Float32Array(W * H);
    const weights = (n, N) => Array.from({ length: N }, (_, d) => {
      const sx = (d + 0.5) / f - 0.5, i = Math.floor(sx), t = sx - i;
      return [i, [cubicW(1 + t), cubicW(t), cubicW(1 - t), cubicW(2 - t)]];
    });
    const wx = weights(w, W), wy = weights(h, H);
    const cx = (x) => Math.min(w - 1, Math.max(0, x)), cy = (y) => Math.min(h - 1, Math.max(0, y));
    for (let y = 0; y < h; y++) for (let X = 0; X < W; X++) {
      const [i, ws] = wx[X];
      let t = 0;
      for (let k = 0; k < 4; k++) t += src[y * w + cx(i - 1 + k)] * ws[k];
      tmp[y * W + X] = t;
    }
    for (let Y = 0; Y < H; Y++) {
      const [j, ws] = wy[Y];
      for (let X = 0; X < W; X++) {
        let t = 0;
        for (let k = 0; k < 4; k++) t += tmp[cy(j - 1 + k) * W + X] * ws[k];
        out[Y * W + X] = Math.min(255, Math.max(0, Math.round(t)));
      }
    }
    return { w: W, h: H, data: out };
  }
  // dark letters on white, 3 times as big (for a 1440-tall game), with a margin, and their strokes made bolder (the game's
  // letters are a pixel thin: a 7's slanted stroke, made bigger, is a dotted line, read as "/" or "?"). { w, h, data: grey }
  function picture(mask, s) {
    const grey = new Float32Array(mask.w * mask.h);
    for (let i = 0; i < grey.length; i++) grey[i] = int(255 * (1 - mask.data[i]));
    const big = resizeCubic(grey, mask.w, mask.h, 3 / Math.max(s, 0.3));
    const pad = 20, W = big.w + 2 * pad, H = big.h + 2 * pad, framed = new Float32Array(W * H).fill(255);
    for (let y = 0; y < big.h; y++) for (let x = 0; x < big.w; x++) framed[(y + pad) * W + x + pad] = big.data[y * big.w + x];
    const r = BOLD >> 1, out = new Uint8ClampedArray(W * H);       // (a "+": a square makes Xeyna's x an m)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let m = framed[y * W + x];
      for (let d = -r; d <= r; d++) {
        if (x + d >= 0 && x + d < W) m = Math.min(m, framed[y * W + x + d]);
        if (y + d >= 0 && y + d < H) m = Math.min(m, framed[(y + d) * W + x]);
      }
      out[y * W + x] = m;
    }
    return { w: W, h: H, data: out };
  }

  // ---------- making sense of what was read ----------
  function tidy(text) {
    text = text.replace(/\s+/g, " ").trim();
    text = text.replace(/^[^A-Za-z0-9\['(]+/, "");                       // (a block's left edge: "|", "\")
    const face = text.match(/\s[:;=][-']?[()\[\]DPp3O/|]$/);             // (a smiley at the end, ":(", is kept)
    const smile = face ? face[0] : "";
    if (face) text = text.slice(0, face.index);
    text = text.replace(/(\s+[^\sA-Za-z0-9]{1,3})+$/, "");              // (marks after the line's end)
    text += smile;
    text = text.replace(/\s+[|]\s*[A-Za-z0-9_]{0,2}$/, "");
    return text.replace(/^[ ,`"_~|]+|[ ,`"_~|]+$/g, "");
  }
  const SPLIT = /^\s*(?:>\s*)?[(']?([A-Za-z0-9_]{2,13})(?:\s?[(\[{]\s?[^\s:;]?|\s?[)\]}])?(?:[\[({lI1|]\S{2,14}?-\d{1,2}[\])}|lI1]?\s*(?:>>|<<)|\s*(?:>>|<<)|(?:\s+\S{1,6}){0,2}?\s*[:;.,>=|°·©*~-]+(?=\s))\s*(.+)$/;
  const SPLIT_BUDDY = /^\s*(?:>\s*)?([A-Za-z0-9_]{2,13})\s?[(\[{][(){}\[\]]{0,2}[)\]}]\s*[:;.,>=|°·©*~-]*\s*(.+)$/;
  // [who, what they said] from a chat line: "Name : hello", "Name>> hello" (a whisper), "Remoneide() : hi" (a buddy)
  function split(text) {
    let m = text.match(SPLIT);
    if (m) return [m[1].trim(), m[2].trim().replace(/^\S{1,2}\s*[:;|]\s+/, "")];
    m = text.match(SPLIT_BUDDY);
    if (m) return [m[1], m[2].trim()];
    return ["", text];
  }
  const alnum = (c) => /[\p{L}\p{N}]/u.test(c);
  function sentence(text) {
    const shown = [...text.replace(/ /g, "")];
    const good = shown.filter(alnum).length;
    return good >= 0.85 * shown.length && (text.match(/[A-Za-z]{3,}/g) || []).length >= 3;
  }
  const NEWS = /party|buddy|buddies|friend|guild|whisper|joined|left|logged|invit/i;
  // does a reading look like a chat line, and not scenery read as letters?
  function isLine(kind, text) {
    text = tidy(text);
    const [who, what] = split(text);
    if (who) return /[A-Za-z0-9]/.test(what);
    if (/^\W?N[oa]t[il]ce/.test(text)) return true;
    if (kind === "box" && sentence(text)) return true;
    if (kind === "notice" && sentence(text) && (text.match(/[A-Za-z]{4,}/g) || []).length >= 4) return true;
    return kind !== "general" && kind !== "speaker" && sentence(text) && NEWS.test(text);
  }
  const key = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Python's difflib.SequenceMatcher(None, a, b).ratio(), for short text
  function ratio(a, b) {
    if (!a.length && !b.length) return 1;
    const matched = (alo, ahi, blo, bhi) => {
      let bi = alo, bj = blo, size = 0;
      let prev = new Int32Array(bhi - blo + 1);
      for (let i = alo; i < ahi; i++) {
        const cur = new Int32Array(bhi - blo + 1);
        for (let j = blo; j < bhi; j++) {
          if (a[i] !== b[j]) continue;
          const k = (cur[j - blo + 1] = prev[j - blo] + 1);
          if (k > size) { bi = i - k + 1; bj = j - k + 1; size = k; }
        }
        prev = cur;
      }
      if (!size) return 0;
      return size + (alo < bi && blo < bj ? matched(alo, bi, blo, bj) : 0) + (bi + size < ahi && bj + size < bhi ? matched(bi + size, ahi, bj + size, bhi) : 0);
    };
    return (2 * matched(0, a.length, 0, b.length)) / (a.length + b.length);
  }
  // could these two readings be the same line? Alike, or one the start (or end) of the other
  function sameLine(a, b, alike = SAME) {
    a = key(a); b = key(b);
    if (!a || !b) return false;
    if (a === b || ratio(a, b) >= alike) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length >= 5 && ratio(short, long.slice(0, short.length)) >= SAME + 0.08) return true;
    return short.length >= 10 && ratio(short, long.slice(-short.length)) >= SAME + 0.08;
  }
  function shapeSame(a, b) {
    if (a.w !== b.w) return false;
    let t = 0;
    for (let i = 0; i < a.data.length; i++) t += Math.abs(a.data[i] - b.data[i]);
    return t / a.data.length < 0.06;
  }

  // everyone whose name has been read: each person's spellings as read ("Xeyna", "xeyna", "meyna"), and the one shown
  class Names {
    constructor() { this.people = []; }
    find(name) {
      let best = this.match(name);
      if (best === null) { this.people.push(new Map()); best = this.people.length - 1; }
      const p = this.people[best];
      p.set(name, (p.get(name) || 0) + 1);
      return best;
    }
    match(name) {
      const low = name.toLowerCase();
      let best = null, score = NAME_SAME;
      for (let i = 0; i < this.people.length; i++) {
        for (const known of this.people[i].keys()) {
          const r = known.toLowerCase() === low ? 1 : ratio(known.toLowerCase(), low);
          if (r > score || (r === score && score === 1)) { best = i; score = r; }
        }
        if (score === 1) break;
      }
      return best;
    }
    shown(i) {
      const spellings = this.people[i], byLetters = new Map();
      for (const [name, n] of spellings) byLetters.set(name.toLowerCase(), (byLetters.get(name.toLowerCase()) || 0) + n);
      let low = null, most = -1;
      for (const [k, n] of byLetters) if (n > most) { low = k; most = n; }
      let best = null, top = -1, capital = 0, all = 0;
      for (const [name, n] of spellings) {
        if (name.toLowerCase() !== low) continue;
        if (n > top) { best = name; top = n; }
        all += n;
        if (/^[A-Z]/.test(name)) capital += n;
      }
      if (capital >= CAPITAL_SHARE * all && /^[a-z]/.test(best)) best = best[0].toUpperCase() + best.slice(1);
      return best;
    }
  }

  function kindOfSaid(said) {
    let best = null, n = -1;
    for (const [k, c] of said.kinds) if (c > n) { best = k; n = c; }
    return best;
  }

  // every chat line seen since the page opened, by when it was first seen; the same line is never in it twice
  class ChatLog {
    constructor(limit = 3000) { this.lines = []; this.limit = limit; this.changed = 0; this.added = 0; this.names = new Names(); this.exact = new Map(); }
    exactKey(person, what) { return `${person}\u0000${key(what)}`; }
    add(kind, text, now, clock) {
      text = tidy(text);
      if (!isLine(kind, text)) return [null, false];
      const [who, what] = split(text);
      let person = who ? this.names.match(who) : -1;
      let said = person !== null ? this._exact(this.exactKey(person, what), now) : null;
      if (!said && who && key(what).length >= 8) {
        for (const old of this.lines.slice(-RECENT_LINES).reverse()) {
          if (old.person >= 0 && Math.abs(now - old.seen) <= NEAR_S && sameLine(old.text, what, SAME_WORDS)) { said = old; person = old.person; break; }
        }
      }
      if (who) {
        if (person === null) person = this.names.find(who);
        else { const p = this.names.people[person]; p.set(who, (p.get(who) || 0) + 1); }
        this._rename(person);
        said = said || this._exact(this.exactKey(person, what), now);
      }
      if (!said) {
        for (const old of this.lines.slice(-RECENT_LINES).reverse()) {
          const alike = Math.abs(now - old.seen) <= NEAR_S ? SAME_NEAR : SAME;
          if (old.person === person && now - old.seen <= REMEMBER_S && sameLine(old.text, what, alike)) { said = old; break; }
        }
      }
      const k = this.exactKey(person, what);
      if (said) {
        this.seenAgain(said, kind, now);
        if (key(what).length > key(said.text).length + 2) { said.text = what; this.changed++; }
        this.exact.set(k, said);
        return [said, false];
      }
      this.added++;
      said = { when: clock, kinds: new Map([[kind, 1]]), who: person >= 0 ? this.names.shown(person) : "", text: what, seen: now, number: this.added, person, first: now };
      Object.defineProperty(said, "kind", { get() { return kindOfSaid(this); } });
      let at = this.lines.length;
      while (at > 0 && (this.lines[at - 1].when > said.when || (this.lines[at - 1].when === said.when && this.lines[at - 1].number > said.number))) at--;
      this.lines.splice(at, 0, said);
      if (this.lines.length > this.limit) {
        const gone = new Set(this.lines.splice(0, this.lines.length - this.limit));
        for (const [kk, v] of this.exact) if (gone.has(v)) this.exact.delete(kk);
      }
      this.exact.set(k, said);
      this.changed++;
      return [said, true];
    }
    _exact(k, now) { const said = this.exact.get(k); return said && now - said.seen <= REMEMBER_S ? said : null; }
    seenAgain(said, kind, now) {
      const was = said.kind;
      said.kinds.set(kind, (said.kinds.get(kind) || 0) + 1);
      said.seen = Math.max(said.seen, now);
      if (said.kind !== was) this.changed++;
    }
    _rename(person) {
      const name = this.names.shown(person);
      for (const x of this.lines.slice(-RECENT_LINES)) if (x.person === person && x.who !== name) { x.who = name; this.changed++; }
    }
    of(kinds) { return this.lines.filter((x) => kinds.includes(x.kind)); }
    forget(said) {
      const i = this.lines.indexOf(said);
      if (i < 0) return;
      this.lines.splice(i, 1);
      for (const [kk, v] of this.exact) if (v === said) this.exact.delete(kk);
      this.changed++;
    }
  }

  // look() at the chat area often (it's quick), and read() what it found: readLine(picture) is the text reader
  class ChatWatch {
    constructor(readLine, log, kinds = SHOWN) {
      this.readLine = readLine;
      this.log = log || new ChatLog();
      this.kinds = new Set(kinds);
      this.known = new Map();         // a line picture's width -> [[shape, the line it is or null for nonsense, times read]]
      this.waiting = [];
      this.new = [];
      this.scenery = new Map();
      this.reads = 0;
      this.dropped = 0;
    }
    _entry(shape) {
      const same = this.known.get(shape.w) || [];
      for (let i = same.length - 1; i >= 0; i--) if (shapeSame(same[i][0], shape)) return same[i];
      return null;
    }
    _known(shape) {
      const e = this._entry(shape);
      if (!e || (e[1] === null && e[2] < TRIES)) return [false, null];
      return [true, e[1]];
    }
    _remember(shape, said) {
      const e = this._entry(shape);
      if (e && e[1] === null) { e[1] = said; e[2]++; return; }
      if (!this.known.has(shape.w)) this.known.set(shape.w, []);
      const same = this.known.get(shape.w);
      same.push([shape, said, 1]);
      if (same.length > SHAPES) same.splice(0, same.length - SHAPES);
    }
    // a picture of the chat area, the game's height, where lines start in it, and the time (seconds, and Date.now())
    look(img, gameH, x0, now, clock) {
      return this.lookRows(rows(img, gameH / REF_H, x0, this.kinds), gameH, now, clock);
    }
    // the same, with the lines found already (rows(), in a worker)
    lookRows(all, gameH, now, clock) {
      const s = gameH / REF_H;
      const found = all.filter((r) => this.kinds.has(r.kind) && r.mask && (this.scenery.get(`${r.top >> 2}|${r.kind}`) ?? -1) < now);
      for (const r of found) {
        const [known, said] = this._known(r.shape);
        if (known) { if (said) this.log.seenAgain(said, r.kind, now); continue; }
        // (a line waiting to be read, seen again: counted, so a line read late isn't taken for one seen only once)
        const waiting = this.waiting.find((w) => shapeSame(w.shape, r.shape));
        if (waiting) { waiting.looks.push([r.kind, now]); continue; }
        this.waiting.push({ kind: r.kind, shape: r.shape, mask: r.mask, s, now, clock, top: r.top, looks: [] });
      }
      if (this.waiting.length > WAITING) {
        this.dropped += this.waiting.length - WAITING;
        this.waiting.sort((a, b) => FIRST.indexOf(a.kind) - FIRST.indexOf(b.kind) || b.now - a.now);
        this.waiting.length = WAITING;
      }
      return found.length;
    }
    // reads the next line waiting (buddy lines first); false when there was none
    async readOne() {
      if (!this.waiting.length) return false;
      this.waiting.sort((a, b) => FIRST.indexOf(a.kind) - FIRST.indexOf(b.kind) || a.now - b.now);
      const w = this.waiting.shift();
      const text = await this.readLine(picture(w.mask, w.s));
      this.reads++;
      const [said, isNew] = this.log.add(w.kind, text, w.now, w.clock);
      if (!said) this.scenery.set(`${w.top >> 2}|${w.kind}`, w.now + SCENERY_S);
      else {
        for (const [kind, at] of w.looks) this.log.seenAgain(said, kind, at);
        if (isNew) this.new.push(said);
      }
      this._remember(w.shape, said);
      return true;
    }
    // the lines added since last asked, once they've been seen enough to be sure of them
    takeNew(now) {
      const ready = [], keep = [];
      for (const x of this.new) {
        let looks = 0;
        for (const c of x.kinds.values()) looks += c;
        if (looks >= SETTLE_LOOKS || (looks >= 2 && now - x.first >= SETTLE_S)) ready.push(x);
        else if (looks === 1 && now - x.first >= ONCE_S) this.log.forget(x);
        else keep.push(x);
      }
      this.new = keep;
      return ready;
    }
  }

  const api = { REF_H, TABS, SHOWN, area, textX, boxState, rows, findGame, picture, tidy, split, isLine, sameLine, ratio, ChatLog, ChatWatch, Names, kindOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ChatRead = api;

  // In a worker (chat.js starts this file as one), finding lines is done here, so the page itself never stutters.
  if (typeof WorkerGlobalScope !== "undefined" && root instanceof WorkerGlobalScope) {
    root.onmessage = ({ data: m }) => {
      try {
        const img = { w: m.w, h: m.h, data: new Uint8ClampedArray(m.buffer) };
        const result = m.op === "find" ? findGame(img, m.top, m.W, m.H) : rows(img, m.s, m.x0, new Set(m.want));
        const state = m.op === "rows" ? boxState(img, m.s, m.x0) : null;
        root.postMessage({ id: m.id, result, state });
      } catch (err) {
        root.postMessage({ id: m.id, error: String(err && err.message || err) });
      }
    };
  }
})(typeof self !== "undefined" ? self : this);
