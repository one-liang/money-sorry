/**
 * index.html 預覽縮放／平移的自動驗證。
 *
 *   node tools/verify/preview-zoom.mjs [測試圖資料夾]   （預設 test/）
 *
 * 腳本會自己起一個靜態 server，不需要另外跑 serve.cmd。
 * 除了互動行為，這裡也對「縮放不能影響輸出」做位元級比對：
 * 同一張圖，放大平移過與沒動過，產出的 JPEG 必須一模一樣。
 * 最後會把幾個縮放狀態截圖到 tools/verify/out/，**畫面好不好看要人眼確認**。
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const IMG_DIR = path.resolve(ROOT, process.argv[2] || 'test');
const OUT_DIR = path.join(HERE, 'out');
const PORT = 3112;
const EPS = 0.6;   // 像素比對容差：computed style 會有四捨五入

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

const serve = () => http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT);

/** 從 computed transform 讀回目前的視角，避免依賴頁面內部變數 */
const view = page => page.evaluate(() => {
  const stage = document.getElementById('stage');
  const t = getComputedStyle(document.getElementById('preview')).transform;
  const m = t === 'none' ? new DOMMatrix() : new DOMMatrix(t);
  const r = stage.getBoundingClientRect();
  return {
    s: m.a, x: m.e, y: m.f,
    level: document.getElementById('zlevel').textContent,
    zoomed: stage.classList.contains('zoomed'),
    zinDisabled: document.getElementById('zin').disabled,
    zoutDisabled: document.getElementById('zout').disabled,
    barShown: getComputedStyle(document.getElementById('zoombar')).display !== 'none',
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
});

/** 螢幕上某點對應到影像的哪個位置（以舞台中心為原點的未縮放座標） */
const imagePointAt = (v, cx, cy) => ({
  x: (cx - v.rect.x - v.rect.w / 2 - v.x) / v.s,
  y: (cy - v.rect.y - v.rect.h / 2 - v.y) / v.s,
});

const load = async (page, files) => {
  await page.setInputFiles('#picker', files);
  await page.waitForSelector('#stage.has', { timeout: 30000 });
};

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** 截舞台加下面那排（檔名＋控制列）；Playwright 的 clip 要 width/height，不是 w/h */
const shot = (page, v, name) => page.screenshot({
  path: path.join(OUT_DIR, name),
  clip: { x: v.rect.x, y: v.rect.y, width: v.rect.w, height: v.rect.h + 40 },
});

/** 一直按到按鈕自己停用為止（到上／下限就該停用），回傳按了幾下 */
const mash = async (page, sel, limit = 30) => {
  let n = 0;
  while (n < limit && !await page.locator(sel).isDisabled()) { await page.click(sel); n++; }
  return n;
};

const grabDownload = async page => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click('#go'),
  ]);
  return fs.readFileSync(await dl.path());
};

