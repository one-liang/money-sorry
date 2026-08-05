/**
 * studio.html（遮罩＋套框）的自動驗證。
 *
 *   node tools/verify/studio.mjs [測試圖資料夾]   （預設 test/）
 *
 * 腳本會自己起一個靜態 server，不需要另外跑 serve.cmd。
 *
 * 這一頁是 index.html 與 censor.html 的整合版，所以最有價值的檢查是
 * 「有沒有動到既有路徑」。兩個開關組出四格，其中三格有現成的基準可以
 * 釘到**逐位元**——而且因為那兩頁都還在現役，基準不必從 git tag 撈，
 * 直接跑它們就是：
 *
 *   套框開 · 遮罩關  →  必須與 index.html  的輸出 SHA-256 相同
 *   套框關 · 遮罩開  →  必須與 censor.html 的輸出 SHA-256 相同
 *   兩者皆關         →  ZIP 內的位元組必須與來源檔案相同
 *   兩者皆開         →  沒有基準，只能預覽↔輸出像素比對 ＋ 人眼
 *
 * 最後一格的「遮罩位置對不對」Playwright 驗不了，結果會存到 out/ 請人眼確認。
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
const PORT = 3113;

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
const short = h => h.slice(0, 12);

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

/** store-only ZIP 的最小讀取器；本專案不壓縮，讀 local header 就夠 */
function readZip(buf) {
  const out = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const flags = buf.readUInt16LE(i + 6);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    out.push({ name, bytes: buf.slice(start, start + size), utf8: !!(flags & 0x0800) });
    i = start + size;
  }
  return out;
}

const grabDownload = async page => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.click('#go'),
  ]);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
};

