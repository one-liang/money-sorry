/**
 * lib/amiami.js 的驗證。
 *
 *   node tools/verify/amiami.mjs
 *
 * 兩部分，都不碰真實網路：
 *
 *   純函式   classify / parseSearch / parseProduct / parseSpec / cleanTitle，
 *            全部是 markdown 字串 → 資料。
 *   備援流程 searchByJan / loadProduct，以頁面內的假 fetch 模擬各站成敗，
 *            驗證換站順序、代理錯誤不換站、聚合錯誤逐站列出。
 *
 * 真實請求會被 Cloudflare 限流、會受代理服務的可用性影響，拿它當回歸測試等於
 * 把外部服務的狀態綁進自己的測試結果裡。
 *
 * 樣本是自撰的最小結構（tools/verify/fixtures/），刻意不收錄 amiami 的實際頁面
 * 內容——測的是「我們對這個結構的規則」，不是「別人的內容」。jp 的樣本依
 * jina 預設 markdown 的實測結構撰寫；com-* 之中標為「推定樣本」的，是 amiami.com
 * 取不到真實回應時依實頁結構推定的，檔頭各有註明。
 *
 * 用 Playwright 起一個空白頁載入 lib/amiami.js 即可，不需要 server。
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FIX = path.join(HERE, 'fixtures');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
        JSON.stringify(got) === JSON.stringify(want) ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const fixture = n => fs.readFileSync(path.join(FIX, n), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'lib/amiami.js'), 'utf8') });

/** 在瀏覽器裡跑指定的純函式；拋錯時回傳 { error, stage, site, kind } 以便斷言 */
const run = (fn, ...args) => page.evaluate(
  ([f, a]) => {
    try { return window.MS.amiami[f](...a); }
    catch (e) { return { error: e.message, stage: e.stage, site: e.site, kind: e.kind }; }
  },
  [fn, args]
);

console.log('\nparseSearch（jp）');
{
  const one = await run('parseSearch', fixture('search-one.md'));
  eq('單筆：只取搜尋結果，前後的推薦商品都不算', one.map(h => h.gcode), ['FIGURE-206235']);
  check('單筆：縮圖為 thumb300', one[0].thumb.includes('thumb300'), one[0].thumb);
  eq('單筆：名稱不含折扣與價格', one[0].name, '測試商品 完成品フィギュア');

  // 價格不丟：同名候選常常只有價格不同，它是使用者分辨的線索
  eq('單筆：價格與折扣另外保留', [one[0].price, one[0].off], ['42,470', '3']);

  const many = await run('parseSearch', fixture('search-many.md'));
  eq('多筆：去重後 3 筆', many.map(h => h.gcode), ['FIGURE-300001', 'FIGURE-300002', 'FIGURE-300003']);
  eq('名稱尾端的「Ver. 2」不是價格', many[2].name, '多筆商品 C Ver. 2');
  eq('沒有價格就是空字串，不是 2', many[2].price, '');
  eq('沒有折扣就是空字串', [many[1].price, many[1].off], ['12,800', '']);

  const two = await run('parseSearch', fixture('search-two-bonus.md'));
  eq('限定特典與一般版：兩筆都列出', two.map(h => [h.gcode, h.name, h.price]), [
    ['FIGURE-400001', '【あみあみ限定特典】測試手辦 1/7 完成品フィギュア', '42,470'],
    ['FIGURE-400002', '測試手辦 1/7 完成品フィギュア', '39,600'],
  ]);

  const none = await run('parseSearch', fixture('search-none.md'));
  eq('查無：回傳空陣列，rt_noresult 推薦不得被誤判為結果', none, []);

  const bad = await run('parseSearch', fixture('search-unparsed.md'));
  check('結構認不出來時拋錯，MUST NOT 回傳零筆',
        bad && bad.error && bad.kind === 'unparsed' && bad.site === 'jp', JSON.stringify(bad));
}

