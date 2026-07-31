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
      grade: r.grade, reason: r.reason, w: r.w, h: r.h,
      masks: r.masks.map(m => ({ x0: m.x0 / r.w, y0: m.y0 / r.h, x1: m.x1 / r.w, y1: m.y1 / r.h })),
    };
  }, { data: b64(rel) });
}

/** 量出一張人工遮罩成品裡的純黑矩形（正規化座標） */
async function measureBlackRects(page, rel) {
  return page.evaluate(async ({ data }) => {
    const bin = atob(data), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u]));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const dark = (px, py) => { const i = (py * c.width + px) * 4; return d[i] < 45 && d[i + 1] < 45 && d[i + 2] < 45; };
    const bands = []; let cur = null;
    for (let y = 0; y < c.height; y++) {
      let n = 0; for (let px = 0; px < c.width; px++) if (dark(px, y)) n++;
      if (n / c.width > 0.25) { if (!cur) cur = [y, y]; else cur[1] = y; }
      else { if (cur && cur[1] - cur[0] > 8) bands.push(cur); cur = null; }
    }
    if (cur && cur[1] - cur[0] > 8) bands.push(cur);
    const rects = [];
    for (const [y0, y1] of bands) {
      let x0 = c.width, x1 = 0;
      for (let px = 0; px < c.width; px++) {
        let all = true;
        for (let y = y0; y <= y1; y += 2) if (!dark(px, y)) { all = false; break; }
        if (all) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); }
      }
      if (x1 > x0) rects.push({ x0: x0 / c.width, y0: y0 / c.height, x1: (x1 + 1) / c.width, y1: (y1 + 1) / c.height });
    }
    bmp.close();
    return rects;
  }, { data: b64(rel) });
}

/** 一組矩形的聯集面積（格點取樣）。重疊處只算一次，才是「畫面被塗黑多少」的真實度量 */
function unionArea(rects, n = 400) {
  if (!rects.length) return 0;
  let hit = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const px = (i + 0.5) / n, py = (j + 0.5) / n;
    if (rects.some(m => px >= m.x0 && px <= m.x1 && py >= m.y0 && py <= m.y1)) hit++;
  }
  return hit / (n * n);
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
      const refs = await measureBlackRects(page, pair.ref);

      expect(ours.grade, `${pair.source} 不應被擋下`).not.toBe('RED');
      expect(refs.length, '參考圖應量到 2 個遮罩區塊').toBe(2);
      expect(ours.masks.length, '我們也應產生 2 個遮罩').toBe(2);

      for (const [i, ref] of refs.entries()) {
        // 覆蓋率必須 100%：漏遮是不可接受的方向
        const cov = coverage(ours.masks, ref);
        expect(cov, `參考區塊 ${i} ${fmt(ref)} 未被完全覆蓋（實際 ${(cov * 100).toFixed(1)}%）` +
          `\n我們的遮罩：${ours.masks.map(fmt).join('  ')}`).toBe(1);
      }

      // 大小合理性：多遮是安全方向，但不該離譜到看起來像壞掉。
      // 用聯集面積比較——兩條帶會重疊，相加會重複計算。
      const ourArea = unionArea(ours.masks);
      const refArea = unionArea(refs);
      const ratio = ourArea / refArea;
      // 這條是「幾何算爆了」的偵測器，不是還原度目標。修好朝向誤判前曾是 3.1 倍
      // 且下半身帶橫向滿版；目前實測 2.3~2.4 倍，主要來自胸部帶比參考高約一倍。
      // 安全性由上面的 100% 覆蓋保證，這裡只擋住離譜的膨脹。
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

  test('遮罩寬度不會撐滿整個畫面', async () => {
    const bad = [];
    for (const f of files) {
      const r = await analyze(page, f);
      for (const m of r.masks) {
        const w = m.x1 - m.x0;
        // 撐到 99% 以上通常代表幾何算爆了被邊界截斷，而不是真的需要那麼寬
        if (w > 0.99) bad.push(`${f} 遮罩寬度 ${(w * 100).toFixed(1)}% ${fmt(m)}`);
      }
    }
    expect(bad.join('\n')).toBe('');
  });
});