const open = async (browser, file, opts = {}) => {
  const ctx = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1400, height: 950 },
    ...opts,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/${file}`);
  return { ctx, page, errors };
};

const loadInto = async (page, files) => {
  await page.setInputFiles('#picker', files);
  await page.waitForSelector('#stage.has:not(.busy)', { timeout: 60000 });
  // 預覽在第一張量好時就出現，但量測是逐張的，一鍵區計數的分母會從 1 爬到 N。
  // 要等整批量完再往下驗，否則斷言會撞上中途的狀態
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#list li')];
    return rows.length > 0 && !rows.some(r => r.textContent.includes('讀取中'));
  }, null, { timeout: 60000 });
};

const chip = (page, i, which) => page.locator('#list li').nth(i).locator('.chip.' + which);
const pick = (page, i) => page.locator('#list li').nth(i).locator('.pick');
const bulkCount = (page, which) => page.locator('#' + which + '-count').innerText();
const bulkTg = (page, which) => page.locator('#bulk-' + which);
const bulkState = (page, which) => bulkTg(page, which).getAttribute('aria-checked');

/**
 * 一鍵 toggle 是三態的：全開 true、全關 false、混合 mixed。按下去一律「全開」，
 * 只有已經全開時才會變成「全關」——所以從混合走到「全關」要按兩次
 */
const setBulk = async (page, which, want) => {
  const target = want ? 'true' : 'false';
  for (let i = 0; i < 2 && await bulkState(page, which) !== target; i++) {
    await bulkTg(page, which).click();
    await page.waitForTimeout(150);
  }
};

/** 等偵測跑完；模型首次載入要抓 22MB，給寬一點 */
const waitDetect = page => page.waitForFunction(
  () => {
    const s = document.getElementById('status').textContent;
    const bar = document.getElementById('model-bar');
    return s.includes('偵測完成') || bar.classList.contains('fail');
  }, null, { timeout: 300000 });

const waitModelReady = page => page.waitForSelector('#model-bar.ready', { timeout: 300000 });

// ==========================================================================

const run = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = serve();
  const browser = await chromium.launch();

  const images = fs.readdirSync(IMG_DIR)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .sort()
    .map(f => path.join(IMG_DIR, f));

  if (!images.length) {
    console.log(`找不到測試圖：${IMG_DIR}`);
    process.exit(1);
  }
  console.log(`測試圖 ${images.length} 張（${path.relative(ROOT, IMG_DIR)}）`);

  const one = images[0];
  const few = images.slice(0, 3);

  // ------------------------------------------------------------------
  console.log('\n[1] file:// 防呆');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(ROOT, 'studio.html')).href);
    check('顯示「需要 server」的告示',
      await page.locator('#protocol-gate.show').isVisible());
    check('選檔區被停用',
      await page.locator('#drop.off').count() === 1);
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[2] 預設狀態與延遲載入');
  let frameOnlyOut, frameOnlyName;
  {
    const requested = [];
    const { ctx, page, errors } = await open(browser, 'studio.html');
    page.on('request', r => requested.push(r.url()));

    // 還沒選照片時，那幾塊都是空轉的控制項，不該擺在畫面上
    const shown = () => page.evaluate(() => ({
      naming: !!document.getElementById('naming').offsetParent,
      bulk:   !!document.getElementById('bulk').offsetParent,
      clear:  !!document.getElementById('clear').offsetParent,
      drop:   !!document.getElementById('drop').offsetParent,
    }));
    const before = await shown();
    check('空狀態只留選檔區',
      !before.naming && !before.bulk && !before.clear && before.drop,
      JSON.stringify(before));

    await loadInto(page, [one]);

    const after = await shown();
    check('選了照片後三塊都出現',
      after.naming && after.bulk && after.clear, JSON.stringify(after));

    check('套框預設開、遮罩預設關',
      await chip(page, 0, 'frame').evaluate(e => e.classList.contains('on')) === true &&
      await chip(page, 0, 'censor').evaluate(e => e.classList.contains('on')) === false);
    check('模型狀態列不出現',
      !await page.locator('#model-bar.show').count());
    check('沒有模式切換（只開套框）',
      !await page.locator('#modes.show').count());

    const got = await grabDownload(page);
    frameOnlyOut = got.bytes;
    frameOnlyName = got.name;

    const heavy = requested.filter(u => /\.onnx$|ort-wasm|ort\.wasm\.min\.js/.test(u));
    check('只套框的流程完全沒下載模型與 runtime', heavy.length === 0,
      heavy.length ? heavy.join(', ') : '0 個請求');
    // JAN 匯入相依兩個外部服務。沒用到匯入時一個請求都不該送出去——
    // 這條守的是 README 開頭那句「照片全程留在這台電腦」
    // blob:／data: 是頁面自己造的物件 URL，不是網路請求
    const outbound = requested.filter(u =>
      !/^(blob:|data:)/.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u));
    check('沒用匯入時不對任何外部服務發出請求', outbound.length === 0,
      outbound.length ? outbound.slice(0, 3).join(', ') : '0 個外部請求');
    check('沒有 JS 例外', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[3] 不變量一：套框開·遮罩關 ≡ index.html');
  {
    const { ctx, page } = await open(browser, 'index.html');
    await loadInto(page, [one]);
    const base = await grabDownload(page);
    await ctx.close();

    check('輸出與 index.html 逐位元相同',
      sha(base.bytes) === sha(frameOnlyOut),
      `${short(sha(base.bytes))} vs ${short(sha(frameOnlyOut))}`);
    check('未命名時沿用原檔名加後綴',
      frameOnlyName === path.basename(one).replace(/\.[^.]+$/, '') + '-money-sorry.jpg',
      frameOnlyName);
  }

  // ------------------------------------------------------------------
  console.log('\n[4] 不變量三：兩者皆關 ≡ 原始位元組');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, [one]);
    await chip(page, 0, 'frame').click();          // 套框關；遮罩本來就關

    check('標示為「原圖原樣」',
      (await page.locator('#list li').nth(0).innerText()).includes('原圖原樣'));

    const got = await grabDownload(page);
    check('輸出位元組與來源檔完全相同',
      sha(got.bytes) === sha(fs.readFileSync(one)),
      `${got.bytes.length} bytes`);
    check('副檔名跟隨原圖',
      path.extname(got.name).toLowerCase() === path.extname(one).toLowerCase(),
      got.name);
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[5] 輸出命名、資料夾與序號');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, few);
    await page.fill('#oname', '商品/A:主圖 ');
    await page.waitForTimeout(100);

    const row0 = await page.locator('#list li').nth(0).innerText();
    check('清單即時顯示套用命名後的檔名', row0.includes('商品A主圖-1.jpg'), row0.replace(/\n/g, ' · '));

    const got = await grabDownload(page);
    check('ZIP 檔名用了命名', got.name === '商品A主圖.zip', got.name);

    const entries = readZip(got.bytes);
    check('ZIP 開了一層資料夾',
      entries.every(e => e.name.startsWith('商品A主圖/')),
      entries.map(e => e.name).join(', '));
    // `/` 只准出現在資料夾分隔那一處，其餘保留字元一個都不能留下來
    check('消毒掉了非法字元，沒有多餘的路徑層級',
      entries.every(e => e.name.split('/').length === 2 && !/[\\:*?"<>|]/.test(e.name)),
      entries.map(e => e.name).join(', '));
    check('檔名帶命名前綴且依序編號',
      entries.map(e => e.name).join(',') ===
        '商品A主圖/商品A主圖-1.jpg,商品A主圖/商品A主圖-2.jpg,商品A主圖/商品A主圖-3.jpg',
      entries.map(e => e.name).join(', '));
    check('中文檔名設了 UTF-8 flag bit 11', entries.every(e => e.utf8));

    // 10 張以上要補零
    await page.setInputFiles('#picker', images.slice(0, Math.min(12, images.length)));
    await page.waitForFunction(
      n => document.querySelectorAll('#list li').length === n,
      3 + Math.min(12, images.length), { timeout: 60000 });
    await page.waitForTimeout(300);
    const ords = await page.locator('#list li .ord').allInnerTexts();
    check('總數 ≥10 時序號補零', ords[0] === '01' && ords[9] === '10', ords.slice(0, 3).join(', ') + ' …');
    check('每一列都看得到自己的順序', ords.length === 3 + Math.min(12, images.length));
    const row2 = await page.locator('#list li').nth(0).innerText();
    check('檔名序號同步補零', row2.includes('-01.jpg'), row2.replace(/\n/g, ' · '));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[6] 追加、清空與排序');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, few);

    // 動一下第 2 張的構圖，追加後必須還在
    await page.locator('#list li').nth(1).click();
    await page.waitForTimeout(200);
    await page.click('#zin');
    await page.waitForTimeout(150);
    const zoomed = await page.locator('#zlevel').innerText();
    const selBefore = await page.locator('#list li.sel .name').innerText();

    await page.setInputFiles('#picker', [images[3] || images[0]]);
    await page.waitForFunction(() => document.querySelectorAll('#list li').length === 4, null, { timeout: 60000 });

    check('再次選檔是追加而不是取代',
      await page.locator('#list li').count() === 4);
    check('追加後選取沒有被搶走',
      await page.locator('#list li.sel .name').innerText() === selBefore, selBefore);
    check('追加後既有的構圖調整還在',
      await page.locator('#zlevel').innerText() === zoomed, zoomed);

    // 重複檔案要標示但不擋
    await page.setInputFiles('#picker', [images[0]]);
    await page.waitForFunction(() => document.querySelectorAll('#list li').length === 5, null, { timeout: 60000 });
    check('重複檔案被標示且沒有被移除',
      (await page.locator('#list li').nth(4).innerText()).includes('重複') &&
      await page.locator('#list li').count() === 5);

    // 拖曳排序
    const names = () => page.locator('#list li .name').allInnerTexts();
    const before = await names();
    const grip = page.locator('#list li').nth(4).locator('.grip');
    const gb = await grip.boundingBox();
    const tb = await page.locator('#list li').nth(0).boundingBox();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + 4, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await names();
    check('拖曳把手可以排序', after[0] === before[4], `${before[4]} → 第 ${after.indexOf(before[4]) + 1} 位`);
    check('排序後選取仍是同一張',
      await page.locator('#list li.sel .name').innerText() === selBefore, selBefore);

    // 拖完不能有殘留：曾經因為 pointer capture 在節點被搬走時失效，endSort 沒跑到
    check('拖曳結束後沒有殘留的 dragging',
      await page.locator('#list li.dragging').count() === 0);
    check('拖曳結束後 sorting 狀態也解除',
      await page.locator('#list.sorting').count() === 0);
    check('選取狀態只有一列',
      await page.locator('#list li.sel').count() === 1);
    check('拖曳結束後沒有殘留的 transform',
      await page.evaluate(() => [...document.querySelectorAll('#list li')]
        .every(li => !li.style.transform)));
    check('序號在排序後重編且連續',
      (await page.locator('#list li .ord').allInnerTexts()).join(',') === '1,2,3,4,5',
      (await page.locator('#list li .ord').allInnerTexts()).join(','));

    // 鍵盤替代
    await page.locator('#list li').nth(0).locator('.grip').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const after2 = await names();
    check('把手聚焦時 ↑↓ 可移動', after2[1] === after[0], `${after[0]} → 第 2 位`);

    // 清空要兩段式確認，而且沒有逾時、一定要有退出路徑
    const clearText = await page.locator('#clear').innerText();
    check('清空按鈕顯示數量', /清空 \(5\)/.test(clearText), clearText);
    await page.click('#clear');
    await page.waitForTimeout(100);
    check('第一次按下只是進入確認狀態',
      (await page.locator('#clear').innerText()).includes('確定清空 5 張') &&
      await page.locator('#list li').count() === 5);
    check('確認狀態有取消按鈕', await page.locator('#clear-cancel').isVisible());

    // 曾經是 4 秒後自動解除，看不見的倒數會在使用者思考時靜默失效
    await page.waitForTimeout(5000);
    check('確認狀態不會自己逾時消失',
      (await page.locator('#clear').innerText()).includes('確定清空'),
      await page.locator('#clear').innerText());

    await page.click('#clear-cancel');
    await page.waitForTimeout(100);
    check('取消回到一般狀態且清單完好',
      /清空 \(5\)/.test(await page.locator('#clear').innerText()) &&
      !await page.locator('#clear-cancel').isVisible() &&
      await page.locator('#list li').count() === 5);

    await page.click('#clear');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check('Esc 也能取消',
      /清空 \(5\)/.test(await page.locator('#clear').innerText()) &&
      await page.locator('#list li').count() === 5);

    await page.click('#clear');
    await page.click('#clear');
    await page.waitForTimeout(300);
    check('再按一次才真的清空', await page.locator('#list li').count() === 0);
    check('清空後回到只有選檔區的空狀態',
      await page.evaluate(() => !document.getElementById('naming').offsetParent &&
                                !document.getElementById('bulk').offsetParent &&
                                !document.getElementById('clear').offsetParent));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[6b] 一鍵 toggle 的三態');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, few);
    const onCount = w => page.locator(`#list li .chip.${w}.on`).count();
    const countOf = id => page.locator('#' + id).innerText();

    check('套框預設就是全開', await onCount('frame') === 3);
    check('全開時 toggle 為開啟', await bulkState(page, 'frame') === 'true');
    check('計數反映實際狀態', (await countOf('frame-count')).replace(/\s/g, '') === '3/3張',
      await countOf('frame-count'));

    // 已全開時按下去＝全關。這是與分段按鈕最大的差別：每一次按下都真的改變了什麼
    await bulkTg(page, 'frame').click();
    await page.waitForTimeout(150);
    check('已全開時按下去改成全關', await onCount('frame') === 0);
    check('全關時 toggle 為關閉', await bulkState(page, 'frame') === 'false');
    await bulkTg(page, 'frame').click();
    await page.waitForTimeout(150);
    check('再按一次全部開回來', await onCount('frame') === 3);

    // 混合態：逐張關掉一張
    await chip(page, 1, 'frame').click();
    await page.waitForTimeout(150);
    check('混合態時 toggle 為 mixed', await bulkState(page, 'frame') === 'mixed',
      await bulkState(page, 'frame'));
    check('混合態的計數正確', (await countOf('frame-count')).replace(/\s/g, '') === '2/3張',
      await countOf('frame-count'));
    check('計數的分子與晶片數量一致', await onCount('frame') === 2);

    // 混合態按下去是「全開」而不是「全關」——沿用全選核取方塊的語意
    await bulkTg(page, 'frame').click();
    await page.waitForTimeout(150);
    check('混合態按下去是全開',
      await onCount('frame') === 3 && await bulkState(page, 'frame') === 'true');
    check('遮罩那一列不受套框一鍵影響',
      await bulkState(page, 'censor') === 'false' && await onCount('censor') === 0);

    // 全關套框時所有項目都變成原圖原樣，序號的副檔名也要跟著換
    await setBulk(page, 'frame', false);
    check('全關套框後整欄標示原圖原樣',
      (await page.locator('#list li').allInnerTexts()).every(t => t.includes('原圖原樣')));
    await setBulk(page, 'frame', true);

    check('遮罩預設是全關', await onCount('censor') === 0);
    await setBulk(page, 'censor', true);
    check('一鍵全部開遮罩', await onCount('censor') === 3);

    // 先讓偵測整輪跑完。收尾的「偵測完成…」是一則新的狀態訊息，會依設計
    // 撤掉待復原的提議——所以復原必須在安靜的狀態下測，否則測到的是那個行為
    await waitModelReady(page);
    await waitDetect(page);

    const after = [];
    page.on('request', r => after.push(r.url()));

    await setBulk(page, 'censor', false);
    check('一鍵全部關遮罩', await onCount('censor') === 0);
    const goText = await page.locator('#go').innerText();
    check('全關遮罩後輸出按鈕不再顯示含遮罩張數',
      !/含遮罩/.test(goText) && /打包下載/.test(goText), goText);

    // 復原：旗標寫回即可，已偵測的框都還在，不該再抓一次模型
    check('全關遮罩後出現復原', await page.locator('#undo').isVisible());
    await page.click('#undo');
    await page.waitForTimeout(300);
    check('復原把遮罩開關全部還原', await onCount('censor') === 3);
    check('復原沒有觸發第二輪偵測',
      after.filter(u => /\.onnx$|ort-wasm/.test(u)).length === 0,
      after.filter(u => /\.onnx$|ort-wasm/.test(u)).join(', ') || '0 個請求');
    check('復原後提示消失', !await page.locator('#undo').isVisible());

    // 其他操作要讓復原失效
    await setBulk(page, 'censor', false);
    check('再次全關又出現復原', await page.locator('#undo').isVisible());
    await chip(page, 0, 'frame').click();
    await page.waitForTimeout(150);
    check('逐張切換開關會撤掉復原', !await page.locator('#undo').isVisible());
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[6c] 「含遮罩」數的是效果不是意圖');
  {
    // 10005_0.jpg 是實測零命中的那張：開了遮罩但一個部位都沒抓到
    const zeroHit = images.find(f => /10005_0/.test(f));
    const pair = [zeroHit || images[3], images[0]].filter(Boolean);
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, pair);
    await setBulk(page, 'censor', true);
    await waitModelReady(page);
    await waitDetect(page);

    const zeroRows = await page.locator('#list li').evaluateAll(
      ls => ls.filter(l => l.innerText.includes('未偵測')).length);
    const goText = await page.locator('#go').innerText();

    check('確實有一張零命中（測試前提）', zeroRows === 1, `${zeroRows} 張`);
    check('零命中的那張不算進「含遮罩」',
      /1 張含遮罩/.test(goText), goText);
    // 零命中那張是 pair[0]，也就是預設選取的那張
    check('零命中的那張在預覽區出示警示',
      await page.locator('#alert').isVisible() &&
      (await page.locator('#alert').innerText()).includes('未偵測到任何部位'),
      await page.locator('#alert').innerText());

    // 這句話不能被「輸出中 N / M…」蓋掉——下載前最後一眼就是要看到它
    await grabDownload(page);
    check('輸出流程跑完後警示仍在畫面上',
      await page.locator('#alert').isVisible());
    check('該列也仍標著「未偵測」', await page.locator('#list li').evaluateAll(
      ls => ls.filter(l => l.innerText.includes('未偵測')).length) === 1);
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[7] 不變量二：套框關·遮罩開 ≡ censor.html');
  let censorOnlyOut;
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, [one]);
    await chip(page, 0, 'frame').click();      // 套框關
    await chip(page, 0, 'censor').click();     // 遮罩開 → 這時才開始載模型
    await page.waitForSelector('#model-bar.show', { timeout: 10000 });
    check('開了遮罩才出現模型狀態列',
      await page.locator('#model-bar.show').count() === 1);
    await waitModelReady(page);
    await waitDetect(page);
    censorOnlyOut = (await grabDownload(page)).bytes;
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, 'censor.html');
    await page.waitForSelector('#model-bar.ready', { timeout: 300000 });
    await page.setInputFiles('#picker', [one]);
    await page.waitForFunction(
      () => document.getElementById('status').textContent.includes('偵測完成'),
      null, { timeout: 300000 });
    const base = await grabDownload(page);
    await ctx.close();

    check('輸出與 censor.html 逐位元相同',
      sha(base.bytes) === sha(censorOnlyOut),
      `${short(sha(base.bytes))} vs ${short(sha(censorOnlyOut))}`);
  }

  // ------------------------------------------------------------------
  console.log('\n[8] 兩者皆開：雙模式、裁切範圍與所見即所得');
  {
    const { ctx, page, errors } = await open(browser, 'studio.html');
    await loadInto(page, few);
    await setBulk(page, 'censor', true);
    await waitModelReady(page);
    await waitDetect(page);

    check('一鍵全部遮罩把整欄打開',
      await page.locator('#list li .chip.censor.on').count() === 3);
    check('兩個都開時出現模式切換',
      await page.locator('#modes.show').count() === 1);
    check('預設進入「編輯遮罩」',
      await page.locator('#mode-censor[aria-pressed="true"]').count() === 1);
    check('編輯遮罩時標出會被裁掉的範圍',
      await page.locator('#stage.censoring.willcrop').count() === 1 &&
      await page.locator('#cropline').isVisible());

    const censorRatio = await page.evaluate(() => {
      const s = document.getElementById('stage').getBoundingClientRect();
      return s.width / s.height;
    });
    await page.click('#mode-frame');
    await page.waitForTimeout(200);
    const frameRatio = await page.evaluate(() => {
      const s = document.getElementById('stage').getBoundingClientRect();
      return s.width / s.height;
    });
    check('兩個模式的視野不同（構圖模式是正方形）',
      Math.abs(frameRatio - 1) < 0.02 && Math.abs(censorRatio - 1) > 0.02,
      `編輯 ${censorRatio.toFixed(3)} / 構圖 ${frameRatio.toFixed(3)}`);
    check('構圖模式才有縮放控制列',
      await page.locator('#zoombar.show').count() === 1);

    const goText = await page.locator('#go').innerText();
    check('輸出按鈕顯示含遮罩張數', /3 張含遮罩/.test(goText), goText);

    // 切模式不能弄丟框：框存的是原圖座標，構圖模式只是把它畫到裁切後的畫布上
    await page.click('#mode-censor');
    await page.waitForTimeout(150);
    const nBoxes = () => page.evaluate(() => {
      const t = document.getElementById('detail').textContent;
      const m = t.match(/(\d+) 個遮罩/);
      return m ? +m[1] : 0;
    });
    const boxesBefore = await nBoxes();
    // 在左上角畫一個框——那裡多半落在會被裁掉的範圍內
    const sb = await page.locator('#stage').boundingBox();
    await page.mouse.move(sb.x + 12, sb.y + 12);
    await page.mouse.down();
    await page.mouse.move(sb.x + 12 + sb.width * 0.16, sb.y + 12 + sb.height * 0.12, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const boxesAdded = await nBoxes();
    check('編輯遮罩模式可以拖曳新增框', boxesAdded === boxesBefore + 1,
      `${boxesBefore} → ${boxesAdded}`);

    await page.click('#mode-frame');
    await page.waitForTimeout(150);
    await page.click('#mode-censor');
    await page.waitForTimeout(150);
    check('來回切換模式不會弄丟框（含落在裁切範圍外的）',
      await nBoxes() === boxesAdded, String(await nBoxes()));

    await page.click('#mode-frame');
    await page.waitForTimeout(200);

    // 所見即所得：構圖模式的預覽截圖 vs 實際輸出
    const box = await page.locator('#stage').boundingBox();
    const shotBuf = await page.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    const got = await grabDownload(page);
    const entries = readZip(got.bytes);
    fs.writeFileSync(path.join(OUT_DIR, got.name), got.bytes);

    const first = entries[0].bytes;
    const diff = await page.evaluate(async ([a, b]) => {
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
    }, [
      `data:image/png;base64,${shotBuf.toString('base64')}`,
      `data:image/jpeg;base64,${first.toString('base64')}`,
    ]);
    check('預覽就是輸出（平均逐通道差 < 12）', diff < 12, diff.toFixed(2) + ' / 255');
    check('沒有 JS 例外', errors.length === 0, errors.join(' | '));

    console.log(`\n  輸出在 ${path.join(OUT_DIR, got.name)}`);
    console.log('  ⚠ 遮罩位置正確與否 Playwright 驗不了，請解開來人眼確認。');
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[9] 失敗的檔案不佔序號');
  {
    const bad = path.join(OUT_DIR, 'not-an-image.png');
    fs.writeFileSync(bad, Buffer.from('這不是圖片'));
    const { ctx, page } = await open(browser, 'studio.html');
    await page.setInputFiles('#picker', [images[0], bad, images[1]]);
    await page.waitForFunction(
      () => [...document.querySelectorAll('#list li')].filter(li => li.innerText.includes('.jpg')).length >= 2,
      null, { timeout: 60000 });
    await page.fill('#oname', '順序');
    await page.waitForTimeout(200);

    const got = await grabDownload(page);
    const entries = readZip(got.bytes);
    check('壞檔不進 ZIP 且序號連號',
      entries.map(e => e.name).join(',') === '順序/順序-1.jpg,順序/順序-2.jpg',
      entries.map(e => e.name).join(', '));
    fs.unlinkSync(bad);
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[10] 模型載入失敗不能看起來像「沒偵測到」');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await page.route('**/320n.onnx', r => r.abort());     // 讓模型抓不到
    await loadInto(page, [one]);
    await chip(page, 0, 'censor').click();
    await page.waitForSelector('#model-bar.fail', { timeout: 120000 });

    const msg = await page.locator('#model-msg').innerText();
    check('明講載入失敗', msg.includes('模型載入失敗'), msg);
    check('沒有表現成「未偵測到任何部位」',
      !(await page.locator('#detail').innerText()).includes('未偵測'));
    check('所有遮罩開關退回關閉',
      await page.locator('#list li .chip.censor.on').count() === 0);
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[11] 逐張選取要不要下載');
  {
    const { ctx, page, errors } = await open(browser, 'studio.html');
    await loadInto(page, images.slice(0, 3));

    check('預設全部勾選', await page.locator('#list li .pick.on').count() === 3);
    check('下載計數為 3 / 3', (await bulkCount(page, 'pick')).replace(/\s/g, '') === '3/3張',
      await bulkCount(page, 'pick'));

    // 取消第 2 張
    await pick(page, 1).click();
    await page.waitForTimeout(150);

    check('取消後該列標記為 off', await page.locator('#list li.off').count() === 1);
    check('取消的那列序號變成「–」',
      (await page.locator('#list li').nth(1).locator('.ord').innerText()).trim() === '–');
    check('取消的那列有「不下載」標示',
      (await page.locator('#list li').nth(1).innerText()).includes('不下載'));
    check('下載計數變 2 / 3', (await bulkCount(page, 'pick')).replace(/\s/g, '') === '2/3張',
      await bulkCount(page, 'pick'));

    // 一鍵區的分母固定：不跟著勾選縮
    check('套框分母不跟著縮（仍為 3）',
      (await bulkCount(page, 'frame')).replace(/\s/g, '') === '3/3張',
      await bulkCount(page, 'frame'));
    check('遮罩分母不跟著縮（仍為 3）',
      (await bulkCount(page, 'censor')).replace(/\s/g, '') === '0/3張',
      await bulkCount(page, 'censor'));

    check('下載按鈕只算勾選的',
      (await page.locator('#go').innerText()).includes('2 張'),
      await page.locator('#go').innerText());

    // 序號在剩下的兩張上連號重排
    await page.fill('#oname', '選取');
    await page.waitForTimeout(200);
    const got = await grabDownload(page);
    const entries = readZip(got.bytes);
    check('未勾選的不進 ZIP 且序號連號',
      entries.map(e => e.name).join(',') === '選取/選取-1.jpg,選取/選取-2.jpg',
      entries.map(e => e.name).join(', '));
    check('沒有 JS 例外', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[11b] 一鍵全選與全不選');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, images.slice(0, 3));

    await setBulk(page, 'pick', false);
    check('全不選：三列都變 off', await page.locator('#list li.off').count() === 3);
    check('全不選：toggle 呈現為關閉', await bulkState(page, 'pick') === 'false');
    check('全不選：計數為 0 / 3', (await bulkCount(page, 'pick')).replace(/\s/g, '') === '0/3張',
      await bulkCount(page, 'pick'));
    check('全不選：輸出按鈕停用', await page.locator('#go').isDisabled());
    check('全不選：文案是「未勾選」而非「沒有可輸出」',
      (await page.locator('#go').innerText()).includes('未勾選'),
      await page.locator('#go').innerText());

    // 一鍵區作用域固定，所以這時仍然可以先把套框調好再勾回來
    check('全不選後套框分母仍為 3 / 3',
      (await bulkCount(page, 'frame')).replace(/\s/g, '') === '3/3張',
      await bulkCount(page, 'frame'));
    await setBulk(page, 'frame', false);
    check('全不選後「套框全關」仍然有作用',
      (await bulkCount(page, 'frame')).replace(/\s/g, '') === '0/3張',
      await bulkCount(page, 'frame'));

    await setBulk(page, 'pick', true);
    check('全選：回到 3 / 3', (await bulkCount(page, 'pick')).replace(/\s/g, '') === '3/3張',
      await bulkCount(page, 'pick'));
    check('全選：off 標記全部清除', await page.locator('#list li.off').count() === 0);
    check('全選：剛才調的套框狀態保留（仍為 0 / 3）',
      (await bulkCount(page, 'frame')).replace(/\s/g, '') === '0/3張',
      await bulkCount(page, 'frame'));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[11c] 追加檔案不得還原已取消的勾選');
  {
    // render() 會整欄重建 <li>，勾選狀態若只在建立時寫死就會被還原
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, images.slice(0, 2));
    await pick(page, 0).click();
    await page.waitForTimeout(150);
    check('取消第 1 張（前提）', await page.locator('#list li.off').count() === 1);

    await page.setInputFiles('#picker', images.slice(2, 4));
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#list li')];
      return rows.length === 4 && !rows.some(r => r.textContent.includes('讀取中'));
    }, null, { timeout: 60000 });

    check('追加後仍是 4 張', await page.locator('#list li').count() === 4);
    check('原本取消的那張仍然是取消的', await page.locator('#list li.off').count() === 1);
    check('取消的仍是第 1 列', await page.locator('#list li').nth(0).evaluate(el => el.classList.contains('off')));
    check('新加入的預設勾選', (await bulkCount(page, 'pick')).replace(/\s/g, '') === '3/4張',
      await bulkCount(page, 'pick'));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[11d] 取消再勾回來，遮罩不能不見');
  {
    // 偵測刻意不看勾選。若加了過濾，取消的那張 detect 會停在 idle，
    // 勾回來時沒有人重跑偵測 → censorOn 開著卻一個框都沒有 ＝ 輸出一張裸圖
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, [one]);
    await chip(page, 0, 'censor').click();
    await waitDetect(page);
    const boxesBefore = await page.locator('#detail').innerText();
    check('偵測完成且有遮罩（前提）', /\d+ 個遮罩/.test(boxesBefore), boxesBefore);

    await pick(page, 0).click();
    await page.waitForTimeout(150);
    check('取消後預覽的照片整張淡化',
      await page.locator('#stage.unpicked').count() === 1);
    check('取消後照片上掛著「不下載」',
      await page.locator('#offtag').isVisible() &&
      (await page.locator('#offtag').innerText()).includes('不下載'));
    check('取消後不再顯示遮罩統計',
      (await page.locator('#detail').innerText()).trim() === '',
      await page.locator('#detail').innerText());

    await pick(page, 0).click();
    await page.waitForTimeout(300);
    check('勾回來後遮罩框還在',
      (await page.locator('#detail').innerText()) === boxesBefore,
      await page.locator('#detail').innerText());
    check('勾回來後淡化與標示都撤掉',
      await page.locator('#stage.unpicked').count() === 0 &&
      !(await page.locator('#offtag').isVisible()));
    check('勾回來後輸出按鈕仍標示含遮罩',
      (await page.locator('#go').innerText()).includes('含遮罩'),
      await page.locator('#go').innerText());
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[11e] 一鍵動作會撤掉待復原的提議');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, images.slice(0, 2));
    await setBulk(page, 'censor', true);
    await waitDetect(page);
    await setBulk(page, 'censor', false);
    check('關掉「全部遮罩」出現復原（前提）', await page.locator('#undo').isVisible());

    await setBulk(page, 'pick', false);
    check('關掉「全部下載」撤掉復原提議', !(await page.locator('#undo').isVisible()));
    check('關掉「全部下載」自己不提供復原', !(await page.locator('#undo').isVisible()));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[11f] 常駐說明與警示條都已移出面板');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    for (const id of ['imp-note', 'exp-note', 'note-censor', 'note-frame', 'nobox', 'pbar'])
      check(`#${id} 不存在`, await page.locator('#' + id).count() === 0);
    // details 是收合的，innerText 只拿得到 summary，要用 textContent
    const notes = await page.locator('details.notes').textContent();
    check('隱私聲明搬到使用說明', notes.includes('你自己的照片不會被送出'));
    check('商品說明的去向寫進使用說明', notes.includes('複製全部'));
    check('使用說明不再提到已移除的 .txt', !notes.includes('.txt'));
    check('勾選功能寫進使用說明', notes.includes('核取方塊'));
    check('編輯遮罩的操作說明搬到使用說明', notes.includes('在圖上'));
    check('調整構圖的操作說明搬到使用說明', notes.includes('外框固定不動'));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[12] 版面與細節');
  {
    const { ctx, page, errors } = await open(browser, 'studio.html');

    // 縮放列浮在照片上，不再跟檔名搶同一行
    check('#zoombar 是 #stage 的後代',
      await page.locator('#stage #zoombar').count() === 1);
    check('#pname 是 figure 的圖說',
      await page.locator('#fig > figcaption#pname').count() === 1);

    await loadInto(page, images.slice(0, 2));

    // 前導欄：核取方塊 → 把手 → 序號
    const leadOrder = () => page.locator('#list li').nth(0).locator('.lead > *')
      .evaluateAll(els => els.map(e => e.classList[0]).join(','));
    check('前導欄的順序是 pick → grip → ord',
      await leadOrder() === 'pick,grip,ord', await leadOrder());
    check('把手與核取方塊同尺寸', await page.locator('#list li').nth(0).evaluate(li => {
      const a = li.querySelector('.pick').getBoundingClientRect();
      const b = li.querySelector('.grip').getBoundingClientRect();
      return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    }));
    check('晶片是純文字，沒有 icon',
      await page.locator('#list li .chip svg').count() === 0);

    // 套框模式的抓手看模式，不看可平移的餘裕
    check('套框模式下 #stage 帶著 framing',
      await page.locator('#stage.framing').count() === 1);

    // 清空要連同 JAN 一起
    await page.fill('#jan', '4570232591424');
    await page.click('#clear');
    await page.click('#clear');
    await page.waitForTimeout(300);
    check('清空後 JAN 欄位也空了',
      await page.locator('#jan').inputValue() === '',
      await page.locator('#jan').inputValue());

    check('匯入與「用這個命名」共用同一套按鈕樣式',
      await page.evaluate(() => {
        const a = document.getElementById('imp-go');
        const b = document.getElementById('use-name');
        return a.classList.contains('btn-amber') && b.classList.contains('btn-amber');
      }));
    check('沒有 JS 例外', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[13] 左欄分區與右欄整欄浮動');
  {
    const { ctx, page, errors } = await open(browser, 'studio.html');

    // 標題列可能還掛著按鈕（清空／取消），只取標題本身那一段
    const heads = () => page.locator('#main > .panel > h2')
      .evaluateAll(hs => hs.map(h =>
        (h.firstElementChild ? h.firstElementChild.textContent : h.textContent)
          .replace(/\s+/g, ' ').trim()));
    check('左欄是四張卡，標題依序正確',
      (await heads()).join(' | ') === '選擇照片 | 從 JANコード 匯入 amiami 商品 | 輸出設定 | 照片清單',
      (await heads()).join(' | '));
    check('.imphead 已經不存在', await page.locator('.imphead').count() === 0);

    // 歸屬：命名用的東西在輸出設定，清空跟著清單
    check('#imp-name 在「輸出設定」卡內且排在 #naming 之前',
      await page.evaluate(() => {
        const c = document.getElementById('card-output');
        const n = document.getElementById('imp-name');
        const o = document.getElementById('naming');
        return c.contains(n) && c.contains(o) &&
          (n.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      }));
    check('#clear 在「照片清單」卡內',
      await page.evaluate(() => document.getElementById('card-list')
        .contains(document.getElementById('clear'))));

    // 空狀態：只留兩個入口
    check('空狀態只有選檔與匯入兩張卡可見',
      await page.evaluate(() => {
        const on = id => !!document.getElementById(id).offsetParent;
        return !on('card-output') && !on('card-list') && on('drop') && on('jan');
      }));

    await loadInto(page, images.slice(0, 3));
    check('選了照片後四張卡都出現',
      await page.evaluate(() => {
        const on = id => !!document.getElementById(id).offsetParent;
        return on('card-output') && on('card-list') && on('drop') && on('jan');
      }));

    // 一鍵區：標籤與計數左右排，三列的計數靠左對齊
    check('.btxt 是左右排列',
      await page.evaluate(() =>
        getComputedStyle(document.querySelector('.btxt')).flexDirection === 'row'));
    check('三列的計數左緣對齊',
      await page.evaluate(() => {
        const xs = [...document.querySelectorAll('.btxt .count')]
          .map(e => Math.round(e.getBoundingClientRect().left));
        return xs.length === 3 && xs.every(x => x === xs[0]);
      }));
    check('.lead 的間距是 12px',
      await page.evaluate(() =>
        getComputedStyle(document.querySelector('.lead')).columnGap === '12px'),
      await page.evaluate(() => getComputedStyle(document.querySelector('.lead')).columnGap));

    check('沒有 JS 例外', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[13d] 匯入進度長在按鈕上，不推動版面');
  {
    // 進度真正的推進要跑完整的匯入（外部服務），這支測試一律離線，
    // 所以這裡驗的是結構與「不得位移」；推進本身靠人眼確認
    const { ctx, page, errors } = await open(browser, 'studio.html');
    await loadInto(page, images.slice(0, 2));   // 讓下面兩張卡出現，才量得到位移

    check('沒有獨立的進度條元素', await page.locator('#imp-prog').count() === 0);
    check('按鈕內有 spinner 與進度線',
      await page.locator('#imp-go .spin').count() === 1 &&
      await page.locator('#imp-go .ip').count() === 1);
    check('待機時按鈕不是忙碌狀態、進度線為零',
      await page.evaluate(() => {
        const b = document.getElementById('imp-go');
        const t = b.querySelector('.ip').style.transform;
        return !b.classList.contains('busy') && (t === '' || t === 'scaleX(0)');
      }));

    // 這一批的重點：忙碌狀態不得讓底下的東西移動一個像素
    const geom = () => page.evaluate(() => {
      const r = id => document.getElementById(id).getBoundingClientRect();
      return {
        btnW: +r('imp-go').width.toFixed(2),
        msg:  +r('imp-msg').top.toFixed(2),
        card: +r('card-output').top.toFixed(2),
        list: +r('card-list').top.toFixed(2),
      };
    });
    const idle = await geom();
    await page.evaluate(() => {
      const b = document.getElementById('imp-go');
      b.classList.add('busy');
      b.querySelector('.t').textContent = '匯入中';
      b.querySelector('.ip').style.transform = 'scaleX(0.5)';
    });
    await page.waitForTimeout(150);
    const busy = await geom();

    check('匯入中：按鈕寬度不變（min-width 有生效）',
      idle.btnW === busy.btnW, `${idle.btnW} vs ${busy.btnW}`);
    check('匯入中：訊息列不位移', idle.msg === busy.msg, `${idle.msg} vs ${busy.msg}`);
    check('匯入中：「輸出設定」卡不位移', idle.card === busy.card, `${idle.card} vs ${busy.card}`);
    check('匯入中：「照片清單」卡不位移', idle.list === busy.list, `${idle.list} vs ${busy.list}`);

    // 空白 JAN 是輸入錯誤，不是「匯入進行中」——按鈕不該進入忙碌狀態
    await page.reload();
    await page.click('#imp-go');
    await page.waitForTimeout(150);
    check('空白 JAN 只出文字，按鈕不進入忙碌',
      (await page.locator('#imp-msg').innerText()).includes('請先輸入') &&
      !(await page.evaluate(() => document.getElementById('imp-go').classList.contains('busy'))),
      await page.locator('#imp-msg').innerText());

    // 清空要把匯入區的痕跡一起收掉
    await loadInto(page, images.slice(0, 2));
    await page.click('#clear');
    await page.click('#clear');
    await page.waitForTimeout(300);
    check('清空後訊息清空、按鈕回到待機',
      (await page.locator('#imp-msg').textContent()) === '' &&
      !(await page.evaluate(() => document.getElementById('imp-go').classList.contains('busy'))));

    check('沒有 JS 例外', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[13e] 超長的輸出命名不得撐開版面');
  {
    // 兩個 grid 都吃過同一個虧：`1fr` 與隱含的 auto 軌道，下限都是內容的
    // min-content，而檔名籤是 nowrap 的。「用這個命名」帶進來的商品名常有
    // 40 字以上，所以這不是邊角案例
    const LONG = '錢錢抱歉限定販售版超長商品名稱測試用字串再加一點點更多的字讓它爆開來看看會怎樣';
    const { ctx, page, errors } = await open(browser, 'studio.html');
    await loadInto(page, images.slice(0, 2));

    const geom = () => page.evaluate(() => ({
      main: +document.getElementById('main').getBoundingClientRect().width.toFixed(1),
      li:   +document.querySelector('#list li').getBoundingClientRect().width.toFixed(1),
      over: document.documentElement.scrollWidth > window.innerWidth,
    }));

    const short = await geom();
    await page.fill('#oname', LONG);
    await page.waitForTimeout(300);
    const long = await geom();

    check('左欄寬度不隨命名長度改變',
      short.main === long.main, `${short.main} → ${long.main}`);
    check('清單列寬度不隨命名長度改變',
      short.li === long.li, `${short.li} → ${long.li}`);
    check('列沒有超出左欄', long.li < long.main, `列 ${long.li} vs 欄 ${long.main}`);
    check('頁面沒有橫向捲動', !long.over);
    check('檔名籤被截斷，完整值留在 title',
      await page.evaluate(() => {
        const b = document.querySelector('#list li .badge.file');
        return b.scrollWidth > b.clientWidth + 1 && b.title.length > 20;
      }));

    // 窄視窗（單欄）也要成立
    await page.setViewportSize({ width: 480, height: 800 });
    await page.waitForTimeout(300);
    const narrow = await geom();
    check('480px 下沒有橫向捲動', !narrow.over);
    check('480px 下列沒有超出左欄',
      narrow.li < narrow.main, `列 ${narrow.li} vs 欄 ${narrow.main}`);

    check('沒有 JS 例外', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[13b] 右欄兩張卡一起浮動，不互相遮蓋');
  {
    // 商品說明是預覽面板的靜態兄弟。sticky 若掛在預覽面板上，它會畫在
    // 商品說明之上——捲到底時後者整片被蓋掉
    const { ctx, page } = await open(browser, 'studio.html',
      { viewport: { width: 1280, height: 720 } });
    await loadInto(page, images.slice(0, 12));

    // 直接把商品說明面板填出來——這一段驗的是版面，不是匯入流程
    await page.evaluate(() => {
      const p = document.getElementById('expanel');
      p.hidden = false;
      document.getElementById('exp-body').innerHTML =
        '<div class="exp-item"><div class="exp-h">製品仕様</div>' +
        '<p class="exp-b">' + '塗装済み完成品<br>'.repeat(8) + '</p></div>';
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const boxes = await page.evaluate(() => {
      const r = el => { const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, h: b.height }; };
      return {
        prev: r(document.querySelector('#side > .panel')),
        exp:  r(document.getElementById('expanel')),
        vh:   window.innerHeight,
      };
    });
    check('捲到底時預覽面板仍在視野內',
      boxes.prev.bottom > 0 && boxes.prev.top < boxes.vh,
      `top ${boxes.prev.top.toFixed(0)} / bottom ${boxes.prev.bottom.toFixed(0)}`);
    check('商品說明沒有被預覽面板蓋住',
      boxes.exp.top >= boxes.prev.bottom - 1,
      `說明 top ${boxes.exp.top.toFixed(0)} vs 預覽 bottom ${boxes.prev.bottom.toFixed(0)}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n[13c] 商品說明的層級，以及頁面不再有導覽列');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    check('面板不放商品名稱標題', await page.locator('#exp-title').count() === 0);
    check('面板只剩「複製全部」這個動作',
      await page.locator('#expanel .exphead > *').count() === 1);
    check('段落標題不是靠字級跟內文區分',
      await page.evaluate(() => {
        // .exp-h 是藥丸標籤：有底色、有圓角
        const el = document.createElement('div');
        el.className = 'exp-h';
        document.getElementById('exp-body').append(el);
        const s = getComputedStyle(el);
        const ok = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(s.borderRadius) > 100;
        el.remove();
        return ok;
      }));
    check('面板不再有「商品說明」這個標題文字',
      !(await page.locator('#expanel').textContent()).includes('商品說明'));
    check('本頁沒有三頁互切的導覽列', await page.locator('nav.tabs').count() === 0);
    await ctx.close();
  }

  // ------------------------------------------------------------------
  await browser.close();
  server.close();

  console.log(`\n${fail ? '有失敗' : '全部通過'}：${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch(err => {
  console.error(err);
  process.exit(1);
});
