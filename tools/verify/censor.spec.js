// ══════════════════════════════════════════════════════════════════════════
// censor.html 的遮罩驗證（Playwright）
//
//   cd tools/verify && npx playwright test
//
// 開啟實際的 censor.html，用頁面上的 __censorTest 掛勾跑真正的管線，驗三件事：
//   ① 與使用者提供的人工遮罩成品比對——我們的遮罩必須完全包住參考區域
//   ② 人工標定的裸露區域必須被 100% 覆蓋（該張若為 RED 則跳過，因為工具已舉手）
//   ③ 全批不變式——不會有「有裸露卻既沒遮罩也沒舉手」的圖溜出去
// ══════════════════════════════════════════════════════════════════════════
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const TEST_DIR = path.join(ROOT, 'test');
const PAGE = pathToFileURL(path.join(ROOT, 'censor.html')).href;
const TARGETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'targets.json'), 'utf8'));

const b64 = rel => fs.readFileSync(path.join(TEST_DIR, rel)).toString('base64');
const has = rel => fs.existsSync(path.join(TEST_DIR, rel));

/** 在頁面裡跑真正的偵測管線，回傳正規化座標的遮罩 */
async function analyze(page, rel) {
  return page.evaluate(async ({ data }) => {
    const r = await window.__censorTest.run('x', data);
    return {
      grade: r.grade, reason: r.reason, mode: r.mode, w: r.w, h: r.h,
      masks: r.masks.map(m => ({ x0: m.x0 / r.w, y0: m.y0 / r.h, x1: m.x1 / r.w, y1: m.y1 / r.h })),
    };
  }, { data: b64(rel) });
}

/**
 * 拿一張人工遮罩成品跟我們的遮罩做像素級比對。
 *
 * 兩件事必須做對，否則比出來的數字沒有意義：
 *
 * ① **成品是「contain 進白底方形」，不是壓縮**。1000×1300 的來源放進 1000×1000
 *    的成品，左右各留約 11.5% 白邊。若直接以成品全寬正規化，參考區塊的 x 會被
 *    往中心擠約 11.5%，看起來就都在我們的遮罩裡——實測會把 95% 的覆蓋率報成
 *    100%。所以先剝掉白邊，取內容框，之後一律以內容框正規化。
 *
 * ② **比對像素而不是外接框**。使用者是手工拉框，下半身常常是兩塊重疊的矩形；
 *    取外接框會連沒塗黑的角落一起要求，反過來取「整條都黑的欄」又會漏算。
 *    直接用塗黑的像素集合最忠實。
 *
 * 人工遮罩與照片本身的黑（絲襪、兔耳、暗背景）用三個條件分開，實測分得很乾淨：
 * 面積 ≥1%、填滿外接框 ≥70%、亮度標準差 ≤2.5（人工遮罩 1.3~2.2，照片的黑 ≥2.6）。
 */
