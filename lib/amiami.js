/**
 * 由 JANコード 匯入 amiami 商品素材：搜尋 → 擷取 → 取得圖片位元組。
 *
 * 為什麼非得經過兩個外部代理，實測結論如下（三道牆各自獨立）：
 *
 *   CORS          img.amiami.jp 不發 Access-Control-Allow-Origin。
 *                 crossOrigin="anonymous" 載入直接失敗。
 *   Cloudflare    www.amiami.jp 與 img.amiami.jp 都會回 403 / 429 cf-mitigated:
 *                 challenge，帶完整瀏覽器標頭（UA、sec-ch-ua、sec-fetch-*）仍然被擋。
 *   canvas 汙染   圖片能以 <img> 顯示，但 drawImage 之後 toDataURL() 拋 SecurityError。
 *
 * 第三道是致命的：studio 的合成管線是 File → createImageBitmap → canvas → toBlob，
 * 它要的是**位元組**，而三道牆合起來的結論是「網頁拿得到網址，拿不到位元組」。
 *
 * r.jina.ai 內部跑 headless browser 穿過 Cloudflare 並回應 CORS 標頭；
 * images.weserv.nl 以 ACAO:* 重新提供圖片位元組，canvas 因而不再被汙染。
 *
 * 代價是外部相依。兩者都是免費公共服務，都可能限流或消失，所以這裡的失敗
 * 一律往外拋帶 stage 的錯誤，由呼叫端明確呈現——絕不靜默退回空結果。
 *
 * 解析的部分刻意寫成純函式（Document → 資料），才能對固定樣本離線驗證，
 * 不必每次跑真實網路請求。見 tools/verify/amiami.mjs。
 *
 * classic script，不是 ES module——引入 module 就等於引入 build 步驟。
 */
