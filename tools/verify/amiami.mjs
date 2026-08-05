/**
 * lib/amiami.js 的解析器驗證。
 *
 *   node tools/verify/amiami.mjs
 *
 * 只驗**純函式**：parseSearch / parseProduct / parseExplain / cleanTitle / blockText，
 * 全部是 Document → 資料，不碰網路。真實請求會被 Cloudflare 限流、會受代理服務
 * 的可用性影響，拿它當回歸測試等於把外部服務的狀態綁進自己的測試結果裡。
 *
 * 樣本是自撰的最小結構（tools/verify/fixtures/），刻意不收錄 amiami 的實際頁面
 * 內容——測的是「我們對這個結構的規則」，不是「別人的內容」。
 *
 * 需要瀏覽器是因為 DOMParser 與 classList；用 Playwright 起一個空白頁載入
 * lib/amiami.js 即可，不需要 server。
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

/** 在瀏覽器裡把樣本解析成 Document，再跑指定的解析器 */
const run = (html, fn) => page.evaluate(
  ([h, f]) => {
    const doc = new DOMParser().parseFromString(h, 'text/html');
    return window.MS.amiami[f](doc);
  },
  [html, fn]
);

console.log('\nparseSearch');
{
  const one = await run(fixture('search-one.html'), 'parseSearch');
  eq('單筆：只取搜尋結果，不含推薦商品', one.map(h => h.gcode), ['FIGURE-206235']);
  check('單筆：縮圖優先取 data-src', one[0].thumb.includes('thumb300'), one[0].thumb);
  check('單筆：帶出商品名', one[0].name.includes('測試商品'), one[0].name);

  const many = await run(fixture('search-many.html'), 'parseSearch');
  eq('多筆：去重後 3 筆',
     many.map(h => h.gcode), ['FIGURE-300001', 'FIGURE-300002', 'FIGURE-300003']);

  const none = await run(fixture('search-none.html'), 'parseSearch');
  eq('零筆：推薦商品不得被誤判為結果', none, []);
}

console.log('\nparseSearch：同商品的重複上架');
{
  // 同一件商品常有兩筆（新品／中古、現役／停售），名稱一模一樣。
  // amiami 自己的搜尋頁預設不列停售的那筆，我們也不該列。
  const a = await run(fixture('search-dup-stopped.html'), 'parseSearch');
  eq('排除販売停止中，只留現役那筆', a.map(h => h.gcode), ['FIGURE-192119']);
  eq('名稱不得混入折扣與價格', a[0].name, '測試商品 異色版');
  check('縮圖取 data-src 而非 blank.gif 佔位圖',
        a[0].thumb.includes('thumb300') && !a[0].thumb.includes('blank.gif'), a[0].thumb);

  // 這一組與上一組的答案剛好相反——靠 `-R` 尾碼判斷一定會挑錯
  const b = await run(fixture('search-dup-preowned.html'), 'parseSearch');
  eq('該留的是帶 -R 的中古那筆', b.map(h => h.gcode), ['FIG-MOE-5596-R']);
  check('中古有被標記出來', b[0].preowned === true, JSON.stringify(b[0].preowned));
  check('停售那筆即使有價格也照樣排除',
        !b.some(h => h.gcode === 'FIG-MOE-5596'), b.map(h => h.gcode).join(','));

  const c = await run(fixture('search-all-stopped.html'), 'parseSearch');
  eq('全部都停售時保留全部，MUST NOT 變成假的查無', c.map(h => h.gcode), ['FIGURE-999001']);
  check('停售狀態有帶出來', /販売停止/.test(c[0].status), c[0].status);
}

console.log('\nparseProduct');
{
  const p = await run(fixture('detail-full.html'), 'parseProduct');
  eq('圖片：主圖第一，圖庫依序，重複去除', p.imageUrls, [
    'https://img.amiami.jp/images/product/main/263/FIGURE-206235.jpg',
    'https://img.amiami.jp/images/product/review/263/FIGURE-206235_01.jpg',
    'https://img.amiami.jp/images/product/review/263/FIGURE-206235_02.jpg',
    'https://img.amiami.jp/images/product/review/263/FIGURE-206235_03.jpg',
  ]);
  check('圖片：不得取到 rthumb 縮圖',
        !p.imageUrls.some(u => u.includes('rthumb')), p.imageUrls.join(' '));
  eq('標題：清除站名後綴', p.title, '測試商品 完成品フィギュア【2027年6月発売分】');

  const q = await run(fixture('detail-nohash.html'), 'parseProduct');
  eq('標題：沒有 h1 時退回 title', q.title, '無標籤測試商品');
}