async function refCoverage(page, rel, masks) {
  return page.evaluate(async ({ data, masks }) => {
    const bin = atob(data), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u]));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0); bmp.close();
    const W = c.width, H = c.height;
    const d = cx.getImageData(0, 0, W, H).data;
    const at = i => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    const white = i => { const p = at(i); return p[0] > 248 && p[1] > 248 && p[2] > 248; };
    const dark = i => { const p = at(i); return p[0] < 32 && p[1] < 32 && p[2] < 32; };

    // ① 剝白邊 → 內容框
    let L = 0, R = W - 1, T = 0, B = H - 1;
    const colW = x => { for (let y = 0; y < H; y += 2) if (!white(y * W + x)) return false; return true; };
    const rowW = y => { for (let x = 0; x < W; x += 2) if (!white(y * W + x)) return false; return true; };
    while (L < R && colW(L)) L++;
    while (R > L && colW(R)) R--;
    while (T < B && rowW(T)) T++;
    while (B > T && rowW(B)) B--;
    const cw = R - L + 1, ch = B - T + 1;

    // ② 連通塊 → 篩出人工遮罩
    const seen = new Uint8Array(W * H), stack = [];
    const boxes = []; let refPix = 0, covered = 0;
    for (let y = T; y <= B; y++) for (let x = L; x <= R; x++) {
      const i0 = y * W + x;
      if (seen[i0] || !dark(i0)) continue;
      const pix = []; let x0 = x, x1 = x, y0 = y, y1 = y, sum = 0, sum2 = 0;
      stack.push(i0); seen[i0] = 1;
      while (stack.length) {
        const i = stack.pop(), px = i % W, py = (i / W) | 0;
        pix.push(i);
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        const p = at(i), lum = (p[0] + p[1] + p[2]) / 3;
        sum += lum; sum2 += lum * lum;
        const nb = [px > L ? i - 1 : -1, px < R ? i + 1 : -1, py > T ? i - W : -1, py < B ? i + W : -1];
        for (const j of nb) if (j >= 0 && !seen[j] && dark(j)) { seen[j] = 1; stack.push(j); }
      }
      const n = pix.length, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      if (n / (cw * ch) < 0.01 || n / (bw * bh) < 0.70 || sd > 2.5) continue;
      boxes.push({ x0: (x0 - L) / cw, y0: (y0 - T) / ch, x1: (x1 + 1 - L) / cw, y1: (y1 + 1 - T) / ch });
      for (const i of pix) {
        refPix++;
        const px = ((i % W) - L + 0.5) / cw, py = (((i / W) | 0) - T + 0.5) / ch;
        if (masks.some(m => px >= m.x0 && px <= m.x1 && py >= m.y0 && py <= m.y1)) covered++;
      }
    }

    // 我們的遮罩聯集面積（同一個內容框空間）
    let ourPix = 0;
    for (let y = 0; y < ch; y += 2) for (let x = 0; x < cw; x += 2) {
      const px = (x + 0.5) / cw, py = (y + 0.5) / ch;
      if (masks.some(m => px >= m.x0 && px <= m.x1 && py >= m.y0 && py <= m.y1)) ourPix++;
    }
    return { cov: refPix ? covered / refPix : 0, refArea: refPix / (cw * ch),
             ourArea: ourPix / ((cw / 2 | 0) * (ch / 2 | 0)), boxes,
             content: { cw, ch, l: L / W, t: T / H } };
  }, { data: b64(rel), masks });
}

/** 目標區域被任一遮罩覆蓋的比例（格點取樣） */
function coverage(masks, t, n = 60) {
  let inside = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const px = t.x0 + (t.x1 - t.x0) * (i + 0.5) / n;
    const py = t.y0 + (t.y1 - t.y0) * (j + 0.5) / n;
    if (masks.some(m => px >= m.x0 && px <= m.x1 && py >= m.y0 && py <= m.y1)) inside++;
  }
  return inside / (n * n);
}

const fmt = r => `[${r.x0.toFixed(3)}, ${r.y0.toFixed(3)} → ${r.x1.toFixed(3)}, ${r.y1.toFixed(3)}]`;

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__censorTest && window.__censorTest.ready(), null, { timeout: 150000 });
  expect(await page.evaluate(() => window.__censorTest.backend())).toBe('webgl');
});
test.afterAll(async () => { await page?.close(); });

// ── ① 與使用者提供的人工遮罩成品比對 ──────────────────────────────────
test.describe('參考成品比對', () => {
  for (const pair of TARGETS.references) {
    test(`${pair.source} 的遮罩完全包住 ${pair.ref}`, async () => {
      test.skip(!has(pair.source) || !has(pair.ref), '缺少素材');
      const ours = await analyze(page, pair.source);
      const r = await refCoverage(page, pair.ref, ours.masks);

      expect(ours.grade, `${pair.source} 不應被擋下`).not.toBe('RED');
      expect(ours.masks.length, `我們應產生 ${pair.masks} 個遮罩`).toBe(pair.masks);
      // 防呆：偵測器若什麼都沒抓到，覆蓋率會變成沒有意義的 100%
      expect(r.refArea, `在 ${pair.ref} 裡找不到人工遮罩（只認出 ${(r.refArea * 100).toFixed(1)}% 畫面）`)
        .toBeGreaterThan(0.05);
      expect(r.boxes.length, `參考圖應量到 ${pair.refRects} 塊人工遮罩`).toBe(pair.refRects);

      // 覆蓋率必須 100%：漏遮是不可接受的方向
      expect(r.cov, `人工遮罩只被蓋住 ${(r.cov * 100).toFixed(1)}%` +
        `\n參考區塊：${r.boxes.map(fmt).join('  ')}` +
        `\n我們的遮罩：${ours.masks.map(fmt).join('  ')}`).toBe(1);

      // 大小合理性：多遮是安全方向，但不該離譜到看起來像壞掉。
      // 這條是「幾何算爆了」的偵測器，不是還原度目標——修好朝向誤判前曾達 3.1 倍
      // 且下半身帶橫向滿版。目前實測 2.1~2.4 倍，主要來自胸部帶比參考高約一倍、
      // 以及半身模式的胸部帶刻意鋪滿畫面寬。安全性由上面的 100% 覆蓋保證。
      const ratio = r.ourArea / r.refArea;
      expect(ratio, `遮罩聯集面積為參考的 ${ratio.toFixed(2)} 倍，過大`).toBeLessThan(2.6);
      expect(ratio, '遮罩聯集面積小於參考，可能漏遮').toBeGreaterThan(1);
    });
  }
});

