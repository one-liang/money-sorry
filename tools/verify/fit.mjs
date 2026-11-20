/**
 * studio.html「完整顯示」的自動驗證。
 *
 *   node tools/verify/fit.mjs
 *
 * 不吃 test/：測試圖在瀏覽器裡現畫（直圖、橫圖各一張，上下或左右兩端塗一條
 * 藍邊），所以新環境也能跑。驗的是：
 *
 *   - 預設關閉，一鍵與逐張晶片都能切，計數與三態正確
 *   - 直圖左右留白、橫圖上下留白，且原本會被裁掉的兩端藍邊完整出現
 *   - 預覽就是輸出
 *   - 切回關閉後輸出與從沒開過逐位元相同（index.html 不變量不受影響）
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(HERE, 'out');
const PORT = 3119;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};
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

function readZip(buf) {
  const out = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const start = i + 30 + nameLen + extraLen;
    out.push({ name: buf.slice(i + 30, i + 30 + nameLen).toString('utf8'), bytes: buf.slice(start, start + size) });
    i = start + size;
  }
  return out;
}

/** 單張時是 JPEG 直接下載，多張時是 ZIP；一律攤成 [{name, bytes}] */
const grab = async page => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.click('#go'),
  ]);
  const bytes = fs.readFileSync(await dl.path());
  const name = dl.suggestedFilename();
  return name.endsWith('.zip') ? readZip(bytes) : [{ name, bytes }];
};

const chip = (page, i, which) => page.locator('#list li').nth(i).locator('.chip.' + which);
const isOn = loc => loc.evaluate(e => e.classList.contains('on'));
const bulkState = (page, which) => page.locator('#bulk-' + which).getAttribute('aria-checked');
const bulkCount = async (page, which) =>
  (await page.locator('#' + which + '-count').innerText()).replace(/\s/g, '');

/** 在頁面裡讀 JPEG 的幾個像素，回傳 [r,g,b] */
const pixels = (page, bytes, pts) => page.evaluate(async ([src, pts]) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
}, [`data:image/jpeg;base64,${bytes.toString('base64')}`, pts]);

const near = (p, q, tol = 28) => p.every((v, i) => Math.abs(v - q[i]) <= tol);
const WHITE = [255, 255, 255], RED = [220, 40, 40], BLUE = [30, 60, 220];

