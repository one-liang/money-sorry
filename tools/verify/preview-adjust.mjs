/**
 * index.html 手動構圖調整的自動驗證。
 *
 *   node tools/verify/preview-adjust.mjs [測試圖資料夾]   （預設 test/）
 *
 * 腳本會自己起一個靜態 server，不需要另外跑 serve.cmd。
 * 三個重點：
 *   1. 沒動過的照片，輸出必須與加這個功能之前（develop）逐位元相同
 *   2. 動過的照片，輸出要跟著變，而且同樣的調整要得到同樣的結果
 *   3. 預覽與輸出是同一件事——把預覽截圖與實際輸出的 JPEG 做像素比對
 * 最後會把幾個狀態截圖到 tools/verify/out/，**構圖好不好看要人眼確認**。
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const IMG_DIR = path.resolve(ROOT, process.argv[2] || 'test');
const OUT_DIR = path.join(HERE, 'out');
const PORT = 3112;
const EPS = 0.6;          // 像素比對容差：computed style 會有四捨五入
// 沒動過的輸出要對得上這個 ref。刻意釘在「加這個功能之前的最後一次發布」，
// 不能寫 develop——功能合進去之後那就變成跟自己比，這項檢查會永遠通過。
const BASE_REF = 'v1.2.0';

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
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

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

/**
 * 讀回預覽的實際幾何。刻意只看 DOM 量得到的東西（照片圖層在畫面上的位置
 * 與大小），不去碰頁面內部變數，這樣改實作時測試才不會跟著爛掉。
 */
const view = page => page.evaluate(() => {
  const stage = document.getElementById('stage');
  const s = stage.getBoundingClientRect();
  const p = document.getElementById('pphoto').getBoundingClientRect();
  return {
    level: document.getElementById('zlevel').textContent,
    resetOff: document.getElementById('zlevel').disabled,
    zinOff: document.getElementById('zin').disabled,
    zoutOff: document.getElementById('zout').disabled,
    barShown: getComputedStyle(document.getElementById('zoombar')).display !== 'none',
    movable: stage.classList.contains('movable'),
    touch: getComputedStyle(stage).touchAction,
    stage: { x: s.x, y: s.y, w: s.width, h: s.height },
    photo: { x: p.x, y: p.y, w: p.width, h: p.height },
  };
});

/** 照片一定要蓋滿外框，任何一邊縮進去就會露出白底 */
const covers = v =>
  v.photo.x <= v.stage.x + 1 && v.photo.y <= v.stage.y + 1 &&
  v.photo.x + v.photo.w >= v.stage.x + v.stage.w - 1 &&
  v.photo.y + v.photo.h >= v.stage.y + v.stage.h - 1;

/** 螢幕上某點壓在照片自身的哪個相對位置（0~1）；縮放錨定要看這個 */
const spotAt = (v, cx, cy) => ({
  x: (cx - v.photo.x) / v.photo.w,
  y: (cy - v.photo.y) / v.photo.h,
});

const mid = v => ({ x: v.stage.x + v.stage.w / 2, y: v.stage.y + v.stage.h / 2 });

const load = async (page, files) => {
  await page.setInputFiles('#picker', files);
  await page.waitForSelector('#stage.has:not(.busy)', { timeout: 30000 });
};

/**
 * 點清單切換照片並等它真的換好。
 * 檔名是 select() 一進去就換的（要立刻有回饋），控制列則要等解碼完，
 * 所以光等檔名會讀到上一張的狀態。
 */
const pick = async (page, i, name) => {
  await page.locator('#list li').nth(i).click();
  await page.waitForFunction(
    n => document.getElementById('pname').textContent === n
      && !document.getElementById('stage').classList.contains('busy'),
    name, { timeout: 30000 });
};

const shot = (page, v, name) => page.screenshot({
  path: path.join(OUT_DIR, name),
  clip: { x: v.stage.x, y: v.stage.y, width: v.stage.w, height: v.stage.h + 40 },
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

const drag = async (page, from, dx, dy, steps = 8) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
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
 * 兩張圖縮到 200×200 後的平均逐通道差（0~255）。
 * 拿來比「預覽截圖」與「實際輸出」——重取樣與 JPEG 壓縮讓它不可能為 0，
 * 但構圖只要差一點，這個值就會明顯拉高。
 */
const meanDiff = (page, a, b) => page.evaluate(async ([a, b]) => {
  const draw = async src => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 200;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 200, 200);
    return ctx.getImageData(0, 0, 200, 200).data;
  };
  const [x, y] = [await draw(a), await draw(b)];
  let sum = 0, n = 0;
  for (let i = 0; i < x.length; i += 4) {
    sum += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
    n += 3;
  }
  return sum / n;
}, [a, b]);

const dataUri = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;

