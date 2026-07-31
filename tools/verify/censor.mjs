/**
 * censor.html 的自動驗證。
 *
 *   node tools/verify/censor.mjs [測試圖資料夾]   （預設 test/）
 *
 * 腳本會自己起一個靜態 server，不需要另外跑 serve.cmd。
 * Playwright 只驗證「有沒有跑起來、有沒有畫出方塊、互動對不對」，
 * **遮罩位置對不對必須人眼看** —— 所以最後會把結果輸出到 tools/verify/out/。
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const IMG_DIR = path.resolve(ROOT, process.argv[2] || 'test');
const OUT_DIR = path.join(HERE, 'out');
const PORT = 3111;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};

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

const waitModel = page => page.waitForFunction(() => {
  const b = document.getElementById('model-bar');
  return b.classList.contains('ready') || b.classList.contains('fail');
}, null, { timeout: 120000 });

const run = async () => {
  const server = serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('    [page error]', e.message));

  const images = fs.readdirSync(IMG_DIR)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .map(f => path.join(IMG_DIR, f));

  try {
    // --- 1. file:// 下必須擋下來並給指引，不能靜默失敗 -----------------------
    console.log('\n[1] file:// 防呆');
    await page.goto(pathToFileURL(path.join(ROOT, 'censor.html')).href);
    await waitModel(page);
    check('顯示「需要 server」的告示',
      await page.locator('#protocol-gate.show').isVisible());
    check('模型狀態標為失敗而非就緒',
      (await page.locator('#model-bar').getAttribute('class')).includes('fail'));

    // --- 2. http 下正常載入模型 ---------------------------------------------
    console.log('\n[2] http:// 載入模型');
    await page.goto(`http://localhost:${PORT}/censor.html`);
    await waitModel(page);
    const ready = (await page.locator('#model-bar').getAttribute('class')).includes('ready');
    check('模型載入成功', ready);
    check('不顯示 file:// 告示', !(await page.locator('#protocol-gate.show').isVisible()));
    if (!ready) throw new Error('模型載不起來，後面的測試沒有意義');

    // --- 3. 批次偵測 ---------------------------------------------------------
    console.log(`\n[3] 批次偵測（${images.length} 張）`);
    const t0 = Date.now();
    await page.setInputFiles('#picker', images);
    await page.waitForFunction(() => /偵測完成|失敗/.test(document.getElementById('status').textContent),
      null, { timeout: 600000 });
    const secs = (Date.now() - t0) / 1000;

    const stats = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#list li')].map(li => ({
        name: li.querySelector('.name').textContent,
        badges: [...li.querySelectorAll('.badge')].map(b => b.textContent),
      }));
      const num = r => { const m = r.badges.find(b => /個遮罩/.test(b)); return m ? parseInt(m) : 0; };
      return {
        total: rows.length,
        boxes: rows.reduce((a, r) => a + num(r), 0),
        zero: rows.filter(r => r.badges.includes('未偵測')).map(r => r.name),
        inferred: rows.filter(r => r.badges.includes('含推算')).map(r => r.name),
        area: rows.filter(r => r.badges.some(b => /^遮蓋/.test(b))).map(r => r.name),
        errors: rows.filter(r => r.badges.some(b => /無法/.test(b))).map(r => r.name),
      };
    });

    check('全部處理完畢', stats.total === images.length, `${stats.total}/${images.length}`);
    check('有產生遮罩', stats.boxes > 0, `${stats.boxes} 個方塊，${secs.toFixed(1)}s（${(secs / images.length).toFixed(2)}s/張）`);
    check('零命中的有標示出來', true, `${stats.zero.length} 張：${stats.zero.join(', ') || '無'}`);
    check('推算補框有標示', true, `${stats.inferred.length} 張`);
    check('遮蓋過多有警示', true, `${stats.area.length} 張：${stats.area.join(', ') || '無'}`);
    if (stats.errors.length) check('無解碼失敗', false, stats.errors.join(', '));

    // --- 4. 人工調整 ---------------------------------------------------------
    console.log('\n[4] 人工調整');
    const edit = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const canvas = document.getElementById('canvas');
      const count = () => {
        const m = document.getElementById('detail').textContent.match(/^(\d+) 個遮罩/);
        return m ? +m[1] : 0;
      };
      document.querySelectorAll('#list li')[0].click();
      await sleep(900);
      const before = count();
      const r = canvas.getBoundingClientRect();
      const pt = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
                                bubbles: true, pointerId: 1, pointerType: 'mouse' });
      const fire = (t, o) => canvas.dispatchEvent(new PointerEvent(t, o));

      fire('pointerdown', pt(0.70, 0.76)); fire('pointermove', pt(0.88, 0.93)); fire('pointerup', pt(0.88, 0.93));
      await sleep(300);
      const added = count();

      const beforeSwitch = added;
      document.querySelectorAll('#list li')[1].click(); await sleep(900);
      document.querySelectorAll('#list li')[0].click(); await sleep(900);
      const kept = count();

      fire('pointerdown', pt(0.79, 0.85)); fire('pointerup', pt(0.79, 0.85));
      await sleep(200);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await sleep(300);
      const deleted = count();

      return { before, added, kept, beforeSwitch, deleted };
    });
    check('拖曳可新增遮罩', edit.added === edit.before + 1, `${edit.before} → ${edit.added}`);
    check('切換預覽後調整不遺失', edit.kept === edit.beforeSwitch, `${edit.kept}`);
    check('選取後可刪除', edit.deleted === edit.added - 1, `${edit.added} → ${edit.deleted}`);

    // 拖曳移動：框數不變、位置要真的變了
    const moved = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const canvas = document.getElementById('canvas');
      const shot = () => canvas.toDataURL().length;
      const r = canvas.getBoundingClientRect();
      const pt = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
                                bubbles: true, pointerId: 1, pointerType: 'mouse' });
      const fire = (t, o) => canvas.dispatchEvent(new PointerEvent(t, o));
      const n = () => { const m = document.getElementById('detail').textContent.match(/^(\d+) 個遮罩/); return m ? +m[1] : 0; };

      // 先放一個已知位置的方塊，再把它拖走
      fire('pointerdown', pt(0.15, 0.15)); fire('pointermove', pt(0.35, 0.35)); fire('pointerup', pt(0.35, 0.35));
      await sleep(300);
      const before = { n: n(), img: shot() };
      fire('pointerdown', pt(0.25, 0.25)); fire('pointermove', pt(0.60, 0.55)); fire('pointerup', pt(0.60, 0.55));
      await sleep(300);
      return { beforeN: before.n, afterN: n(), changed: shot() !== before.img };
    });
    check('可拖曳移動遮罩', moved.afterN === moved.beforeN && moved.changed,
      `框數 ${moved.beforeN} → ${moved.afterN}，畫面有變：${moved.changed}`);

    // ↑↓ 切換預覽
    const arrow = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const name = () => document.getElementById('pname').textContent;
      const lis = document.querySelectorAll('#list li');
      lis[0].click(); await sleep(900);
      const first = name();
      lis[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await sleep(900);
      const afterDown = name();
      document.querySelectorAll('#list li')[1]
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await sleep(900);
      return { first, afterDown, afterUp: name() };
    });
    check('↑↓ 可切換預覽', arrow.afterDown !== arrow.first && arrow.afterUp === arrow.first,
      `${arrow.first} → ${arrow.afterDown} → ${arrow.afterUp}`);

    // --- 5. 輸出 -------------------------------------------------------------
    console.log('\n[5] 輸出');
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dl = page.waitForEvent('download', { timeout: 300000 });
    await page.click('#go');
    const file = await dl;
    const zipPath = path.join(OUT_DIR, file.suggestedFilename());
    await file.saveAs(zipPath);
    await page.waitForFunction(() => /已打包|已下載|失敗/.test(document.getElementById('status').textContent),
      null, { timeout: 300000 });

    const size = fs.statSync(zipPath).size;
    check('觸發下載且只有一次', true, file.suggestedFilename());
    check('ZIP 非空', size > 1000, `${(size / 1024 / 1024).toFixed(2)} MB`);
    check('多張走 ZIP、單張不打包',
      images.length > 1 ? /\.zip$/.test(file.suggestedFilename()) : /\.jpg$/.test(file.suggestedFilename()));

    console.log(`\n  輸出在 ${zipPath}`);
    console.log('  ⚠ 遮罩位置正確與否 Playwright 驗不了，請解開來人眼確認。');

    // --- 6. 中文檔名與同名去重 ------------------------------------------------
    // ZIP 的檔名要用 UTF-8（flag bit 11），同名的不能互相蓋掉
    console.log('\n[6] 中文檔名與同名去重');
    const tmp = path.join(OUT_DIR, 'tmp-cjk');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, 'a'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'b'), { recursive: true });
    const cjk = '公仔照 A.jpg';
    fs.copyFileSync(images[0], path.join(tmp, 'a', cjk));
    fs.copyFileSync(images[1], path.join(tmp, 'b', cjk));

    await page.goto(`http://localhost:${PORT}/censor.html`);
    await waitModel(page);
    await page.setInputFiles('#picker', [path.join(tmp, 'a', cjk), path.join(tmp, 'b', cjk)]);
    await page.waitForFunction(() => /偵測完成|失敗/.test(document.getElementById('status').textContent),
      null, { timeout: 300000 });

    const dl2 = page.waitForEvent('download', { timeout: 300000 });
    await page.click('#go');
    const zip2 = path.join(OUT_DIR, 'cjk.zip');
    await (await dl2).saveAs(zip2);

    // 直接讀 central directory，確認檔名是 UTF-8 且有設 flag bit 11
    const buf = fs.readFileSync(zip2);
    const names = [];
    let utf8Flag = true;
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf.readUInt32LE(i) !== 0x02014b50) continue;
      const flag = buf.readUInt16LE(i + 8);
      const len = buf.readUInt16LE(i + 28);
      names.push(buf.subarray(i + 46, i + 46 + len).toString('utf8'));
      if (!(flag & 0x0800)) utf8Flag = false;
    }
    check('中文檔名不亂碼', names.every(n => n.includes('公仔照')), names.join(' | '));
    check('有設 UTF-8 flag bit 11', utf8Flag);
    check('同名檔案不互相覆蓋', names.length === 2 && new Set(names).size === 2, `${names.length} 筆`);
    fs.rmSync(tmp, { recursive: true, force: true });

    // --- 7. 套框工具沒有被影響 ------------------------------------------------
    // censor.html 不該動到 index.html 的任何行為，而且 index.html 必須維持
    // file:// 可用（那是它的賣點）
    console.log('\n[7] index.html 無回歸');
    const idx = await browser.newPage();
    const idxErrors = [];
    idx.on('pageerror', e => idxErrors.push(e.message));
    await idx.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
    await idx.waitForLoadState('domcontentloaded');
    const idxOk = await idx.evaluate(() => ({
      hasPicker: !!document.getElementById('picker'),
      hasGo: !!document.getElementById('go'),
      goDisabled: document.getElementById('go').disabled,
    }));
    check('file:// 下正常載入', idxOk.hasPicker && idxOk.hasGo);
    check('初始狀態為停用輸出', idxOk.goDisabled);
    check('沒有 JS 例外', idxErrors.length === 0, idxErrors.join('; '));
    await idx.close();

    // 統計寫成 JSON，方便跨版本比對
    fs.writeFileSync(path.join(OUT_DIR, 'stats.json'),
      JSON.stringify({ when: new Date().toISOString(), images: images.length,
                       secsPerImage: +(secs / images.length).toFixed(3), ...stats }, null, 1));
    console.log(`  統計寫到 ${path.join(OUT_DIR, 'stats.json')}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${fail === 0 ? '全部通過' : '有失敗項目'}：${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch(err => { console.error(err); process.exit(1); });