console.log('\nparseSearch：同商品的重複上架');
{
  // 同一件商品常有兩筆（新品／中古、現役／停售），名稱一模一樣。
  // amiami 自己的搜尋頁預設不列停售的那筆，我們也不該列。
  const a = await run('parseSearch', fixture('search-dup-stopped.md'));
  eq('排除販売停止中，只留現役那筆', a.map(h => h.gcode), ['FIGURE-192119']);
  eq('名稱不得混入折扣與價格', a[0].name, '測試商品 異色版');

  // 這一組與上一組的答案剛好相反——靠 `-R` 尾碼判斷一定會挑錯
  const b = await run('parseSearch', fixture('search-dup-preowned.md'));
  eq('該留的是帶 -R 的中古那筆', b.map(h => h.gcode), ['FIG-MOE-5596-R']);
  check('停售那筆即使有價格也照樣排除',
        !b.some(h => h.gcode === 'FIG-MOE-5596'), b.map(h => h.gcode).join(','));

  const c = await run('parseSearch', fixture('search-all-stopped.md'));
  eq('全部都停售時保留全部，MUST NOT 變成假的查無', c.map(h => h.gcode), ['FIGURE-999001']);
  check('停售狀態有帶出來', /販売停止/.test(c[0].status), c[0].status);
  eq('停售字樣不留在名稱裡', c[0].name, '全停售商品');
}

console.log('\nparseSearch（com，推定樣本）');
{
  const cn = await run('parseSearch', fixture('com-cn-search.md'), 'cn');
  eq('中文站：排除「订单已结束」，留二手那筆', cn.map(h => h.gcode), ['FIG-MOE-5596-R']);
  check('中文站：二手有被標記', cn[0].preowned === true);
  eq('中文站：名稱不含標籤與「日元」價格', cn[0].name, 'Test Figure 2011 ver. 1/8 Complete Figure Test Maker');
  eq('中文站：價格另外保留', cn[0].price, '11,980');
  check('中文站：縮圖在 img.amiami.com', cn[0].thumb.includes('img.amiami.com'), cn[0].thumb);

  const none = await run('parseSearch', fixture('com-eng-search-none.md'), 'eng');
  eq('英文站：有結果錨點但沒有商品＝查無', none, []);
}

console.log('\nparseProduct');
{
  const p = await run('parseProduct', fixture('detail-full.md'));
  eq('圖片：主圖第一，圖庫依序換成 review 大圖，重複去除，推薦區不收', p.imageUrls, [
    'https://img.amiami.jp/images/product/main/263/FIGURE-206235.jpg',
    'https://img.amiami.jp/images/product/review/263/FIGURE-206235_01.jpg',
    'https://img.amiami.jp/images/product/review/263/FIGURE-206235_02.jpg',
    'https://img.amiami.jp/images/product/review/263/FIGURE-206235_03.jpg',
  ]);
  check('圖片：不得混入 rthumb／bthumb／thumb300',
        !p.imageUrls.some(u => /rthumb|bthumb|thumb300/.test(u)), p.imageUrls.join(' '));
  eq('標題：取正文的 ## 標題（原本的 h1）', p.title, '測試商品 完成品フィギュア【2027年6月発売分】');

  const q = await run('parseProduct', fixture('detail-nohash.md'));
  eq('標題：沒有 ## 時退回檔頭 Title 並清站名後綴', q.title, '無標籤測試商品');
  eq('只有主圖時就是一張', q.imageUrls.length, 1);

  const e = await run('parseProduct', fixture('com-eng-detail.md'), 'eng');
  eq('英文站：標題去掉站名前綴', e.title, 'Test Figure 1/7 Complete Figure(Pre-order)');
  eq('英文站：img.amiami.com 的 main 與 review', e.imageUrls, [
    'https://img.amiami.com/images/product/main/263/FIGURE-206235.jpg',
    'https://img.amiami.com/images/product/review/263/FIGURE-206235_01.jpg',
    'https://img.amiami.com/images/product/review/263/FIGURE-206235_02.jpg',
  ]);

  const shellTitle = await run('cleanTitle', 'AmiAmi [Character & Hobby Shop]');
  eq('只有站名時清成空字串，不拿站名當商品名', shellTitle, '');
}