/** develop 版本的輸出，當作「沒動過就不該變」的基準 */
const baselineOutput = async (browser, image) => {
  const file = path.join(OUT_DIR, 'baseline-index.html');
  fs.writeFileSync(file, execFileSync('git', ['show', `${BASE_REF}:index.html`], { cwd: ROOT, maxBuffer: 1 << 26 }));
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/${path.relative(ROOT, file).split(path.sep).join('/')}`);
  await load(page, [image]);
  const out = await grabDownload(page);
  await ctx.close();
  return out;
};

/** 手機情境：窄版單欄 + 觸控 */
const touchDrag = async (cdp, from, dx, dy, steps = 8) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + dx * i / steps, y: from.y + dy * i / steps }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const mobileChecks = async (browser, images) => {
  console.log('\n手機（觸控）');
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/index.html`);

  let v = await view(page);
  check('還沒選圖時手指是留給整頁捲動的', v.touch === 'pan-y', v.touch);

  await load(page, images.slice(0, 2));
  await page.locator('#stage').scrollIntoViewIfNeeded();
  v = await view(page);
  check('有得調時才接管手勢', v.movable && v.touch === 'none', `${v.movable} / ${v.touch}`);

  const cdp = await ctx.newCDPSession(page);
  const y0 = await page.evaluate(() => window.scrollY);
  const shift = -Math.round((v.photo.h - v.stage.h) / 4);   // 拿可調範圍的一半，別去撞邊界
  await touchDrag(cdp, mid(v), 0, shift);
  await page.waitForTimeout(300);
  const after = await view(page);
  const y1 = await page.evaluate(() => window.scrollY);
  check('單指拖曳是在調整照片位置', near(after.photo.y, v.photo.y + shift, 3),
        `photo.y ${v.photo.y.toFixed(1)} → ${after.photo.y.toFixed(1)}（拖 ${shift}）`);
  check('調整時頁面不會跟著捲', y1 === y0, `scrollY ${y0} → ${y1}`);
  check('照片仍蓋滿外框', covers(after));
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
  check('file:// 下調整照常運作', v.level === '125%' && v.barShown && covers(v), v.level);
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

  await load(page, images.slice(0, 3));
  v = await view(page);
  check('選圖後控制列顯示', v.barShown);
  check('起點是自動裁切的 100%', v.level === '100%', v.level);
  check('沒動過時重設鍵停用', v.resetOff);
  check('100% 時不能再縮小', v.zoutOff && !v.zinOff);
  check('照片蓋滿外框', covers(v), `photo ${v.photo.w.toFixed(0)}×${v.photo.h.toFixed(0)}`);
  check('直式照片在 100% 就有得調（上下還有空間）', v.movable);
  await shot(page, v, 'adjust-1-auto.png');

  // ---- 拖曳調整位置 ----
  console.log('\n拖曳調整位置');
  const before = spotAt(v, mid(v).x, mid(v).y);
  await drag(page, mid(v), 0, 25);
  v = await view(page);
  check('往下拖，照片跟著往下', near(v.photo.y, v.stage.y - (v.photo.h - v.stage.h) / 2 + 25, 2),
        `photo.y=${v.photo.y.toFixed(1)}`);
  check('中心壓到的位置確實換了', Math.abs(spotAt(v, mid(v).x, mid(v).y).y - before.y) > 0.01);
  check('拖曳後仍蓋滿外框', covers(v));
  check('清單標出已手動調整', (await page.textContent('#list li.sel .dim')).includes('已手動調整'));
  check('重設鍵啟用', !v.resetOff);
  await shot(page, v, 'adjust-2-moved.png');

  await drag(page, mid(v), 0, 4000);
  v = await view(page);
  check('拖過頭會被夾住，照片不會離開外框', covers(v) && near(v.photo.y, v.stage.y, 1.5),
        `photo.y=${v.photo.y.toFixed(1)} stage.y=${v.stage.y.toFixed(1)}`);

  // ---- 縮放 ----
  console.log('\n縮放');
  await page.click('#zlevel');
  await page.click('#zin');
  v = await view(page);
  check('放大一級 → 125%', v.level === '125%', v.level);
  check('放大後照片變大', near(v.photo.w, v.stage.w * 1.25, 2), `photo.w=${v.photo.w.toFixed(1)}`);
  check('放大後仍蓋滿外框', covers(v));
  await page.click('#zout');
  v = await view(page);
  check('縮小一級 → 回到 100%', v.level === '100%' && v.zoutOff);

  const clicks = await mash(page, '#zin');
  v = await view(page);
  check('一路放大會停在上限 800%', v.level === '800%' && v.zinOff, `${v.level}／按了 ${clicks} 下`);
  check('放到最大仍蓋滿外框', covers(v));
  await mash(page, '#zout');
  v = await view(page);
  check('一路縮小會停在下限 100%', v.level === '100%' && v.zoutOff, v.level);

  // ---- 滾輪的錨點 ----
  console.log('\n滾輪縮放');
  const ax = v.stage.x + v.stage.w * 0.72;      // 挑一個明顯偏離中心的點
  const ay = v.stage.y + v.stage.h * 0.28;
  const spot0 = spotAt(v, ax, ay);
  await page.mouse.move(ax, ay);
  await page.mouse.wheel(0, -400);
  v = await view(page);
  const spot1 = spotAt(v, ax, ay);
  check('滾輪向上＝放大', v.photo.w > v.stage.w * 1.05, v.level);
  check('游標底下的位置不動（縮放錨定）',
        near(spot0.x, spot1.x, 0.01) && near(spot0.y, spot1.y, 0.01),
        `${spot0.x.toFixed(3)},${spot0.y.toFixed(3)} → ${spot1.x.toFixed(3)},${spot1.y.toFixed(3)}`);
  check('錨定縮放後仍蓋滿外框', covers(v));
  await page.mouse.wheel(0, 4000);
  v = await view(page);
  check('滾輪向下縮到底停在 100%', v.level === '100%');

  // ---- 重設與捏合 ----
  console.log('\n重設與捏合');
  await drag(page, mid(v), 0, 20);
  await page.click('#zlevel');
  v = await view(page);
  check('重設回自動裁切', v.level === '100%' && v.resetOff && covers(v));
  check('重設後清單不再標已調整',
        !(await page.textContent('#list li.sel .dim')).includes('已手動調整'));

  await pinch(page, 100, 260);
  v = await view(page);
  check('兩指張開＝放大', near(v.photo.w / v.stage.w, 2.6, 0.15), v.level);
  check('捏合後仍蓋滿外框', covers(v));
  await pinch(page, 260, 100);
  v = await view(page);
  check('兩指收合＝縮回 100%', v.level === '100%' && v.resetOff, v.level);

  // ---- 每張各自記住 ----
  console.log('\n每張各自記住調整');
  await drag(page, mid(v), 0, 30);
  const kept = await view(page);
  await pick(page, 1, path.basename(images[1]));
  v = await view(page);
  check('換一張是乾淨的自動裁切', v.level === '100%' && v.resetOff, v.level);
  await pick(page, 0, path.basename(images[0]));
  v = await view(page);
  check('切回來時原本的調整還在', near(v.photo.y, kept.photo.y, 1.5),
        `photo.y ${kept.photo.y.toFixed(1)} → ${v.photo.y.toFixed(1)}`);

  // ---- 輸出 ----
  console.log('\n輸出');
  const baseline = await baselineOutput(browser, images[0]);
  await page.reload();
  await load(page, [images[0]]);
  const untouched = await grabDownload(page);
  check(`沒動過的輸出與 ${BASE_REF} 逐位元相同`, sha(untouched) === sha(baseline),
        `${(untouched.length / 1024).toFixed(0)} KB`);

  await page.reload();
  await load(page, [images[0]]);
  v = await view(page);
  await drag(page, mid(v), 0, 4000);              // 拖到頂，構圖明顯不同
  const moved = await grabDownload(page);
  check('調整過的輸出會跟著變', sha(moved) !== sha(untouched));

  await page.reload();
  await load(page, [images[0]]);
  v = await view(page);
  await drag(page, mid(v), 0, 60);                // 換一條路徑拖到同一個界限
  const moved2 = await grabDownload(page);
  check('夾到同一個邊界就得到同一張（同調整＝同結果）', sha(moved) === sha(moved2));

  // ---- 預覽與輸出是同一件事 ----
  console.log('\n預覽 = 輸出');
  v = await view(page);
  const png = await page.screenshot({
    clip: { x: v.stage.x, y: v.stage.y, width: v.stage.w, height: v.stage.h },
  });
  const same = await meanDiff(page, dataUri(png, 'image/png'), dataUri(moved, 'image/jpeg'));
  const other = await meanDiff(page, dataUri(png, 'image/png'), dataUri(untouched, 'image/jpeg'));
  check('預覽截圖與實際輸出幾乎一致', same < 12, `平均差 ${same.toFixed(2)}/255`);
  check('且明顯比「沒調整的那張」接近', same < other * 0.5,
        `${same.toFixed(2)} vs ${other.toFixed(2)}`);
  await shot(page, v, 'adjust-3-output.png');

  check('全程沒有 JS 例外', errors.length === 0, errors.join(' | '));

  await mobileChecks(browser, images);
  await fileProtocolCheck(browser, images);

  await browser.close();
  server.close();

  console.log(`\n${fail ? '✗' : '✓'} ${pass} 通過 / ${fail} 失敗`);
  console.log(`截圖：${path.relative(ROOT, OUT_DIR)}（構圖請人眼確認）`);
  process.exit(fail ? 1 : 0);
};

run().catch(err => { console.error(err); process.exit(1); });