(() => {
  'use strict';

  const MS = (window.MS = window.MS || {});

  const JINA   = 'https://r.jina.ai/';
  const WESERV = 'https://images.weserv.nl/?url=';
  const AMIAMI = 'https://www.amiami.jp';

  const jinaUrl = url => JINA + url;
  /** weserv 的 url 參數不吃 scheme，得先剝掉再編碼 */
  const weservUrl = imgUrl => WESERV + encodeURIComponent(String(imgUrl).replace(/^https?:\/\//, ''));

  const searchUrl = jan   => AMIAMI + '/top/search/list?s_keywords=' + encodeURIComponent(jan);
  const detailUrl = gcode => AMIAMI + '/top/detail/detail?gcode=' + encodeURIComponent(gcode);

  /** 錯誤帶 stage，呼叫端才能說出「卡在哪一步」而不是只說「失敗了」 */
  function failure(stage, message) {
    const err = new Error(message);
    err.stage = stage;
    return err;
  }

  async function fetchDocOnce(url, stage) {
    let res;
    try {
      // x-return-format: html 才會拿到完整 DOM；預設的 markdown 會把
      // data-item-image 這類屬性整個丟掉，圖庫的 10 張就找不到了。
      res = await fetch(jinaUrl(url), { headers: { 'x-return-format': 'html' } });
    } catch (err) {
      throw failure(stage, '連不上代理服務：' + (err.message || err));
    }
    if (!res.ok) throw failure(stage, '代理服務回應 ' + res.status);
    const html = await res.text();
    if (!html) throw failure(stage, '代理服務回傳空內容');
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /**
   * Cloudflare 的「Just a moment…」挑戰頁。
   *
   * jina 撞到挑戰時會**立刻**把挑戰頁原樣回給我們，之後才在背景解掉它並把
   * 真正的頁面寫進快取。所以某個網址的第一次抓幾乎一定是這頁（實測 6KB），
   * 隔幾秒再抓同一個網址就是真的內容（實測 66KB）。
   *
   * 這就是「手動用瀏覽器開過那個 r.jina.ai 網址之後，搜尋突然就有資料了」的原因——
   * 手動開的那一次替快取暖了身。
   *
   * 認不出這一頁的話，parseSearch 會在挑戰頁上找不到 #search_table，回傳空陣列，
   * 於是每個沒被暖過的 JAN 都會顯示「查無商品」——一個看起來像資料問題的假象。
   */
  function isChallenge(doc) {
    if (/^\s*just a moment/i.test(doc.title || '')) return true;
    return !!doc.querySelector(
      'script[src*="cdn-cgi/challenge-platform"], form[action*="__cf_chl"], #challenge-form, #challenge-running'
    );
  }

  // 撞到挑戰時的等待。實測多半第 2 次（+4 秒）就有內容，但偶爾要到第 4、5 次，
  // 所以留到累計 20 秒——上限太小的代價是假的「查無商品」，比多等幾秒糟得多
  const CHALLENGE_WAITS = [2000, 4000, 6000, 8000];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /**
   * 注意這裡的重試與「失敗後重試」是兩回事，不要混為一談：
   *
   *   挑戰頁   → 重試。它不是失敗，是「還沒好」；jina 正在通關，再問一次就有了。
   *   限流／錯誤 → 不重試。對正在限流的服務加壓只會讓情況更糟，直接往外拋。
   */
  async function fetchDoc(url, stage, opts) {
    const onWait = (opts && opts.onWait) || (() => {});
    let doc = await fetchDocOnce(url, stage);
    for (let i = 0; i < CHALLENGE_WAITS.length && isChallenge(doc); i++) {
      onWait(i + 1, CHALLENGE_WAITS.length);
      await sleep(CHALLENGE_WAITS[i]);
      doc = await fetchDocOnce(url, stage);
    }
    if (isChallenge(doc)) {
      throw failure(stage, 'amiami 的 Cloudflare 驗證沒能在時限內通過，請稍後再試一次');
    }
    return doc;
  }

  // ── 純函式：解析 ─────────────────────────────────────────────────────────

  /** `.product_day` 用來放狀態，停售的字樣就掛在這裡（正常商品放的是發售日或什麼都沒有） */
  const UNAVAILABLE = /販売停止|取扱終了|販売終了|取り扱い終了/;

  /**
   * 搜尋結果。只取 #search_table 之內的項目——頁面上還有數個推薦商品區塊，
   * 它們同樣是 detail?gcode= 的連結，全頁掃描會把推薦誤判成搜尋結果。
   *
   * 同一件商品在 amiami 常有兩筆上架（新品與中古、或現役與停售），gcode 以
   * `-R` 區別。**不能靠 `-R` 尾碼判斷哪一筆該留**——實測兩個 JAN 的結果剛好相反：
   *
   *   6976195110142   FIGURE-192119    新品           ← 該留
   *                   FIGURE-192119-R  販売停止中
   *   4560392859120   FIG-MOE-5596-R   中古           ← 該留
   *                   FIG-MOE-5596     販売停止中
   *
   * 判準是狀態而不是代號：停售的那筆 `.product_day` 會寫「販売停止中」。
   * amiami 自己的搜尋頁預設也不列這些（靠 s_st_list_*_available 參數），
   * 這裡改在前端判斷，少送一次請求，也不必跟著它的參數名走。
   */
  function parseSearch(doc) {
    const out = [];
    const seen = new Set();
    for (const box of doc.querySelectorAll('#search_table .product_box')) {
      const a = box.querySelector('a[href*="gcode="]');
      if (!a) continue;
      const m = /[?&]gcode=([^&#"']+)/.exec(a.getAttribute('href') || '');
      if (!m) continue;
      const gcode = decodeURIComponent(m[1]);
      if (seen.has(gcode)) continue;
      seen.add(gcode);

      const img  = box.querySelector('img');
      const name = box.querySelector('.product_name');
      const day  = box.querySelector('.product_day');
      const text = t => (t || '').replace(/\s+/g, ' ').trim();
      // 名稱要取 .product_name，不能取整個 <a>——後者會把「5% 8,770」這種
      // 折扣與價格一起黏進候選標籤裡
      out.push({
        gcode,
        name: text(name ? name.textContent : a.textContent),
        thumb: img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '',
        status: text(day ? day.textContent : ''),
        preowned: !!box.querySelector('.icon_preowned'),
        unavailable: UNAVAILABLE.test(day ? day.textContent : ''),
      });
    }
    // 全部都停售時保留全部——否則使用者會看到假的「查無商品」，
    // 而那件商品在 amiami 上明明找得到
    const live = out.filter(h => !h.unavailable);
    return live.length ? live : out;
  }

  /** `<商品名>-amiami.jp-あみあみオンライン本店-` → `<商品名>` */
  const SITE_SUFFIX = /\s*-\s*amiami\.jp\s*-.*$/;
  const cleanTitle = raw => String(raw || '').replace(SITE_SUFFIX, '').trim();

  /**
   * 商品頁的圖片與標題。
   * 主圖排第一（data-main-image，600×600），圖庫依頁面原序接在後面
   * （data-item-image，800px 級、非正方形）。<img src> 指向的是 40×40 的
   * 縮圖，不能拿來用——大圖只存在於 data-* 屬性裡。
   */
  function parseProduct(doc) {
    const urls = [];
    const seen = new Set();
    const push = u => { if (u && !seen.has(u)) { seen.add(u); urls.push(u); } };

    const main = doc.querySelector('[data-main-image]');
    if (main) push(main.getAttribute('data-main-image'));
    for (const el of doc.querySelectorAll('[data-item-image]')) push(el.getAttribute('data-item-image'));

    const h1 = doc.querySelector('h1');
    const rawTitle = (h1 && h1.textContent.trim()) ? h1.textContent : (doc.title || '');
    return { title: cleanTitle(rawTitle), imageUrls: urls };
  }

  /**
   * 取區塊文字。<br> 是規格唯一的換行來源——只取 textContent 會把
   * 「【サイズ】全高：約140mm【素材】プラスチック」黏成一長串，
   * 與頁面上的逐行呈現不符。
   */
  function blockText(el) {
    const clone = el.cloneNode(true);
    for (const br of clone.querySelectorAll('br')) br.replaceWith('\n');
    return clone.textContent
      .replace(/\r/g, '')
      .replace(/[ \t　]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 商品說明。#explain 的結構是「標題、內文」成對：
   *   p.heading_07  製品仕様
   *   p.box_01      塗装済み完成品【サイズ】…
   *   p.heading_07  解説
   *   p.box_01      原型制作：…
   *   div.hashtag-container            ← 站內標籤雲，不是商品說明，排除
   *
   * hashtag 區塊在代理取得的快照中不一定出現（它是 JS 後渲染的），
   * 缺席不算失敗；規則保留是因為使用者直接看的頁面上它確實存在，且成本為零。
   *
   * 找不到 #explain 時回傳空陣列而非拋錯——只拿到圖片也是有用的結果。
   */
  function parseExplain(doc) {
    const root = doc.querySelector('#explain');
    if (!root) return [];
    const out = [];
    let heading = '';
    for (const el of root.children) {
      if (el.classList.contains('hashtag-container')) continue;
      const text = blockText(el);
      if (!text) continue;
      if (el.classList.contains('heading_07')) { heading = text; continue; }
      out.push({ heading, body: text });
      heading = '';
    }
    // 標題後面沒接到內文時也別讓它消失
    if (heading) out.push({ heading, body: '' });
    return out;
  }

  // ── 取得圖片位元組 ───────────────────────────────────────────────────────

  async function fetchOneImage(url) {
    const res = await fetch(weservUrl(url));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!blob.size) throw new Error('回應為空');
    const base = String(url).split('?')[0].split('/').pop() || 'image.jpg';
    // lastModified 固定 0：accept() 的重複判定鍵是 name|size|lastModified，
    // 用 Date.now() 會讓同一個商品匯入兩次永遠不被標示為「重複」。
    return new File([blob], decodeURIComponent(base), {
      type: blob.type || 'image/jpeg',
      lastModified: 0,
    });
  }

  /**
   * 併發取圖。上限刻意壓在個位數：一次全開對免費公共服務容易觸發突發限流，
   * 換來的幾秒鐘不值得整批失敗的風險。
   *
   * 單張失敗不影響其餘——與既有「無法解碼的檔案不中止整批」同一個立場。
   * 不自動重試：對限流中的服務重試只會讓情況更糟。
   */
  async function fetchImages(urls, opts) {
    const o = opts || {};
    const limit = Math.max(1, o.concurrency || 4);
    const onProgress = o.onProgress || (() => {});
    const files = new Array(urls.length);
    const errors = [];
    let next = 0, done = 0;

    async function worker() {
      for (;;) {
        const i = next++;
        if (i >= urls.length) return;
        try {
          files[i] = await fetchOneImage(urls[i]);
        } catch (err) {
          errors.push({ url: urls[i], message: err.message || String(err) });
        }
        onProgress(++done, urls.length);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(limit, urls.length) }, worker)
    );
    return { files: files.filter(Boolean), errors };   // filter 保住原始順序
  }

  // ── 高階流程 ─────────────────────────────────────────────────────────────

  const searchByJan = async (jan, opts) =>
    parseSearch(await fetchDoc(searchUrl(jan), 'search', opts));

  async function loadProduct(gcode, opts) {
    const doc = await fetchDoc(detailUrl(gcode), 'detail', opts);
    const { title, imageUrls } = parseProduct(doc);
    if (!imageUrls.length) throw failure('detail', '這個商品頁找不到任何圖片');
    return { gcode, title, imageUrls, explain: parseExplain(doc) };
  }

  MS.amiami = {
    jinaUrl, weservUrl, searchUrl, detailUrl,
    fetchDoc, isChallenge, parseSearch, parseProduct, parseExplain, cleanTitle, blockText,
    fetchImages, searchByJan, loadProduct,
  };
})();
