#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// 輸出路徑的外部驗證：ZIP 結構、原檔位元組、成品尺寸
//
//   node tools/verify/verify-output.js
//
// 不自驗自己的 ZIP 實作——產出後交給系統 unzip -t 與 macOS ditto 檢查，
// raw/ 的內容則以 SHA-256 與來源檔逐位元組比對。
// ══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TEST_DIR = path.join(ROOT, 'test');
const PAGE = path.join(ROOT, 'censor.html');
const PORT = 9412;
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const die = m => { console.error('✗ ' + m); process.exit(1); };
let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

if (!fs.existsSync(PAGE)) die('找不到 censor.html，先跑 node build-censor.js');

// 取 4 張涵蓋不同長寬比的圖，外加一組同名檔測試序號規則
const picks = ['10006_0.jpg', 'FIGURE-206172_01.jpg', 'FIGURE-206175_01.jpg', 'FIGURE-013460_15.jpg']
  .filter(f => fs.existsSync(path.join(TEST_DIR, f)));
if (picks.length < 2) die('test/ 內找不到足夠的驗證素材');

(async () => {
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--allow-file-access-from-files',
    '--no-first-run', `--user-data-dir=${path.join(os.tmpdir(), 'censor-verify-out')}`,
    'file://' + PAGE,
  ], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.startsWith('file://'));
    } catch {}
  }
  if (!page) { proc.kill(); die('無法連上 Chrome'); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0;
  const evalJs = expr => new Promise((res, rej) => {
    const myId = ++id;
    const h = ev => {
      const m = JSON.parse(ev.data);
      if (m.id !== myId) return;
      ws.removeEventListener('message', h);
      if (m.result.exceptionDetails) rej(new Error(m.result.exceptionDetails.exception?.description));
      else res(m.result.result?.value);
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'censor-zip-'));
  try {
    for (let i = 0; i < 120; i++) {
      if (await evalJs('!!(window.__censorTest && window.__censorTest.ready())')) break;
      await sleep(500);
    }

    // 刻意重複第一張，驗證同名不互相覆蓋
    const inputs = [...picks, picks[0]].map(f => ({
      name: f, b64: fs.readFileSync(path.join(TEST_DIR, f)).toString('base64'),
    }));
    const r = await evalJs(`window.__censorTest.buildZip(${JSON.stringify(inputs)})`);

    const zipPath = path.join(tmp, 'out.zip');
    fs.writeFileSync(zipPath, Buffer.from(r.zip, 'base64'));
    console.log(`ZIP ${(fs.statSync(zipPath).size / 1048576).toFixed(2)} MB，${r.names.length} 筆\n`);

    console.log('ZIP 結構');
    let unzipOut = '';
    try { unzipOut = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' }); } catch (e) { unzipOut = String(e.stdout || e); }
    check(/No errors detected/.test(unzipOut), 'unzip -t', unzipOut.trim().split('\n').pop());

    const ex = path.join(tmp, 'x');
    try {
      execFileSync('ditto', ['-xk', zipPath, ex]);
      check(true, 'ditto -xk 解壓成功');
    } catch (e) { check(false, 'ditto -xk 解壓失敗', String(e.message)); }

    console.log('\n目錄與檔名');
    check(fs.existsSync(path.join(ex, 'masked')), 'masked/ 存在');
    check(fs.existsSync(path.join(ex, 'raw')), 'raw/ 存在');
    const maskedFiles = fs.readdirSync(path.join(ex, 'masked')).sort();
    const rawFiles = fs.readdirSync(path.join(ex, 'raw')).sort();
    check(maskedFiles.length === inputs.length, `masked/ 有 ${inputs.length} 個檔`, maskedFiles.join(', '));
    check(rawFiles.length === inputs.length, `raw/ 有 ${inputs.length} 個檔`, rawFiles.join(', '));
    // 去重後會變成 <來源>-masked-2.jpg，那是預期行為
    check(maskedFiles.every(f => /-masked(-\d+)?\.jpg$/.test(f)), 'masked/ 檔名皆為 <來源>-masked[-N].jpg');
    const dup = picks[0].replace(/\.[^.]+$/, '');
    check(rawFiles.some(f => f.includes(dup + '-2.')) || maskedFiles.some(f => f.includes(dup + '-masked-2')),
          '同名檔案自動加序號，未互相覆蓋');

    console.log('\n檔案時間戳');
    const zipList = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
    // Info-ZIP 的列表格式是 MM-DD-YYYY HH:MM
    const stamps = [...zipList.matchAll(/(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/g)]
      .map(m => new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]));
    check(stamps.length > 0, `ZIP 內含 ${stamps.length} 筆時間戳`);
    check(stamps.every(d => d.getFullYear() >= 2020), '沒有 1980-01-01 的預設值',
          stamps.length ? stamps[0].toLocaleString('sv') : '');
    const now = Date.now();
    check(stamps.every(d => Math.abs(now - d.getTime()) < 10 * 60 * 1000), '時間戳為當下時間（誤差 < 10 分鐘）');
    // 解出來的檔案在檔案系統上也要有正確的 mtime
    const anyFile = path.join(ex, 'raw', picks[0]);
    const mtime = fs.statSync(anyFile).mtime;
    check(mtime.getFullYear() >= 2020 && Math.abs(now - mtime.getTime()) < 10 * 60 * 1000,
          '解壓後檔案的 mtime 正確', mtime.toLocaleString('sv'));

    console.log('\nraw/ 為位元組層級原檔');
    const sha = b => crypto.createHash('sha256').update(b).digest('hex');
    for (const f of picks) {
      const src = fs.readFileSync(path.join(TEST_DIR, f));
      const got = fs.existsSync(path.join(ex, 'raw', f)) ? fs.readFileSync(path.join(ex, 'raw', f)) : null;
      check(got && sha(src) === sha(got), `${f} 雜湊一致`, got ? sha(src).slice(0, 16) + '…' : '缺檔');
    }

    console.log('\n已遮成品維持來源尺寸');
    for (const d of r.dims) {
      check(d.src.w === d.out.w && d.src.h === d.out.h,
            `${d.name.replace('masked/', '')}`, `${d.src.w}×${d.src.h} → ${d.out.w}×${d.out.h}`);
    }

    console.log('\n' + (failures ? `✗ ${failures} 項未通過` : '✓ 全部通過'));
    if (failures) process.exitCode = 1;
  } finally {
    ws.close(); proc.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