/** 用合成的 PointerEvent 模擬兩指捏合；Playwright 的 touchscreen 只會點不會捏 */
const pinch = (page, from, to) => page.evaluate(([from, to]) => {
  const stage = document.getElementById('stage');
  const send = (type, id, x, y) => stage.dispatchEvent(
    new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
  const r = stage.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;

  send('pointerdown', 101, cx - from / 2, cy);
  send('pointerdown', 102, cx + from / 2, cy);
  for (let i = 1; i <= 8; i++) {
    const d = from + (to - from) * (i / 8);
    send('pointermove', 101, cx - d / 2, cy);
    send('pointermove', 102, cx + d / 2, cy);
  }
  send('pointerup', 101, cx - to / 2, cy);
  send('pointerup', 102, cx + to / 2, cy);
}, [from, to]);

/**
 * 真實的單指拖曳。合成 PointerEvent 繞過 touch-action，驗不到「100% 時
 * 手指要能捲頁、放大後才吃掉手勢」，所以這裡走 CDP 發真的 touch 事件。
 */
const touchDrag = async (cdp, from, to, steps = 8) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

/** 手機情境：窄版單欄 + 觸控 */
const mobileChecks = async (browser, images) => {
  console.log('\n手機（觸控）');
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/index.html`);
  await load(page, images.slice(0, 2));
  const cdp = await ctx.newCDPSession(page);

  await page.locator('#stage').scrollIntoViewIfNeeded();
  let v = await view(page);
  const mid = { x: v.rect.x + v.rect.w / 2, y: v.rect.y + v.rect.h / 2 };
  const y0 = await page.evaluate(() => window.scrollY);
  await touchDrag(cdp, mid, { x: mid.x, y: mid.y - 160 });
  await page.waitForTimeout(300);                     // 捲動有慣性，等它停
  const y1 = await page.evaluate(() => window.scrollY);
  check('100% 時手指在預覽上仍能捲頁', y1 > y0 + 20, `scrollY ${y0} → ${y1}`);

  await page.locator('#stage').scrollIntoViewIfNeeded();
  await page.click('#zin'); await page.click('#zin'); await page.click('#zin');
  v = await view(page);
  const mid2 = { x: v.rect.x + v.rect.w / 2, y: v.rect.y + v.rect.h / 2 };
  const y2 = await page.evaluate(() => window.scrollY);
  await touchDrag(cdp, mid2, { x: mid2.x - 40, y: mid2.y - 60 });
  await page.waitForTimeout(300);
  const after = await view(page);
  const y3 = await page.evaluate(() => window.scrollY);
  check('放大後手指改成平移圖片', near(after.x, -40, 3) && near(after.y, -60, 3),
        `pan=${after.x.toFixed(1)},${after.y.toFixed(1)}`);
  check('平移時頁面不會跟著捲', y3 === y2, `scrollY ${y2} → ${y3}`);
  check('手機情境沒有 JS 例外', errors.length === 0, errors.join(' | '));

  await ctx.close();
};

/** 套框工具主打「雙擊 index.html 就能用」，所以 file:// 也要走一遍 */
const fileProtocolCheck = async (browser, images) => {
  console.log('\nfile://（雙擊開啟）');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
  await load(page, [images[0]]);
  await page.click('#zin');
  const v = await view(page);
  check('file:// 下縮放照常運作', v.level === '125%' && v.barShown, v.level);
  check('file:// 下沒有 JS 例外', errors.length === 0, errors.join(' | '));
  await ctx.close();
};

const run = async () => {
  const server = serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const images = fs.readdirSync(IMG_DIR)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .map(f => path.join(IMG_DIR, f));
  if (images.length < 2) throw new Error(`${IMG_DIR} 至少要有兩張測試圖`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await page.goto(`http://localhost:${PORT}/index.html`);

  // ---- 初始狀態 ----
  console.log('\n初始狀態');
  let v = await view(page);
  check('尚未選圖時控制列不顯示', !v.barShown);
  check('初始為 100%', near(v.s, 1, 0.001) && near(v.x, 0) && near(v.y, 0), `scale=${v.s}`);

  await load(page, images.slice(0, 3));
  v = await view(page);
  check('選圖後控制列顯示', v.barShown);
  check('標示 100%', v.level === '100%', v.level);
  check('100% 時縮小鍵停用、放大鍵可用', v.zoutDisabled && !v.zinDisabled);
  check('100% 時不帶 zoomed（不出現抓手游標）', !v.zoomed);
  await shot(page, v, 'zoom-1-fit.png');

  // ---- 按鈕縮放 ----
  console.log('\n按鈕縮放');
  await page.click('#zin');
  v = await view(page);
  check('放大一級 → 125%', v.level === '125%' && near(v.s, 1.25, 0.01), `scale=${v.s}`);
  check('進入 zoomed 狀態', v.zoomed);
  check('置中放大不位移', near(v.x, 0) && near(v.y, 0), `pan=${v.x},${v.y}`);
  await page.click('#zout');
  v = await view(page);
  check('縮小一級 → 回到 100%', v.level === '100%' && near(v.s, 1, 0.001));
  check('回到 100% 時位移歸零', near(v.x, 0) && near(v.y, 0));

  const clicks = await mash(page, '#zin');
  v = await view(page);
  check('一路放大會停在上限 800%', v.level === '800%' && v.zinDisabled, `${v.level}／按了 ${clicks} 下`);
  await mash(page, '#zout');
  v = await view(page);
  check('一路縮小會停在下限 100%', v.level === '100%' && v.zoutDisabled, v.level);
  check('縮回下限時位移歸零', near(v.x, 0) && near(v.y, 0));

  // ---- 滾輪縮放的錨點 ----
  console.log('\n滾輪縮放');
  v = await view(page);
  const ax = v.rect.x + v.rect.w * 0.75;      // 挑一個明顯偏離中心的點
  const ay = v.rect.y + v.rect.h * 0.30;
  const before = imagePointAt(v, ax, ay);
  await page.mouse.move(ax, ay);
  await page.mouse.wheel(0, -400);
  v = await view(page);
  const after = imagePointAt(v, ax, ay);
  check('滾輪向上＝放大', v.s > 1.05, `scale=${v.s.toFixed(3)}`);
  check('游標底下的影像點不動（縮放錨定）',
        near(before.x, after.x, 1.2) && near(before.y, after.y, 1.2),
        `${before.x.toFixed(1)},${before.y.toFixed(1)} → ${after.x.toFixed(1)},${after.y.toFixed(1)}`);
  await page.mouse.wheel(0, 4000);
  v = await view(page);
  check('滾輪向下縮到底停在 100%', near(v.s, 1, 0.001) && near(v.x, 0) && near(v.y, 0));

  // ---- 拖曳平移 ----
  console.log('\n拖曳平移');
  const cx = () => v.rect.x + v.rect.w / 2;
  const cy = () => v.rect.y + v.rect.h / 2;
  await page.mouse.move(cx(), cy());
  await page.mouse.down();
  await page.mouse.move(cx() + 60, cy() + 40, { steps: 6 });
  await page.mouse.up();
  v = await view(page);
  check('100% 時拖曳不動（沒有可平移的空間）', near(v.x, 0) && near(v.y, 0), `pan=${v.x},${v.y}`);

  await page.click('#zin'); await page.click('#zin'); await page.click('#zin');  // ≈195%
  v = await view(page);
  await page.mouse.move(cx(), cy());
  await page.mouse.down();
  await page.mouse.move(cx() + 50, cy() + 30, { steps: 6 });
  await page.mouse.up();
  v = await view(page);
  check('放大後可拖曳', near(v.x, 50, 2) && near(v.y, 30, 2), `pan=${v.x.toFixed(1)},${v.y.toFixed(1)}`);
  await shot(page, v, 'zoom-2-panned.png');

  await page.mouse.move(cx(), cy());
  await page.mouse.down();
  await page.mouse.move(cx() + 4000, cy() + 4000, { steps: 8 });
  await page.mouse.up();
  v = await view(page);
  const maxX = (v.s - 1) * v.rect.w / 2, maxY = (v.s - 1) * v.rect.h / 2;
  check('拖過頭會被夾在邊界內（不會拖出空白）',
        v.x <= maxX + EPS && v.y <= maxY + EPS && near(v.x, maxX, 1) && near(v.y, maxY, 1),
        `pan=${v.x.toFixed(1)},${v.y.toFixed(1)} max=${maxX.toFixed(1)},${maxY.toFixed(1)}`);

  // ---- 重設與雙擊 ----
  console.log('\n重設與雙擊');
  await page.click('#zlevel');
  v = await view(page);
  check('點百分比重設回 100% 並歸零位移',
        v.level === '100%' && near(v.x, 0) && near(v.y, 0));

  await page.mouse.dblclick(v.rect.x + v.rect.w * 0.3, v.rect.y + v.rect.h * 0.7);
  v = await view(page);
  check('雙擊放大到 200%', v.level === '200%', v.level);
  check('雙擊點偏離中心 → 有對應位移', Math.abs(v.x) > 10 && Math.abs(v.y) > 10,
        `pan=${v.x.toFixed(1)},${v.y.toFixed(1)}`);
  await page.mouse.dblclick(v.rect.x + v.rect.w * 0.3, v.rect.y + v.rect.h * 0.7);
  v = await view(page);
  check('再雙擊還原成 100%', v.level === '100%' && near(v.x, 0) && near(v.y, 0));

  // ---- 捏合 ----
  console.log('\n捏合（合成 PointerEvent）');
  await pinch(page, 100, 260);
  v = await view(page);
  check('兩指張開＝放大', near(v.s, 2.6, 0.15), `scale=${v.s.toFixed(3)}`);
  await pinch(page, 260, 100);
  v = await view(page);
  check('兩指收合＝縮小回 100%', near(v.s, 1, 0.02), `scale=${v.s.toFixed(3)}`);

  // ---- 與清單切換的互動 ----
  console.log('\n切換照片');
  await page.click('#zin'); await page.click('#zin');
  const kept = await view(page);
  await page.locator('#list li').nth(1).click();
  await page.waitForFunction(
    name => document.getElementById('pname').textContent === name,
    path.basename(images[1]), { timeout: 30000 });
  v = await view(page);
  check('切換照片保留縮放（方便比對同一角落）',
        v.level === kept.level && near(v.s, kept.s, 0.001), `${kept.level} → ${v.level}`);
  check('預覽確實換了一張', await page.textContent('#pname') === path.basename(images[1]));

  await load(page, images.slice(0, 2));
  v = await view(page);
  check('重新選一批照片會重設視角', v.level === '100%' && near(v.x, 0) && near(v.y, 0), v.level);

  // ---- 縮放不能影響輸出 ----
  console.log('\n輸出不受縮放影響');
  await load(page, [images[0]]);
  const plain = await grabDownload(page);
  await page.reload();
  await load(page, [images[0]]);
  await page.click('#zin'); await page.click('#zin'); await page.click('#zin');
  v = await view(page);
  await page.mouse.move(cx(), cy());
  await page.mouse.down();
  await page.mouse.move(cx() + 120, cy() - 90, { steps: 8 });
  await page.mouse.up();
  const zoomed = await grabDownload(page);
  check('放大平移後產出的 JPEG 與未縮放時位元相同',
        sha(plain) === sha(zoomed), `${(plain.length / 1024).toFixed(0)} KB`);

  v = await view(page);
  await shot(page, v, 'zoom-3-detail.png');

  check('全程沒有 JS 例外', errors.length === 0, errors.join(' | '));

  await mobileChecks(browser, images);
  await fileProtocolCheck(browser, images);

  await browser.close();
  server.close();

  console.log(`\n${fail ? '✗' : '✓'} ${pass} 通過 / ${fail} 失敗`);
  console.log(`截圖：${path.relative(ROOT, OUT_DIR)}（縮放後的畫面請人眼確認）`);
  process.exit(fail ? 1 : 0);
};

run().catch(err => { console.error(err); process.exit(1); });
