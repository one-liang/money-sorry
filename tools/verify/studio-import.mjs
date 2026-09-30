/**
 * studio.html 的 JAN 匯入 UI 驗證（多站備援、站別訊息、來源標示）。
 *
 *   node tools/verify/studio-import.mjs
 *
 * 不碰真實網路：r.jina.ai 與 images.weserv.nl 的請求全部以 Playwright 攔截，
 * 依 fixtures/ 的樣本回應；圖片是頁面內現畫的小 JPEG。所以這支不需要 test/ 測試圖，
 * 也不受 amiami 或代理當下是否可用的影響。
 *
 * lib 的解析規則由 amiami.mjs 驗；這裡驗的是「lib 回來的東西，畫面有沒有照規格講清楚」：
 * 哪一站、哪一步、查無與失敗分開、備援站的規格有標示、沒有直接打 amiami 的請求。
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FIX = path.join(HERE, 'fixtures');
const PORT = 3114;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg',
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT);

const fixture = n => fs.readFileSync(path.join(FIX, n), 'utf8');
const JAN = '4570000000001';
const S = {
  jp:  `https://www.amiami.jp/top/search/list?s_keywords=${JAN}`,
  eng: `https://www.amiami.com/eng/search/list/?s_keywords=${JAN}`,
  cn:  `https://www.amiami.com/cn/search/list/?s_keywords=${JAN}`,
};
const D = (gcode, site) => ({
  jp:  `https://www.amiami.jp/top/detail/detail?gcode=${gcode}`,
  eng: `https://www.amiami.com/eng/detail/?gcode=${gcode}`,
  cn:  `https://www.amiami.com/cn/detail/?gcode=${gcode}`,
})[site];

const browser = await chromium.launch();

// 一張真的解得開的小 JPEG：accept() 會量測它，假資料會變成「無法解碼」
const JPEG = await (async () => {
  const p = await browser.newPage();
  const b64 = await p.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 90;
    const g = c.getContext('2d');
    g.fillStyle = '#c86'; g.fillRect(0, 0, 120, 90);
    g.fillStyle = '#235'; g.fillRect(30, 20, 60, 50);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await p.close();
  return Buffer.from(b64, 'base64');
})();

/**
 * 開一個 studio，裝上路由表（目標網址 → 依序回應的陣列）並執行一次匯入。
 * 回傳：狀態列歷來出現過的所有文字、最終狀態、jina 請求清單、直接打 amiami 的請求。
 */