// ── ② 人工標定的裸露區域必須被覆蓋 ────────────────────────────────────
test.describe('裸露區域覆蓋', () => {
  for (const [file, regions] of Object.entries(TARGETS.regions)) {
    test(`${file} 的裸露區域都被遮住`, async () => {
      test.skip(!has(file), '缺少素材');
      const r = await analyze(page, file);

      // 工具主動舉手 → 交給人工，不算漏遮
      test.skip(r.grade === 'RED', `工具已標為 RED（${r.reason}），轉人工處理`);

      expect(r.masks.length, '非 RED 的圖必須有遮罩').toBeGreaterThan(0);
      for (const t of regions) {
        const cov = coverage(r.masks, t);
        expect(cov, `${t.name} ${fmt(t)} 覆蓋率僅 ${(cov * 100).toFixed(1)}%` +
          `\n遮罩：${r.masks.map(fmt).join('  ')}`).toBe(1);
      }
    });
  }
});

// ── ③ 全批不變式 ──────────────────────────────────────────────────────
test.describe('全批不變式', () => {
  const files = fs.existsSync(TEST_DIR)
    ? fs.readdirSync(TEST_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort() : [];

  test('每張圖不是有遮罩、就是被明確舉手', async () => {
    const bad = [];
    for (const f of files) {
      const r = await analyze(page, f);
      // 這是最重要的一條：不能有圖既沒遮罩又沒被舉手
      if (r.grade !== 'RED' && r.masks.length === 0) bad.push(`${f} 分級 ${r.grade} 卻沒有任何遮罩`);
      if (r.grade === 'RED' && r.masks.length > 0) bad.push(`${f} 為 RED 卻仍產生了遮罩`);
      for (const m of r.masks) {
        if (m.x0 < 0 || m.y0 < 0 || m.x1 > 1.0001 || m.y1 > 1.0001) bad.push(`${f} 遮罩超出畫面 ${fmt(m)}`);
        if (m.x1 <= m.x0 || m.y1 <= m.y0) bad.push(`${f} 遮罩為零面積或反向 ${fmt(m)}`);
      }
      // 有遮罩時，第一個一定是胸部帶
      if (r.masks.length > 0 && r.masks[0].y1 - r.masks[0].y0 <= 0) bad.push(`${f} 胸部帶高度為 0`);
    }
    expect(bad.join('\n')).toBe('');
    expect(files.length, 'test/ 內應有素材').toBeGreaterThan(0);
  });

  test('全身模式的遮罩寬度不會撐滿整個畫面', async () => {
    const bad = [];
    for (const f of files) {
      const r = await analyze(page, f);
      // 半身模式的胸部帶是「刻意」鋪滿畫面寬的（見 design.md 決策 7d）——那是
      // 唯一一維我們沒有比例尺可依靠的方向。這條不變式只針對全身模式，它要抓的
      // 是「幾何算爆後被邊界截斷」，那只會發生在有髖部錨點的推導裡。
      if (r.mode !== 'full') continue;
      for (const m of r.masks) {
        const w = m.x1 - m.x0;
        if (w > 0.99) bad.push(`${f} 遮罩寬度 ${(w * 100).toFixed(1)}% ${fmt(m)}`);
      }
    }
    expect(bad.join('\n')).toBe('');
  });
});