console.log('\nparseSpec（實際餵給頁面的只有規格那一段）');
{
  const s = await run('parseSpec', fixture('detail-full.md'));
  eq('只回一段', s.length, 1);
  eq('回的是製品仕様', s.map(x => x.heading), ['製品仕様']);
  check('解説不進來', !JSON.stringify(s).includes('原型制作') && !JSON.stringify(s).includes('行銷文案'), JSON.stringify(s));
  check('hashtag 不進來', !JSON.stringify(s).includes('#テスト'));
  const body = s[0].body;
  check('逐行呈現', body.split('\n').length >= 5, JSON.stringify(body));
  check('規格未黏成單行', !body.includes('(ノンスケール)【素材】'), JSON.stringify(body));
  check('首行正確', body.split('\n')[0] === '塗装済み完成品', JSON.stringify(body.split('\n')[0]));
  check('行尾空白（markdown 硬換行）已去除', !/[ 　]\n/.test(body), JSON.stringify(body));
  check('空行收斂為最多一個', !body.includes('\n\n\n'), JSON.stringify(body));
  check('保留段落間的空行', body.includes('ABS\n\n【セット内容一覧】'), JSON.stringify(body));

  const n = await run('parseSpec', fixture('detail-nohash.md'));
  eq('沒有 hashtag 與解説時止於頁尾推薦', n.map(x => x.body), ['項目一\n項目二']);

  eq('沒有製品仕様時回空陣列而非拋錯', await run('parseSpec', fixture('detail-noexplain.md')), []);

  const e = await run('parseSpec', fixture('com-eng-detail.md'), 'eng');
  eq('英文站：Specifications 一段，止於 Copyright', e, [{
    heading: 'Specifications',
    body: 'Pre-painted Complete Figure\nScale: 1/7\nSize: Approx. H280mm (including base)',
  }]);
  const c = await run('parseSpec', fixture('com-cn-detail.md'), 'cn');
  eq('中文站：商品式样', c.map(x => x.heading), ['商品式样']);
}

console.log('\n頁面分類');
{
  eq('標準的 Just a moment 挑戰頁', await run('classify', fixture('challenge.md')), 'challenge');
  eq('標題被換掉也認得（靠 challenge-platform 特徵）', await run('classify', fixture('challenge-notitle.md')), 'challenge');
  eq('amiami.com 系統錯誤頁', await run('classify', fixture('com-syserror.md')), 'sysError');
  eq('amiami.com SPA 外殼', await run('classify', fixture('com-shell.md')), 'shell');
  for (const f of ['search-one.md', 'search-many.md', 'search-none.md', 'search-dup-stopped.md',
                   'detail-full.md', 'detail-nohash.md', 'detail-noexplain.md',
                   'com-cn-search.md', 'com-eng-search-none.md', 'com-eng-detail.md', 'com-cn-detail.md']) {
    eq(`正常頁面不得被誤判：${f}`, await run('classify', fixture(f)), 'page');
  }
}

console.log('\n代理位址組裝');
{
  const urls = await page.evaluate(() => {
    const A = window.MS.amiami;
    return {
      weserv: A.weservUrl('https://img.amiami.jp/images/product/main/263/FIGURE-206235.jpg'),
      weservCom: A.weservUrl('https://img.amiami.com/images/product/main/263/FIGURE-206235.jpg'),
      jina: A.jinaUrl(A.detailUrl('X')),
      jp: A.searchUrl('4570232591424'),
      eng: A.searchUrl('4570232591424', 'eng'),
      cn: A.detailUrl('FIGURE-1', 'cn'),
      order: A.ORDER,
    };
  });
  check('weserv 剝掉 scheme 後編碼', urls.weserv.includes('img.amiami.jp%2Fimages'), urls.weserv);
  check('weserv 不重複帶 scheme', !urls.weserv.includes('https%3A%2F%2Fimg'), urls.weserv);
  check('weserv 同樣處理 img.amiami.com', urls.weservCom.includes('img.amiami.com%2Fimages'), urls.weservCom);
  check('jina 前綴正確', urls.jina.startsWith('https://r.jina.ai/https://www.amiami.jp/top/detail/detail?gcode=X'), urls.jina);
  check('jp 搜尋網址', urls.jp === 'https://www.amiami.jp/top/search/list?s_keywords=4570232591424', urls.jp);
  check('英文站搜尋網址', urls.eng === 'https://www.amiami.com/eng/search/list/?s_keywords=4570232591424', urls.eng);
  check('中文站商品頁網址', urls.cn === 'https://www.amiami.com/cn/detail/?gcode=FIGURE-1', urls.cn);
  eq('備援順序 jp → eng → cn', urls.order, ['jp', 'eng', 'cn']);
}

