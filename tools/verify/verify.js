#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// censor.html 的回歸驗證工具
//
//   node tools/verify/verify.js                 跑驗證，與 baseline.json 比對
//   node tools/verify/verify.js --update        以本次結果覆寫 baseline
//   node tools/verify/verify.js --overlay       另外輸出疊圖到 tools/verify/out/
//
// 它用 headless Chrome 開啟實際的 censor.html，透過頁面上的 __censorTest 掛勾
// 跑同一條管線——測到的就是使用者實際會執行的東西，不是另一份 Node 複製品。
// 零 npm 相依：只用 Node 內建的 fetch / WebSocket 與系統上的 Chrome。
//
// 什麼時候要跑：改動 src/censor-core.js 的任何參數之後、換模型之後、
// 或是進了新商品線（design.md 風險表提到的「未驗證區域」）之後。
// ══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TEST_DIR = path.join(ROOT, 'test');
const PAGE = path.join(ROOT, 'censor.html');
const BASELINE = path.join(__dirname, 'baseline.json');
const OUT_DIR = path.join(__dirname, 'out');
const PORT = 9411;
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update');
const OVERLAY = argv.includes('--overlay');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const die = m => { console.error('✗ ' + m); process.exit(1); };

if (!fs.existsSync(PAGE)) die('找不到 censor.html，先跑 node build-censor.js');
if (!fs.existsSync(TEST_DIR)) die('找不到 test/（素材不進版控，需自行放置商品照）');
if (!fs.existsSync(CHROME)) die('找不到 Chrome，可用 CHROME_PATH 指定路徑');

