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
  console.log('\n[6b] 一鍵全開與全關');
  {
    const { ctx, page } = await open(browser, 'studio.html');
    await loadInto(page, few);
    const onCount = w => page.locator(`#list li .chip.${w}.on`).count();
    const lit = () => page.locator('#bulk .seg button[data-state="lit"]').count();
    const countOf = id => page.locator('#' + id).innerText();

    check('套框預設就是全開', await onCount('frame') === 3);
    check('全開時「全開」那段點亮',
      await page.locator('#frame-on[data-state="lit"]').count() === 1);
    check('計數反映實際狀態', (await countOf('frame-count')).replace(/\s/g, '') === '3/3張',
      await countOf('frame-count'));

    // 已經在目標狀態時再按一次：什麼都不該變，也不該把按鈕停用
    await page.click('#frame-on');
    check('已在目標狀態時再按是無操作',
      await onCount('frame') === 3 && await page.locator('#frame-on').isEnabled());

    await page.click('#frame-off');
    check('一鍵全部關套框', await onCount('frame') === 0);
    check('全關時改成「全關」那段點亮',
      await page.locator('#frame-off[data-state="lit"]').count() === 1 &&
      await page.locator('#frame-on[data-state="lit"]').count() === 0);
    await page.click('#frame-on');
    check('一鍵全部開套框', await onCount('frame') === 3);

    // 混合態：逐張關掉一張，兩段都不該亮
    await chip(page, 1, 'frame').click();
    await page.waitForTimeout(150);
    check('混合態時兩段都不亮', await page.locator('#frame-on, #frame-off')
      .evaluateAll(bs => bs.filter(b => b.dataset.state === 'lit').length) === 0);
    check('混合態的計數正確', (await countOf('frame-count')).replace(/\s/g, '') === '2/3張',
      await countOf('frame-count'));
    check('計數的分子與晶片數量一致', await onCount('frame') === 2);
    await page.click('#frame-on');
    check('遮罩那一列不受套框一鍵影響', await lit() >= 1 && await onCount('censor') === 0);

    // 全關套框時所有項目都變成原圖原樣，序號的副檔名也要跟著換
    await page.click('#frame-off');
    check('全關套框後整欄標示原圖原樣',
      (await page.locator('#list li').allInnerTexts()).every(t => t.includes('原圖原樣')));
    await page.click('#frame-on');

    check('遮罩預設是全關', await onCount('censor') === 0);
    await page.click('#censor-on');
    check('一鍵全部開遮罩', await onCount('censor') === 3);

    // 先讓偵測整輪跑完。收尾的「偵測完成…」是一則新的狀態訊息，會依設計
    // 撤掉待復原的提議——所以復原必須在安靜的狀態下測，否則測到的是那個行為
    await waitModelReady(page);
    await waitDetect(page);

    const after = [];
    page.on('request', r => after.push(r.url()));

    await page.click('#censor-off');
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
    await page.click('#censor-off');
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
    await page.click('#censor-on');
    await waitModelReady(page);
    await waitDetect(page);

    const zeroRows = await page.locator('#list li').evaluateAll(
      ls => ls.filter(l => l.innerText.includes('未偵測')).length);
    const goText = await page.locator('#go').innerText();

    check('確實有一張零命中（測試前提）', zeroRows === 1, `${zeroRows} 張`);
    check('零命中的那張不算進「含遮罩」',
      /1 張含遮罩/.test(goText), goText);
    check('一鍵區常駐警示有出現',
      await page.locator('#nobox').isVisible() &&
      (await page.locator('#nobox').innerText()).includes('1 張'),
      await page.locator('#nobox').innerText());

    // 這句話不能被「輸出中 N / M…」蓋掉——下載前最後一眼就是要看到它
    await grabDownload(page);
    check('輸出流程跑完後警示仍在畫面上',
      await page.locator('#nobox').isVisible());
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
    await page.click('#censor-on');
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
  await browser.close();
  server.close();

  console.log(`\n${fail ? '有失敗' : '全部通過'}：${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch(err => {
  console.error(err);
  process.exit(1);
});