console.log('\nparseExplain');
{
  const e = await run(fixture('detail-full.html'), 'parseExplain');
  eq('標題與內文成對', e.map(s => s.heading), ['製品仕様', '解説']);
  check('排除 hashtag-container',
        !JSON.stringify(e).includes('テスト') || !JSON.stringify(e).includes('#テスト'),
        JSON.stringify(e).includes('#テスト') ? '仍含 #テスト' : '');
  // <br> 是規格唯一的換行來源；只取 textContent 會黏成一行
  const spec = e[0].body;
  check('<br> 還原為換行', spec.split('\n').length >= 5, JSON.stringify(spec));
  check('規格未黏成單行', !spec.includes('約140mm(ノンスケール)【素材】'), JSON.stringify(spec));
  check('規格首行正確', spec.split('\n')[0] === '塗装済み完成品', JSON.stringify(spec.split('\n')[0]));
  check('空行收斂為最多一個', !spec.includes('\n\n\n'), JSON.stringify(spec));

  const n = await run(fixture('detail-nohash.html'), 'parseExplain');
  eq('沒有 hashtag 區塊時照常完成', n.map(s => s.heading), ['製品仕様']);
  check('沒有 hashtag 時內文仍逐行', n[0].body === '項目一\n項目二', JSON.stringify(n[0].body));

  const none = await run(fixture('detail-noexplain.html'), 'parseExplain');
  eq('#explain 缺席回傳空陣列而非拋錯', none, []);
}

console.log('\nCloudflare 挑戰頁偵測');
{
  // 代理第一次抓某個網址時會先回挑戰頁，之後才在背景通關並寫進快取。
  // 認不出這一頁的話，每個沒被暖過的 JAN 都會顯示假的「查無商品」。
  const chal  = await run(fixture('challenge.html'), 'isChallenge');
  const chal2 = await run(fixture('challenge-notitle.html'), 'isChallenge');
  check('認得標準的 Just a moment 挑戰頁', chal === true, String(chal));
  check('標題被換掉也認得（靠 challenge-platform 腳本）', chal2 === true, String(chal2));

  for (const f of ['search-one.html', 'search-many.html', 'search-none.html',
                   'detail-full.html', 'detail-nohash.html', 'detail-noexplain.html']) {
    const v = await run(fixture(f), 'isChallenge');
    check(`正常頁面不得被誤判：${f}`, v === false, String(v));
  }
  // 這是關鍵的錯誤模式：查無商品的搜尋頁與挑戰頁都「沒有商品」，
  // 但一個該回 0 筆、另一個該重試
  const asSearch = await run(fixture('challenge.html'), 'parseSearch');
  check('挑戰頁在 parseSearch 眼中確實是 0 筆（所以非靠 isChallenge 不可）',
        Array.isArray(asSearch) && asSearch.length === 0);
}

console.log('\n代理位址組裝');
{
  const urls = await page.evaluate(() => ({
    weserv: window.MS.amiami.weservUrl('https://img.amiami.jp/images/product/main/263/FIGURE-206235.jpg'),
    jina: window.MS.amiami.jinaUrl('https://www.amiami.jp/top/detail/detail?gcode=X'),
    search: window.MS.amiami.searchUrl('4570232591424'),
  }));
  check('weserv 剝掉 scheme 後編碼',
        urls.weserv.startsWith('https://images.weserv.nl/?url=img.amiami.jp') ||
        urls.weserv.includes('img.amiami.jp%2Fimages'), urls.weserv);
  check('weserv 不重複帶 scheme', !urls.weserv.includes('https%3A%2F%2Fimg'), urls.weserv);
  check('jina 前綴正確', urls.jina.startsWith('https://r.jina.ai/https://www.amiami.jp'), urls.jina);
  check('搜尋網址帶 s_keywords', urls.search.includes('s_keywords=4570232591424'), urls.search);
}

console.log('\n檔名與重複判定');
{
  // lastModified 固定 0 是刻意的：accept() 的重複判定鍵是 name|size|lastModified，
  // 用 Date.now() 會讓同一個商品匯入兩次永遠不被標示為「重複」
  const src = fs.readFileSync(path.join(ROOT, 'lib/amiami.js'), 'utf8');
  check('File 以 lastModified: 0 建立', /lastModified:\s*0/.test(src));
  check('未對 amiami 直接發請求',
        !/fetch\(\s*['"`]https:\/\/(www\.)?(img\.)?amiami/.test(src));
  // 挑戰頁要重試（那不是失敗，是還沒好）；限流與錯誤仍然直接往外拋
  check('只在挑戰頁時重試', /isChallenge\(doc\)/.test(src) && /CHALLENGE_WAITS/.test(src));
  check('圖片下載沒有重試迴圈', !/CHALLENGE_WAITS/.test(src.split('async function fetchImages')[1] || ''));
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