const files = fs.readdirSync(TEST_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
if (!files.length) die('test/ 內沒有圖片');

// ── CDP ────────────────────────────────────────────────────────────────
async function connect() {
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--allow-file-access-from-files',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(require('os').tmpdir(), 'censor-verify-profile')}`,
    'file://' + PAGE,
  ], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.startsWith('file://'));
    } catch { /* Chrome 還沒起來 */ }
  }
  if (!page) { proc.kill(); die('無法連上 Chrome'); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (method, params) => new Promise(res => {
    const myId = ++id;
    const h = ev => { const m = JSON.parse(ev.data); if (m.id === myId) { ws.removeEventListener('message', h); res(m.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
  };
  return { proc, ws, evalJs };
}

// ── 比對 ───────────────────────────────────────────────────────────────
const TOL = 1.0;   // 像素容差：瀏覽器與基準之間的浮點差異

function diffRow(base, now) {
  if (!base) return ['NEW', '新增，基準中沒有這張'];
  if (base.grade !== now.grade) return ['GRADE', `分級 ${base.grade} → ${now.grade}`];
  if (base.reason !== now.reason) return ['REASON', `原因「${base.reason}」→「${now.reason}」`];
  if (base.ori !== now.ori) return ['ORI', `朝向 ${base.ori} → ${now.ori}`];
  if (base.mLeg !== now.mLeg) return ['MLEG', `M字腿 ${base.mLeg} → ${now.mLeg}`];
  if (base.masks.length !== now.masks.length) return ['COUNT', `遮罩數 ${base.masks.length} → ${now.masks.length}`];
  for (let i = 0; i < now.masks.length; i++) {
    for (const k of ['x0', 'y0', 'x1', 'y1']) {
      const d = Math.abs(base.masks[i][k] - now.masks[i][k]);
      if (d > TOL) return ['RECT', `遮罩 ${i} 的 ${k} 位移 ${d.toFixed(1)}px`];
    }
  }
  return null;
}

// ── 主流程 ─────────────────────────────────────────────────────────────
(async () => {
  const { proc, ws, evalJs } = await connect();
  try {
    for (let i = 0; i < 120; i++) {
      if (await evalJs('!!(window.__censorTest && window.__censorTest.ready())')) break;
      await sleep(500);
    }
    if (!await evalJs('window.__censorTest.ready()')) die('模型未在時限內就緒');

    const backend = await evalJs('window.__censorTest.backend()');
    console.log(`backend: ${backend}${backend === 'webgl' ? '' : '  ⚠ 非 webgl，速度與數值可能不同'}`);

    const results = [];
    if (OVERLAY) fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const f of files) {
      const b64 = fs.readFileSync(path.join(TEST_DIR, f)).toString('base64');
      const r = await evalJs(`window.__censorTest.run(${JSON.stringify(f)}, "${b64}")`);
      if (OVERLAY && r.overlay) {
        fs.writeFileSync(path.join(OUT_DIR, f.replace(/\.[^.]+$/, '') + '.jpg'),
          Buffer.from(r.overlay.split(',')[1], 'base64'));
      }
      const ms = r.ms; delete r.overlay; delete r.ms; r.__ms = ms;
      r.masks = r.masks.map(m => ({ x0: +m.x0.toFixed(2), y0: +m.y0.toFixed(2), x1: +m.x1.toFixed(2), y1: +m.y1.toFixed(2) }));
      results.push(r);
      process.stderr.write('.');
    }
    process.stderr.write('\n');

    const net = await evalJs('window.__censorTest.netCalls()');
    const times = results.map(r => r.__ms).sort((a, b) => a - b);
    results.forEach(r => delete r.__ms);
    const median = times[times.length >> 1];

    // ── 表 ──
    const pad = (s, n) => String(s).padEnd(n);
    console.log('\n' + '='.repeat(96));
    console.log(pad('檔名', 26) + pad('尺寸', 11) + pad('分級', 8) + pad('朝向', 6) + pad('模式', 7) + pad('M腿', 5) + '遮罩 / 原因');
    console.log('-'.repeat(96));
    for (const r of results) {
      console.log(
        pad(r.name.replace(/\.[^.]+$/, ''), 26) + pad(`${r.w}x${r.h}`, 11) +
        pad(r.grade, 8) +
        pad(r.ori === 'front' ? '正' : r.ori === 'back' ? '背' : r.ori === 'side' ? '側' : '-', 6) +
        pad(r.mode || '-', 7) + pad(r.mLeg ? 'YES' : '-', 5) +
        (r.grade === 'RED' ? r.reason : r.masks.length + ' 個'));
    }
    const n = g => results.filter(r => r.grade === g).length;
    const pct = v => `${v} (${(v / results.length * 100).toFixed(0)}%)`;
    console.log('-'.repeat(96));
    console.log(`合計 ${results.length} 張   🟢 ${pct(n('GREEN'))}   🟡 ${pct(n('YELLOW'))}   🔴 ${pct(n('RED'))}`);
    console.log(`推論耗時: 中位數 ${median.toFixed(0)} ms/張（最快 ${times[0].toFixed(0)} / 最慢 ${times[times.length-1].toFixed(0)}）` +
                `  → 100 張約 ${(median * 100 / 1000).toFixed(1)} 秒`);
    console.log(`網路呼叫次數: ${net.length}${net.length ? '  ⚠ ' + net.join('、') : '  ✓'}`);

    // ── 基準比對 ──
    if (UPDATE) {
      fs.writeFileSync(BASELINE, JSON.stringify({ results }, null, 1));
      console.log(`\n✓ 已寫入基準 ${path.relative(ROOT, BASELINE)}（${results.length} 張）`);
      return;
    }
    if (!fs.existsSync(BASELINE)) {
      console.log('\n⚠ 尚無基準檔。確認上表無誤後，用 --update 建立基準。');
      return;
    }

    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).results;
    const byName = Object.fromEntries(base.map(r => [r.name, r]));
    const diffs = [];
    for (const r of results) {
      const d = diffRow(byName[r.name], r);
      if (d) diffs.push([r.name, d[0], d[1]]);
    }
    const missing = base.filter(b => !results.some(r => r.name === b.name)).map(b => b.name);

    console.log('\n' + '='.repeat(96));
    if (!diffs.length && !missing.length) {
      console.log('✓ 與基準完全一致');
    } else {
      console.log(`✗ 與基準有 ${diffs.length + missing.length} 處差異：`);
      for (const [name, kind, msg] of diffs) console.log(`  [${kind}] ${name} — ${msg}`);
      for (const m of missing) console.log(`  [GONE] ${m} — 基準中有但這次沒跑到`);
      process.exitCode = 1;
    }
    if (net.length) process.exitCode = 1;
  } finally {
    ws.close(); proc.kill();
  }
})();