async function importWith(routes, { jan = JAN, until = 'done', onPicks = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const jinaCalls = [];
  const direct = [];
  const counts = {};

  page.on('request', r => {
    if (/^https?:\/\/(www\.|img\.)?amiami\.(jp|com)\//.test(r.url())) direct.push(r.url());
  });
  await page.route('https://r.jina.ai/**', route => {
    const target = route.request().url().replace('https://r.jina.ai/', '');
    jinaCalls.push(target);
    const list = routes[target];
    if (!list) return route.fulfill({ status: 422, contentType: 'application/json', body: fixture('jina-error.json') });
    const i = Math.min(counts[target] = (counts[target] || 0) + 1, list.length) - 1;
    return route.fulfill({
      status: list[i].status || 200,
      contentType: 'text/plain; charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: list[i].body,
    });
  });
  await page.route('https://images.weserv.nl/**', route => route.fulfill({
    status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: JPEG,
  }));

  await page.goto(`http://localhost:${PORT}/studio.html`);
  // 狀態列是一行會被覆寫的文字；中途的「改試…」只能靠觀察者收集
  await page.evaluate(() => {
    window.__msgs = [];
    const el = document.getElementById('imp-msg');
    new MutationObserver(() => window.__msgs.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.fill('#jan', jan);
  await page.click('#imp-go');
  // 匯入結束＝按鈕解除 disabled
  await page.waitForFunction(() => !document.getElementById('imp-go').disabled, null, { timeout: 60000 });
  // 多筆候選：交給呼叫端量版面、挑一筆，之後再等第二段匯入結束
  if (onPicks) {
    await onPicks(page);
    await page.waitForFunction(() => !document.getElementById('imp-go').disabled, null, { timeout: 60000 });
  }
  if (until === 'list') {
    await page.waitForFunction(() => document.querySelectorAll('#list li').length > 0, null, { timeout: 30000 });
  }

  const state = await page.evaluate(() => ({
    msgs: window.__msgs,
    msg: document.getElementById('imp-msg').textContent,
    cls: document.getElementById('imp-msg').className,
    rows: document.querySelectorAll('#list li').length,
    expHidden: document.getElementById('expanel').hidden,
    exp: document.getElementById('exp-body').innerText,
    src: [...document.querySelectorAll('#exp-body .exp-src')].map(e => e.textContent),
    nameHidden: document.getElementById('imp-name').hidden,
    name: document.querySelector('#imp-name .t') ? document.querySelector('#imp-name .t').textContent : '',
  }));
  await ctx.close();
  return { ...state, jinaCalls, direct };
}

const ok200 = f => [{ body: fixture(f) }];

console.log('\njp 正常');
{
  const r = await importWith({ [S.jp]: ok200('search-one.md'), [D('FIGURE-206235', 'jp')]: ok200('detail-full.md') },
                             { until: 'list' });
  check('匯入 4 張（主圖＋3 張圖庫）', r.rows === 4, `rows=${r.rows}`);
  check('狀態為完成且不帶來源註記', r.cls === 'done' && /已匯入 4 張/.test(r.msg) && !r.msg.includes('來源'), r.msg);
  check('進度顯示 amiami.jp', r.msgs.some(m => m.includes('（amiami.jp）')), r.msgs.join(' | '));
  check('內文面板顯示製品仕様', !r.expHidden && r.exp.includes('製品仕様') && r.exp.includes('【素材】PVC、ABS'), r.exp);
  check('jp 來源不加備援標示', r.src.length === 0, r.src.join());
  check('沒有任何 amiami.com 請求', !r.jinaCalls.some(u => u.includes('amiami.com')), r.jinaCalls.join(' '));
  check('沒有直接打 amiami 的請求', r.direct.length === 0, r.direct.join(' '));
  check('商品名可填入', !r.nameHidden && r.name.includes('測試商品'), r.name);
}

console.log('\njp 挑戰頁 → 英文站');
{
  const r = await importWith({
    [S.jp]: ok200('challenge.md'),
    [S.eng]: ok200('com-cn-search.md'),
    [D('FIG-MOE-5596-R', 'jp')]: ok200('challenge.md'),
    [D('FIG-MOE-5596-R', 'eng')]: ok200('com-eng-detail.md'),
  }, { until: 'list' });
  check('匯入成功', r.rows === 3, `rows=${r.rows}`);
  check('等待期間顯示站別與重試', r.msgs.some(m => m.includes('amiami.jp 驗證中')), r.msgs.join(' | '));
  check('換站時顯示「改試英文站」', r.msgs.some(m => m.includes('改試 amiami.com（英文站）')), r.msgs.join(' | '));
  check('商品頁仍先試 jp', r.jinaCalls.includes(D('FIG-MOE-5596-R', 'jp')), r.jinaCalls.join(' '));
  check('完成訊息註明來源站', r.msg.includes('來源：amiami.com（英文站）'), r.msg);
  check('內文面板標示來源與非日文原文', r.src.length === 1 && r.src[0].includes('英文站') && r.src[0].includes('非日文原文'), r.src.join());
  check('沒有直接打 amiami 的請求', r.direct.length === 0, r.direct.join(' '));
}

console.log('\n三站皆失敗');
{
  const r = await importWith({
    [S.jp]: ok200('challenge.md'),
    [S.eng]: ok200('com-syserror.md'),
    [S.cn]: ok200('com-shell.md'),
  });
  check('標示為錯誤', r.cls === 'err', r.cls);
  check('三個站名都出現', ['amiami.jp', '英文站', '中文站'].every(s => r.msg.includes(s)), r.msg);
  check('各站原因不同且都列出', r.msg.includes('Cloudflare') && r.msg.includes('系統錯誤') && r.msg.includes('外殼'), r.msg);
  check('MUST NOT 顯示為查無', !r.msg.includes('查無'), r.msg);
  check('清單維持原狀', r.rows === 0, `rows=${r.rows}`);
}

console.log('\njp 查無、com 取不到');
{
  const r = await importWith({
    [S.jp]: ok200('search-none.md'),
    [S.eng]: ok200('com-syserror.md'),
    [S.cn]: ok200('com-syserror.md'),
  });
  check('顯示查無', r.msg.startsWith(`查無 ${JAN} 的商品`), r.msg);
  check('同時說明哪些站未能確認', r.msg.includes('英文站') && r.msg.includes('中文站') && r.msg.includes('未能確認'), r.msg);
}

console.log('\n代理服務限流');
{
  const r = await importWith({ [S.jp]: [{ status: 429, body: '{"code":429}' }] });
  check('只發出 1 次請求，不換站', r.jinaCalls.length === 1, r.jinaCalls.join(' '));
  check('訊息指明是代理服務限流', r.msg.includes('r.jina.ai') && r.msg.includes('限流'), r.msg);
}

console.log('\n多筆候選的版面與挑選');
{
  // 這一段守的是一個真的發生過的 bug：候選按鈕叫 .pick，與清單列的核取方塊同名，
  // 被全域的 20×20 壓扁——名稱整個消失、縮圖疊成一直排、「取消」折成兩行
  let layout = null;
  const r = await importWith({
    [S.jp]: ok200('search-two-bonus.md'),
    [D('FIGURE-400002', 'jp')]: ok200('detail-full.md'),
  }, {
    until: 'list',
    onPicks: async page => {
      await page.waitForSelector('#imp-picks .cand');
      layout = await page.evaluate(() => {
        const box = document.getElementById('imp-picks').getBoundingClientRect();
        const cands = [...document.querySelectorAll('#imp-picks .cand')];
        const cancel = document.querySelector('#imp-picks .cand-cancel');
        return {
          msg: document.getElementById('imp-msg').textContent,
          boxW: box.width,
          cands: cands.map(c => {
            const r = c.getBoundingClientRect();
            const cn = c.querySelector('.cn');
            const img = c.querySelector('img').getBoundingClientRect();
            return {
              w: r.width, h: r.height,
              name: cn.textContent, nameW: cn.getBoundingClientRect().width,
              clipped: cn.scrollWidth > cn.clientWidth + 1,
              mark: c.querySelector('mark') ? c.querySelector('mark').textContent : '',
              meta: c.querySelector('.cm').textContent,
              go: !!c.querySelector('.go'),
              imgLeftOfName: img.right <= cn.getBoundingClientRect().left,
              label: c.getAttribute('aria-label'),
            };
          }),
          cancelH: cancel.getBoundingClientRect().height,
          cancelText: cancel.textContent,
        };
      });
      fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
      await page.locator('#import').screenshot({ path: path.join(HERE, 'out', 'import-picks.png') });
      await page.locator('#imp-picks .cand').nth(1).click();
    },
  });
  const [a, b] = layout.cands;
  check('列出 2 張候選卡', layout.cands.length === 2, String(layout.cands.length));
  check('候選卡撐滿整欄（不再被壓成 20px）',
        layout.cands.every(c => c.w >= layout.boxW - 1), layout.cands.map(c => Math.round(c.w)).join(',') + ' / ' + Math.round(layout.boxW));
  check('名稱有實際寬度且完整顯示、不被截斷',
        layout.cands.every(c => c.nameW > 150 && !c.clipped), layout.cands.map(c => Math.round(c.nameW)).join(','));
  check('縮圖在名稱左側（不是疊成一直排）', layout.cands.every(c => c.imgLeftOfName));
  check('只標出差異：限定特典那段', a.mark === '【あみあみ限定特典】' && b.mark === '', `${a.mark} | ${b.mark}`);
  check('名稱文字完整', a.name === '【あみあみ限定特典】測試手辦 1/7 完成品フィギュア', a.name);
  check('代碼與價格可見', a.meta.includes('FIGURE-400001') && a.meta.includes('¥42,470') && b.meta.includes('¥39,600'), `${a.meta} | ${b.meta}`);
  check('每張卡都說明可以匯入', layout.cands.every(c => c.go));
  check('無障礙名稱含代碼與價格', a.label.includes('FIGURE-400001') && a.label.includes('¥42,470'), a.label);
  check('取消為單行文字按鈕', layout.cancelH < 30, `h=${layout.cancelH} ${layout.cancelText}`);
  check('提示文字說明要點選', layout.msg.includes('點選'), layout.msg);
  check('點第二張匯入的是第二筆', r.jinaCalls.includes(D('FIGURE-400002', 'jp')) && !r.jinaCalls.includes(D('FIGURE-400001', 'jp')),
        r.jinaCalls.join(' '));
  check('匯入完成', r.rows === 4 && r.cls === 'done', `${r.rows} ${r.msg}`);
  console.log('  （截圖：tools/verify/out/import-picks.png）');
}

console.log('\n多筆候選：手機寬度');
{
  // 標記的那段【…】受禁則保護、不肯斷行，窄欄曾溢出 9px
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  const page = await ctx.newPage();
  await page.route('https://r.jina.ai/**', r => r.fulfill({
    status: 200, headers: { 'access-control-allow-origin': '*' }, body: fixture('search-two-bonus.md'),
  }));
  await page.route('https://images.weserv.nl/**', r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG }));
  await page.goto(`http://localhost:${PORT}/studio.html`);
  await page.fill('#jan', JAN);
  await page.click('#imp-go');
  await page.waitForSelector('#imp-picks .cand');
  const m = await page.evaluate(() => [...document.querySelectorAll('#imp-picks .cand')].map(c => {
    const cn = c.querySelector('.cn');
    return { over: cn.scrollWidth - cn.clientWidth, cardOver: c.scrollWidth - c.clientWidth };
  }));
  check('400px 寬：名稱與卡片都沒有溢出', m.every(x => x.over <= 1 && x.cardOver <= 1), JSON.stringify(m));
  await ctx.close();
}

console.log('\n商品名只有站名');
{
  const noTitle = 'Title: AmiAmi [Character & Hobby Shop]\n\nURL Source: https://www.amiami.jp/top/detail/detail?gcode=FIGURE-206235\n\n' +
                  'Markdown Content:\n![x](https://img.amiami.jp/images/product/main/263/FIGURE-206235.jpg)\n';
  const r = await importWith({ [S.jp]: ok200('search-one.md'), [D('FIGURE-206235', 'jp')]: [{ body: noTitle }] },
                             { until: 'list' });
  check('圖片照常匯入', r.rows === 1, `rows=${r.rows}`);
  check('不提供以站名填入命名', r.nameHidden === true, r.name);
}

await browser.close();
server.close();

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