console.log('\n多站備援流程（假 fetch）');
{
  // 路由表：以目標網址為鍵，值為依序回應的陣列（最後一個重複使用）。
  // 沒登記的網址一律回 jina 的 422——測試若意外打到它就會在斷言裡現形
  const flow = (routes, call) => page.evaluate(async ([routes, call]) => {
    const A = window.MS.amiami;
    const calls = [];
    const counts = {};
    const realFetch = window.fetch;
    window.fetch = async url => {
      const target = String(url).replace('https://r.jina.ai/', '');
      calls.push(target);
      const list = routes[target];
      if (!list) return new Response('{"code":422}', { status: 422 });
      const i = Math.min(counts[target] = (counts[target] || 0) + 1, list.length) - 1;
      return new Response(list[i].body, { status: list[i].status || 200 });
    };
    const sites = [];
    const opts = { challengeWaits: [10], onSite: (s, st) => sites.push(s + ':' + st) };
    try {
      const r = call[0] === 'search' ? await A.searchByJan(call[1], opts) : await A.loadProduct(call[1], opts);
      return { ok: r, calls, sites };
    } catch (e) {
      return { err: { message: e.message, stage: e.stage, site: e.site, kind: e.kind, attempts: e.attempts }, calls, sites };
    } finally {
      window.fetch = realFetch;
    }
  }, [routes, call]);

  const JAN = '4570000000001';
  const S = site => ({ jp: `https://www.amiami.jp/top/search/list?s_keywords=${JAN}`,
                       eng: `https://www.amiami.com/eng/search/list/?s_keywords=${JAN}`,
                       cn: `https://www.amiami.com/cn/search/list/?s_keywords=${JAN}` })[site];
  const D = site => ({ jp: 'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-206235',
                       eng: 'https://www.amiami.com/eng/detail/?gcode=FIGURE-206235',
                       cn: 'https://www.amiami.com/cn/detail/?gcode=FIGURE-206235' })[site];
  const page200 = f => [{ body: fixture(f) }];

  // jp 正常：一個 amiami.com 請求都不該有
  let r = await flow({ [S('jp')]: page200('search-one.md') }, ['search', JAN]);
  eq('jp 成功：回傳 jp 的結果', r.ok && [r.ok.site, r.ok.hits.map(h => h.gcode)], ['jp', ['FIGURE-206235']]);
  check('jp 成功：不對 amiami.com 發出任何請求', !r.calls.some(u => u.includes('amiami.com')), r.calls.join(' '));

  // jp 挑戰頁（重抓一次仍是）→ 英文站成功
  r = await flow({
    [S('jp')]: page200('challenge.md'),
    [S('eng')]: [{ body: fixture('com-cn-search.md') }],
  }, ['search', JAN]);
  eq('jp 挑戰頁：重抓一次後換到英文站', r.calls, [S('jp'), S('jp'), S('eng')]);
  eq('換站有通知', r.sites, ['jp:search', 'eng:search']);
  check('結果標示為英文站', r.ok && r.ok.site === 'eng', JSON.stringify(r.ok && r.ok.site));
  eq('attempts 記下 jp 的挑戰頁', r.ok && r.ok.attempts.map(a => [a.site, a.kind]), [['jp', 'challenge']]);

  // 挑戰頁在重抓時通過：不換站
  r = await flow({ [S('jp')]: [{ body: fixture('challenge.md') }, { body: fixture('search-one.md') }] }, ['search', JAN]);
  check('挑戰頁重抓後通過：留在 jp', r.ok && r.ok.site === 'jp' && r.calls.length === 2, r.calls.join(' '));

  // 三站都明確查無 → 查無，不是失敗
  r = await flow({
    [S('jp')]: page200('search-none.md'),
    [S('eng')]: page200('com-eng-search-none.md'),
    [S('cn')]: page200('com-eng-search-none.md'),
  }, ['search', JAN]);
  check('三站都查無：回傳空結果而非拋錯', r.ok && r.ok.hits.length === 0 && !r.err, JSON.stringify(r.err || ''));

  // jp 查無、com 兩站系統錯誤 → 仍是查無（jp 明確說了），但 attempts 保留 com 的失敗
  r = await flow({
    [S('jp')]: page200('search-none.md'),
    [S('eng')]: page200('com-syserror.md'),
    [S('cn')]: page200('com-shell.md'),
  }, ['search', JAN]);
  check('jp 查無、com 失敗：顯示查無', r.ok && r.ok.hits.length === 0, JSON.stringify(r.err || ''));
  eq('attempts 逐站保留', r.ok && r.ok.attempts.map(a => a.kind || 'none'), ['none', 'sysError', 'shell']);

  // 三站都失敗 → 聚合錯誤逐站列出
  r = await flow({
    [S('jp')]: page200('challenge.md'),
    [S('eng')]: page200('com-syserror.md'),
    [S('cn')]: page200('com-shell.md'),
  }, ['search', JAN]);
  check('三站皆失敗：拋出聚合錯誤', r.err && r.err.site === 'all' && r.err.stage === 'search', JSON.stringify(r.err));
  eq('聚合錯誤有 3 筆，逐站', r.err && r.err.attempts.map(a => a.site), ['jp', 'eng', 'cn']);
  check('訊息含三個站名', r.err && ['amiami.jp', '英文站', '中文站'].every(s => r.err.message.includes(s)), r.err && r.err.message);
  check('訊息不是查無', r.err && !r.err.message.includes('查無'), r.err && r.err.message);

  // 代理限流：只發 1 次請求，不換站
  r = await flow({ [S('jp')]: [{ status: 429, body: '{"code":429}' }] }, ['search', JAN]);
  check('代理限流：停止並標示為代理錯誤', r.err && r.err.site === 'proxy', JSON.stringify(r.err));
  eq('代理限流：只發出 1 次請求', r.calls.length, 1);

  // 代理回報目標站抓取失敗（非限流的 4xx）：該站失敗，換站
  r = await flow({
    [S('jp')]: [{ status: 422, body: fixture('jina-error.json') }],
    [S('eng')]: page200('com-cn-search.md'),
  }, ['search', JAN]);
  check('代理回報該站抓不到（422）：換站', r.ok && r.ok.site === 'eng', JSON.stringify(r.err || r.ok.site));

  // 商品頁：永遠從 jp 開始
  r = await flow({ [D('jp')]: page200('detail-full.md') }, ['detail', 'FIGURE-206235']);
  eq('商品頁：jp 成功，只打 jp', r.calls, [D('jp')]);
  check('商品頁：規格為日文、site 為 jp',
        r.ok && r.ok.site === 'jp' && r.ok.lang === 'ja' && r.ok.explain[0].heading === '製品仕様');

  r = await flow({
    [D('jp')]: page200('challenge.md'),
    [D('eng')]: page200('com-eng-detail.md'),
  }, ['detail', 'FIGURE-206235']);
  check('商品頁：jp 挑戰頁 → 英文站', r.ok && r.ok.site === 'eng' && r.ok.lang === 'en', JSON.stringify(r.err || ''));
  eq('商品頁：圖片、名稱、規格同取自英文站',
     r.ok && [r.ok.imageUrls[0].includes('img.amiami.com'), r.ok.title, r.ok.explain[0].heading],
     [true, 'Test Figure 1/7 Complete Figure(Pre-order)', 'Specifications']);

  r = await flow({
    [D('jp')]: page200('com-shell.md'),   // 不可能出現在 jp，但驗證「沒有圖片」也會換站
    [D('eng')]: page200('com-syserror.md'),
    [D('cn')]: page200('com-cn-detail.md'),
  }, ['detail', 'FIGURE-206235']);
  check('商品頁：一路退到中文站', r.ok && r.ok.site === 'cn', JSON.stringify(r.err || ''));

  r = await flow({
    [D('jp')]: page200('detail-noexplain.md'),
  }, ['detail', 'FIGURE-206235']);
  check('商品頁：jp 沒有規格也不換站（圖片才是必要的）', r.ok && r.ok.site === 'jp' && r.ok.explain.length === 0);
}