const run = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/studio.html`);

  // 現畫兩張測試圖：紅底，長邊的兩端各一條 6% 寬的藍邊——cover 會把它們裁掉
  const made = await page.evaluate(async () => {
    const mk = async (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = 'rgb(220,40,40)'; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgb(30,60,220)';
      if (h > w) { const b = h * 0.06; x.fillRect(0, 0, w, b); x.fillRect(0, h - b, w, b); }
      else       { const b = w * 0.06; x.fillRect(0, 0, b, h); x.fillRect(w - b, 0, b, h); }
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      return [...new Uint8Array(await blob.arrayBuffer())];
    };
    return { tall: await mk(600, 1200), wide: await mk(1200, 600) };
  });
  const tall = path.join(OUT_DIR, 'fit-tall.png');
  const wide = path.join(OUT_DIR, 'fit-wide.png');
  fs.writeFileSync(tall, Buffer.from(made.tall));
  fs.writeFileSync(wide, Buffer.from(made.wide));

  await page.setInputFiles('#picker', [tall, wide]);
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#list li')];
    return rows.length === 2 && !rows.some(r => r.textContent.includes('讀取中'));
  }, null, { timeout: 60000 });
  await page.waitForSelector('#stage.has:not(.busy)');

  // ------------------------------------------------------------------
  console.log('\n[1] 預設與切換');
  const coverOut = await grab(page);
  check('完整顯示預設關閉',
    !await isOn(chip(page, 0, 'fit')) && !await isOn(chip(page, 1, 'fit')));
  check('一鍵列計數 0/2', await bulkCount(page, 'fit') === '0/2張', await bulkCount(page, 'fit'));
  check('一鍵列為關閉', await bulkState(page, 'fit') === 'false');

  await chip(page, 0, 'fit').click();
  await page.waitForTimeout(150);
  check('逐張晶片可以單獨切換',
    await isOn(chip(page, 0, 'fit')) && !await isOn(chip(page, 1, 'fit')));
  check('混合時一鍵列為 mixed', await bulkState(page, 'fit') === 'mixed');
  check('逐張切換不動到套框', await isOn(chip(page, 0, 'frame')));

  await page.click('#bulk-fit');
  await page.waitForTimeout(150);
  check('一鍵全部開啟', await bulkCount(page, 'fit') === '2/2張');

  // ------------------------------------------------------------------
  console.log('\n[2] 輸出：完整顯示、空白處留白');
  const fitOut = await grab(page);
  const byName = (list, stem) => list.find(e => e.name.includes(stem)).bytes;
  const T = byName(fitOut, 'fit-tall'), W = byName(fitOut, 'fit-wide');
  fs.writeFileSync(path.join(OUT_DIR, 'fit-tall-out.jpg'), T);
  fs.writeFileSync(path.join(OUT_DIR, 'fit-wide-out.jpg'), W);

  // 直圖 600×1200 → 縮成 500×1000，左右各留 250px。取樣點避開外框四周 20px
  // 的邊條與兩個角落的標誌
  const [tl, tr, tc, tTop, tBot] = await pixels(page, T, [[120, 600], [880, 600], [500, 600], [650, 40], [300, 960]]);
  check('直圖左側留白', near(tl, WHITE), tl.join(','));
  check('直圖右側留白', near(tr, WHITE), tr.join(','));
  check('直圖中間是照片', near(tc, RED), tc.join(','));
  check('直圖頂端藍邊完整出現（cover 會裁掉）', near(tTop, BLUE), tTop.join(','));
  check('直圖底端藍邊完整出現', near(tBot, BLUE), tBot.join(','));

  // 橫圖 1200×600 → 縮成 1000×500，上下各留 250px
  const [wt, wb, wc, wL, wR] = await pixels(page, W, [[500, 120], [500, 880], [500, 500], [40, 500], [960, 500]]);
  check('橫圖上方留白', near(wt, WHITE), wt.join(','));
  check('橫圖下方留白', near(wb, WHITE), wb.join(','));
  check('橫圖中間是照片', near(wc, RED), wc.join(','));
  check('橫圖左端藍邊完整出現', near(wL, BLUE), wL.join(','));
  check('橫圖右端藍邊完整出現', near(wR, BLUE), wR.join(','));

  const [cTop] = await pixels(page, byName(coverOut, 'fit-tall'), [[650, 40]]);
  check('對照：關閉時直圖頂端被裁掉（是紅不是藍）', near(cTop, RED), cTop.join(','));

  // ------------------------------------------------------------------
  console.log('\n[3] 預覽就是輸出');
  await page.locator('#list li').nth(0).click();
  await page.waitForTimeout(300);
  const box = await page.locator('#stage').boundingBox();
  check('預覽是正方形', Math.abs(box.width - box.height) < 2, `${box.width}×${box.height}`);
  const shot = await page.screenshot({ clip: box });
  const diff = await page.evaluate(async ([a, b]) => {
    const draw = async src => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 200;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, 200, 200);
      return x.getImageData(0, 0, 200, 200).data;
    };
    const [p, q] = [await draw(a), await draw(b)];
    let s = 0, n = 0;
    for (let i = 0; i < p.length; i += 4) {
      s += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
      n += 3;
    }
    return s / n;
  }, [`data:image/png;base64,${shot.toString('base64')}`, `data:image/jpeg;base64,${T.toString('base64')}`]);
  check('預覽與輸出平均逐通道差 < 12', diff < 12, diff.toFixed(2) + ' / 255');

  // ------------------------------------------------------------------
  console.log('\n[4] 關掉之後回到原本的輸出');
  await page.click('#bulk-fit');            // 全開 → 全關
  await page.waitForTimeout(150);
  check('一鍵全部關閉', await bulkCount(page, 'fit') === '0/2張');
  const backOut = await grab(page);
  check('直圖輸出與從沒開過逐位元相同',
    sha(byName(backOut, 'fit-tall')) === sha(byName(coverOut, 'fit-tall')));
  check('橫圖輸出與從沒開過逐位元相同',
    sha(byName(backOut, 'fit-wide')) === sha(byName(coverOut, 'fit-wide')));

  // ------------------------------------------------------------------
  console.log('\n[5] 沒套框時：補成正方形、透明 PNG');
  await chip(page, 0, 'frame').click();       // 直圖套框關
  await chip(page, 0, 'fit').click();         // 完整顯示開
  await page.waitForTimeout(200);
  const row0 = await page.locator('#list li').nth(0).innerText();
  check('檔名改成 .png', row0.includes('fit-tall-money-sorry.png'), row0.replace(/\n/g, ' · '));
  check('不再標示原圖原樣', !row0.includes('原圖原樣'));
  await page.locator('#list li').nth(0).click();
  await page.waitForTimeout(300);
  const sbox = await page.locator('#stage').boundingBox();
  check('預覽是正方形', Math.abs(sbox.width - sbox.height) < 2, `${sbox.width}×${sbox.height}`);
  check('預覽透出棋盤格', await page.locator('#stage').evaluate(e => e.classList.contains('clear')));
  const P = (await grab(page)).find(e => e.name.includes('fit-tall'));
  fs.writeFileSync(path.join(OUT_DIR, 'fit-tall-noframe.png'), P.bytes);
  check('輸出是 PNG', P.name.endsWith('.png') && P.bytes.slice(1, 4).toString() === 'PNG', P.name);
  const info = await page.evaluate(async src => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const px = (a, b) => [...x.getImageData(a, b, 1, 1).data];
    return { w: c.width, h: c.height, left: px(100, 600), right: px(1100, 600), mid: px(600, 600), top: px(600, 20) };
  }, `data:image/png;base64,${P.bytes.toString('base64')}`);
  check('邊長＝長邊 1200、正方形', info.w === 1200 && info.h === 1200, `${info.w}×${info.h}`);
  check('左側透明', info.left[3] === 0, info.left.join(','));
  check('右側透明', info.right[3] === 0, info.right.join(','));
  check('中間是不透明的照片', info.mid[3] === 255 && near(info.mid.slice(0, 3), RED, 4), info.mid.join(','));
  check('頂端藍邊完整（沒有裁切）', near(info.top.slice(0, 3), BLUE, 4), info.top.join(','));
  await chip(page, 0, 'fit').click();         // 完整顯示關回去，套框維持關（[6] 會開回來）
  await page.waitForTimeout(150);

  // ------------------------------------------------------------------
  console.log('\n[5b] 套框時構圖可以縮小到不裁切、也躲得開外框');
  await page.locator('#list li').nth(1).click();   // 橫圖：套框開、完整顯示關
  await page.waitForSelector('#stage.has:not(.busy)');
  await page.waitForSelector('#zoombar.show');
  const zoomOutAll = async () => {
    for (let i = 0; i < 20 && !await page.locator('#zout').isDisabled(); i++) await page.click('#zout');
    return page.locator('#zlevel').innerText();
  };
  // 1200×600：cover 100% → contain 是 50%，下限再減半＝25%，照片 500×250 置中
  const zl = await zoomOutAll();
  check('裁切模式縮小下限＝contain 的一半（25%）', zl === '25%', zl);
  const Z = (await grab(page)).find(e => e.name.includes('fit-wide')).bytes;
  fs.writeFileSync(path.join(OUT_DIR, 'fit-wide-zoomout.jpg'), Z);
  const [zOut, zTop, zL, zR, zMid] = await pixels(page, Z, [[150, 500], [500, 300], [265, 500], [735, 500], [500, 500]]);
  check('照片外是白底（左）', near(zOut, WHITE), zOut.join(','));
  check('照片外是白底（上）', near(zTop, WHITE), zTop.join(','));
  check('左端藍邊完整出現', near(zL, BLUE), zL.join(','));
  check('右端藍邊完整出現', near(zR, BLUE), zR.join(','));
  check('照片置中', near(zMid, RED), zMid.join(','));
  check('標示為已手動調整', (await page.locator('#list li').nth(1).innerText()).includes('已手動調整'));

  // 完整顯示的 100% 就是 contain，也要能再縮一半
  await chip(page, 1, 'fit').click();
  await page.waitForTimeout(200);
  check('切到完整顯示回到 100%', await page.locator('#zlevel').innerText() === '100%');
  const zf = await zoomOutAll();
  check('完整顯示縮小下限 50%', zf === '50%', zf);
  await chip(page, 1, 'fit').click();         // 關回去（同時回到置中 100%）
  await page.waitForTimeout(150);

  // ------------------------------------------------------------------
  console.log('\n[6] 主體上下左右置中');
  // 1000×1000 白底，紅塊偏在左上（x 100–400、y 100–800）：留白不對稱，
  // 四邊各自去白後主體應該被放大並置中——300×700 → 429×1000，x 約 286–714
  const offBytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 1000;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 1000);
    x.fillStyle = 'rgb(220,40,40)'; x.fillRect(100, 100, 300, 700);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const off = path.join(OUT_DIR, 'fit-offset.png');
  fs.writeFileSync(off, Buffer.from(offBytes));
  await page.setInputFiles('#picker', [off]);
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#list li')];
    return rows.length === 3 && !rows.some(r => r.textContent.includes('讀取中'));
  }, null, { timeout: 60000 });
  await chip(page, 0, 'frame').click();       // 把 [5] 關掉的套框開回來
  await page.locator('#list li').nth(2).click();
  await page.waitForSelector('#stage.has:not(.busy)');
  await page.waitForSelector('#zoombar.show #zin:not([disabled])');
  await page.click('#zin');                   // 先在裁切模式手動放大
  await page.click('#zin');
  await page.waitForTimeout(150);
  const pre = await page.locator('#list li').nth(2).innerText();
  check('（前提）手動調整過', pre.includes('已手動調整'), pre.replace(/\n/g, ' · ') + ' · z=' + await page.locator('#zlevel').innerText());
  await chip(page, 2, 'fit').click();
  await page.waitForTimeout(200);
  check('開啟完整顯示後回到置中、不再標示手動調整',
    !(await page.locator('#list li').nth(2).innerText()).includes('已手動調整'));
  const O = byName(await grab(page), 'fit-offset');
  fs.writeFileSync(path.join(OUT_DIR, 'fit-offset-out.jpg'), O);
  const [oL, oLi, oRi, oR, oMid] = await pixels(page, O, [[255, 500], [320, 500], [680, 500], [745, 500], [500, 500]]);
  check('主體左緣外是白', near(oL, WHITE), oL.join(','));
  check('主體左緣內是紅', near(oLi, RED), oLi.join(','));
  check('主體右緣內是紅', near(oRi, RED), oRi.join(','));
  check('主體右緣外是白', near(oR, WHITE), oR.join(','));
  check('畫面中心落在主體上', near(oMid, RED), oMid.join(','));
  check('沒有 JS 例外', errors.length === 0, errors.join(' | '));

  await browser.close();
  server.close();
  console.log(`\n${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
};

run().catch(e => { console.error(e); process.exit(1); });