console.log('\n原始碼守則');
{
  // lastModified 固定 0 是刻意的：accept() 的重複判定鍵是 name|size|lastModified，
  // 用 Date.now() 會讓同一個商品匯入兩次永遠不被標示為「重複」
  const src = fs.readFileSync(path.join(ROOT, 'lib/amiami.js'), 'utf8');
  check('File 以 lastModified: 0 建立', /lastModified:\s*0/.test(src));
  check('未對 amiami 直接發請求',
        !/fetch\(\s*['"`]https:\/\/(www\.)?(img\.)?amiami/.test(src));
  // 只抓「當成標頭送出」的寫法；檔頭註解會提到它（那是實測依據）
  check('不再要求 HTML 格式', !/['"`]x-return-format['"`]/.test(src));
  check('不再依賴 DOMParser', !/DOMParser/.test(src));
  check('圖片下載沒有重試迴圈', !/CHALLENGE_WAITS|challengeWaits/.test(src.split('async function fetchImages')[1].split('// ── 高階流程')[0]));
}

console.log('\nstudio.html 接線');
{
  const html = fs.readFileSync(path.join(ROOT, 'studio.html'), 'utf8');
  check('引用 lib/amiami.js', html.includes('src="./lib/amiami.js"'));
  check('匯入走既有的 accept()', /await accept\(files\)/.test(html));
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html 未引用 lib/', !index.includes('./lib/'));
}

await browser.close();

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
