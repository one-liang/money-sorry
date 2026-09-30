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
 * r.jina.ai 穿過 Cloudflare 並回應 CORS 標頭；images.weserv.nl 以 ACAO:* 重新
 * 提供圖片位元組，canvas 因而不再被汙染。
 *
 * **頁面一律以 jina 預設的 markdown 格式取得**（2026-09-30 實測）：
 *   x-return-format: html   未抓過的網址一律只拿到挑戰頁，重抓 180 秒仍未通過
 *   預設 markdown           同一批網址 5/5 第一次即拿到內容，5–11 秒
 * 兩種格式不共用快取，先用 markdown 暖身再抓 html 也沒用。所以解析的對象是
 * markdown 文字而不是 DOM——代價是沒有 id / class 可定位，只能靠頁面上的
 * 顯示文字當錨點（見各解析函式的說明）。錨點缺席時一律拋錯，絕不回傳零筆：
 * 假的「查無商品」比明確的失敗糟得多。
 *
 * amiami.jp 取不到時依序改試 amiami.com 英文站、中文站（gcode 三站共用）。
 * 撰寫當下 amiami.com 的前端能過 Cloudflare，但它向後端要資料時被擋，頁面只顯示
 * 「System Error Occured」——備援在結構上備好，實際能不能用取決於對方。
 * 詳見 openspec/changes/archive/…-amiami-markdown-fetch/design.md。
 *
 * 代價是外部相依。兩者都是免費公共服務，都可能限流或消失，所以這裡的失敗
 * 一律往外拋帶 stage 與 site 的錯誤，由呼叫端明確呈現——絕不靜默退回空結果。
 *
 * 解析的部分刻意寫成純函式（markdown 字串 → 資料），才能對固定樣本離線驗證，
 * 不必每次跑真實網路請求。見 tools/verify/amiami.mjs。
 *
 * classic script，不是 ES module——引入 module 就等於引入 build 步驟。
 */
(() => {
  'use strict';

  const MS = (window.MS = window.MS || {});

  const JINA   = 'https://r.jina.ai/';
  const WESERV = 'https://images.weserv.nl/?url=';

  const jinaUrl = url => JINA + url;
  /** weserv 的 url 參數不吃 scheme，得先剝掉再編碼 */
  const weservUrl = imgUrl => WESERV + encodeURIComponent(String(imgUrl).replace(/^https?:\/\//, ''));

  // ── 站別 ─────────────────────────────────────────────────────────────────

  /**
   * 三個站。順序即備援順序；jp 永遠第一——只有它的規格是日文原文。
   * 顯示名稱集中在這裡，UI 的進度與錯誤訊息都從這裡取，不各自拼字。
   */
  const SITES = {
    jp: {
      id: 'jp', label: 'amiami.jp', lang: 'ja',
      search: jan   => 'https://www.amiami.jp/top/search/list?s_keywords=' + encodeURIComponent(jan),
      detail: gcode => 'https://www.amiami.jp/top/detail/detail?gcode=' + encodeURIComponent(gcode),
    },
    eng: {
      id: 'eng', label: 'amiami.com（英文站）', lang: 'en',
      search: jan   => 'https://www.amiami.com/eng/search/list/?s_keywords=' + encodeURIComponent(jan),
      detail: gcode => 'https://www.amiami.com/eng/detail/?gcode=' + encodeURIComponent(gcode),
    },
    cn: {
      id: 'cn', label: 'amiami.com（中文站）', lang: 'zh',
      search: jan   => 'https://www.amiami.com/cn/search/list/?s_keywords=' + encodeURIComponent(jan),
      detail: gcode => 'https://www.amiami.com/cn/detail/?gcode=' + encodeURIComponent(gcode),
    },
  };
  const ORDER = ['jp', 'eng', 'cn'];

  const searchUrl = (jan, site = 'jp')   => SITES[site].search(jan);
  const detailUrl = (gcode, site = 'jp') => SITES[site].detail(gcode);

  /**
   * 錯誤帶 stage 與 site，呼叫端才能說出「哪一站、卡在哪一步」而不是只說「失敗了」。
   * site 為 'proxy' 表示是代理服務本身出錯，與 amiami 哪一站無關。
   */
  function failure(stage, site, message, kind) {
    const err = new Error(message);
    err.stage = stage;
    err.site = site;
    err.kind = kind || 'error';
    return err;
  }

  // ── 取用 ─────────────────────────────────────────────────────────────────

  /**
   * 抓一次。區分兩種非正常回應，因為它們的處置相反：
   *
   *   代理錯誤（連不上、429 限流、5xx）→ 換站也是打同一個代理，只會對限流中的
   *                                      服務加壓，所以直接停止整個流程
   *   其他非 2xx（例如 jina 回報目標站抓取失敗）→ 算該站此步驟失敗，可以換站
   */
  async function fetchOnce(url, stage, site) {
    let res;
    try {
      res = await fetch(jinaUrl(url));
    } catch (err) {
      throw failure(stage, 'proxy', '連不上代理服務 r.jina.ai：' + (err.message || err), 'proxy');
    }
    if (res.status === 429) throw failure(stage, 'proxy', '代理服務 r.jina.ai 限流中（429），請稍後再試', 'proxy');
    if (res.status >= 500)  throw failure(stage, 'proxy', '代理服務 r.jina.ai 回應 ' + res.status, 'proxy');
    if (!res.ok) throw failure(stage, site, '代理回報無法取得頁面（' + res.status + '）', 'http');
    const text = await res.text();
    if (!text.trim()) throw failure(stage, site, '代理回傳空內容', 'empty');
    return text;
  }

  /**
   * 先分類、再解析。分類在解析之前把「失敗」與「查無」分開，解析函式只處理 'page'。
   *
   *   challenge  Cloudflare 挑戰頁。辨識不能只靠標題——它的樣式不只一種
   *   sysError   amiami.com 的 SPA 向後端要資料被擋時顯示的錯誤頁
   *              （站方原文就拼成 Occured，Occurred 一併接受）
   *   shell      amiami.com 的 SPA 外殼：有站名與導覽，沒有任何商品內容
   *   page       可解析
   */
  function classify(text) {
    const t = String(text || '');
    const title = (/^Title:\s*(.*)$/m.exec(t) || [])[1] || '';
    if (/^\s*just a moment/i.test(title)) return 'challenge';
    if (/cdn-cgi\/challenge-platform|__cf_chl|challenge-form|Enable JavaScript and cookies to continue/i.test(t)) {
      return 'challenge';
    }
    if (/System Error Occur+ed/i.test(t)) return 'sysError';
    if (/^URL Source:\s*https?:\/\/www\.amiami\.com\//m.test(t) &&
        !/images\/product\//.test(t) && !COM_RESULT_ANCHOR.test(t)) {
      return 'shell';
    }
    return 'page';
  }

  // 撞到挑戰頁時的等待。原本是 [2000, 4000, 6000, 8000]（累計 20 秒），前提是
  // 代理會在背景通關；實測這件事已不再發生，長等只是讓人更晚看到錯誤。
  // 留一次短重抓吸收偶發的瞬斷，之後就換站
  const CHALLENGE_WAITS = [3000];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const KIND_MESSAGE = {
    challenge: 'Cloudflare 驗證未通過',
    sysError:  '網站系統錯誤（該站後端無法取得資料）',
    shell:     '頁面只有外殼，沒有商品資料',
  };

  /**
   * 注意這裡的重抓與「失敗後重試」是兩回事，不要混為一談：
   *
   *   挑戰頁   → 同站短暫重抓，仍不行就交給呼叫端換站
   *   限流／錯誤 → 不重試，直接往外拋
   *
   * opts.challengeWaits 只給驗證腳本縮短等待用。
   */
  async function fetchPage(url, stage, site, opts) {
    const o = opts || {};
    const onWait = o.onWait || (() => {});
    const waits = o.challengeWaits || CHALLENGE_WAITS;
    let text = await fetchOnce(url, stage, site);
    let kind = classify(text);
    for (let i = 0; i < waits.length && kind === 'challenge'; i++) {
      onWait(site, i + 1, waits.length);
      await sleep(waits[i]);
      text = await fetchOnce(url, stage, site);
      kind = classify(text);
    }
    if (kind !== 'page') throw failure(stage, site, KIND_MESSAGE[kind], kind);
    return text;
  }

  // ── 純函式：markdown 共用 ────────────────────────────────────────────────

  /** jina 的 markdown 檔頭：`Title: …`、`URL Source: …`、`Markdown Content:` 之後才是正文 */
  function mdBody(text) {
    const t = String(text || '');
    const i = t.indexOf('Markdown Content:');
    return i < 0 ? t : t.slice(i + 'Markdown Content:'.length);
  }
  const mdTitle = text => ((/^Title:\s*(.*)$/m.exec(String(text || '')) || [])[1] || '').trim();
  const squash = s => String(s || '').replace(/\s+/g, ' ').trim();

  /**
   * 一個「圖片連結」：`[![alt](圖片網址) 連結文字](商品網址)`。
   * 搜尋結果的每一筆都長這樣；導覽與推薦區塊也長這樣，所以一定要先界定範圍。
   */
  const PRODUCT_LINK = /\[!\[[^\]]*\]\(([^)\s]+)[^)]*\)([^\]]*)\]\(([^)\s]*[?&]gcode=([^)&#\s]+)[^)\s]*)\)/g;

  function productLinks(segment) {
    const out = [];
    for (const m of segment.matchAll(PRODUCT_LINK)) {
      out.push({ thumb: m[1], text: squash(m[2]), href: m[3], gcode: decodeURIComponent(m[4]) });
    }
    return out;
  }

  // ── 純函式：搜尋 ─────────────────────────────────────────────────────────

  /**
   * 停售的字樣。jp 的 markdown 裡它就在連結文字中（`商品名 販売停止中 26% 6,760`）；
   * com 站是標籤文字（中文站實際看到的是「订单已结束」，英文站為推定）
   */
  const UNAVAILABLE = /販売停止中?|取扱終了|販売終了|取り扱い終了|订单已结束|Order Closed/;
  /** 中古。jp 的 markdown 會丟掉中古圖示（實測），只有 com 站的標籤文字留得下來 */
  const PREOWNED = /中古|二手商品|Pre-owned/i;

  /**
   * 名稱尾端的「折扣 價格」：`3% 42,470`、`26% 6,760`、`16980`、`11,980 日元9,219`。
   * 價格至少要有千分位或四位數以上，否則會把「Ver. 2」這類名稱尾巴當價格剝掉
   */
  const TRAILING_PRICE = /(?:\s+(\d{1,2})%)?\s+(\d{1,3}(?:,\d{3})+|\d{4,})(?:\s*(?:日元|円|JPY|yen)[\d,\s]*)?$/i;
  const LABELS = /^(?:(?:二手商品|订单已结束|Pre-owned|Order Closed|预订|Pre-order)\s*)+/i;

  /**
   * 連結文字 → 名稱與價格。價格不丟：同名的兩筆候選常常只有價格不同，
   * 它是使用者分辨「該選哪一筆」時少數看得到的線索。
   * price 為顯示用字串（`42,470`），off 為折扣百分比字串（`3`），沒有就是空字串。
   */
  function splitName(raw) {
    let s = squash(raw).replace(UNAVAILABLE, ' ').replace(LABELS, '');
    s = squash(s);
    const m = TRAILING_PRICE.exec(s);
    if (!m) return { name: s, price: '', off: '' };
    const price = m[2].includes(',') ? m[2] : Number(m[2]).toLocaleString('en-US');
    return { name: squash(s.slice(0, m.index)), price, off: m[1] || '' };
  }
  const cleanName = raw => splitName(raw).name;

  // jp：結果範圍從「「<JAN>」の検索結果(N 件)」開始；查無時只有「検索結果」與固定的說明句
  const JP_RESULT_ANCHOR = /^「.*」の検索結果\((\d+)\s*件\)\s*$/m;
  const JP_NO_RESULT = /検索条件に一致する商品が見つかりませんでした/;
  // com（中文站實測、英文站推定）：「"<JAN>"的搜索结果」／ Search results for "<JAN>"
  const COM_RESULT_ANCHOR = /^.*(?:的搜索结果|Search Results?\b).*$/im;

  /** 範圍終點：hashtag 標籤雲、jp 頁尾問卷、或下一個 markdown 標題 */
  const RESULT_END = /^(?:\[#|お求めの商品は探しやすいでしょうか|#{1,6}\s)/m;

  /**
   * 搜尋結果。錨點找不到就拋錯（kind: 'unparsed'），**不回傳空陣列**——
   * 頁面結構一變，空陣列會被顯示成「查無商品」，而那不是真的。
   * 明確查無（有查無說明、或 `(0 件)`）才回空陣列。
   *
   * 同一件商品在 amiami 常有兩筆上架（新品與中古、或現役與停售），gcode 以
   * `-R` 區別。**不能靠 `-R` 尾碼判斷哪一筆該留**——實測兩個 JAN 的結果剛好相反：
   *
   *   6976195110142   FIGURE-192119    新品           ← 該留
   *                   FIGURE-192119-R  販売停止中
   *   4560392859120   FIG-MOE-5596-R   中古           ← 該留
   *                   FIG-MOE-5596     販売停止中
   *
   * 判準是狀態而不是代號：停售的那筆連結文字裡會有「販売停止中」。
   */
  function parseSearch(text, site = 'jp') {
    const body = mdBody(text);
    let segment;
    if (site === 'jp') {
      const m = JP_RESULT_ANCHOR.exec(body);
      if (!m) {
        if (JP_NO_RESULT.test(body)) return [];
        throw failure('search', site, '搜尋頁的格式認不出來', 'unparsed');
      }
      if (m[1] === '0') return [];
      segment = body.slice(m.index + m[0].length);
    } else {
      const m = COM_RESULT_ANCHOR.exec(body);
      if (!m) throw failure('search', site, '搜尋頁的格式認不出來', 'unparsed');
      segment = body.slice(m.index + m[0].length);
    }
    const end = RESULT_END.exec(segment);
    if (end) segment = segment.slice(0, end.index);

    const out = [];
    const seen = new Set();
    for (const l of productLinks(segment)) {
      if (seen.has(l.gcode)) continue;
      seen.add(l.gcode);
      const status = (UNAVAILABLE.exec(l.text) || [''])[0];
      const { name, price, off } = splitName(l.text);
      out.push({
        gcode: l.gcode,
        name,
        price,
        off,
        thumb: l.thumb,
        status,
        preowned: PREOWNED.test(l.text),
        unavailable: !!status,
      });
    }
    // 有結果錨點、卻一筆都解析不出來：是格式變了，不是查無
    if (!out.length && site === 'jp') {
      throw failure('search', site, '搜尋頁有結果但解析不出商品', 'unparsed');
    }
    // 全部都停售時保留全部——否則使用者會看到假的「查無商品」，
    // 而那件商品在 amiami 上明明找得到
    const live = out.filter(h => !h.unavailable);
    return live.length ? live : out;
  }

  // ── 純函式：商品頁 ───────────────────────────────────────────────────────

  /**
   * 站名的前後綴：
   *   jp   `<商品名>-amiami.jp-あみあみオンライン本店-`
   *   com  `AmiAmi [Character & Hobby Shop] | <商品名>`，外殼頁只有前半
   * 清完是空的就回空字串——站名不是商品名，不能拿來填命名欄
   */
  const SITE_SUFFIX = /\s*-\s*amiami\.jp\s*-.*$/;
  const COM_PREFIX  = /^\s*AmiAmi \[Character & Hobby Shop\]\s*\|?\s*/;
  const cleanTitle = raw => String(raw || '').replace(SITE_SUFFIX, '').replace(COM_PREFIX, '').trim();

  const IMG = /https?:\/\/img\.amiami\.(?:jp|com)\/images\/product\/(main|rthumb|review)\/(\d+)\/([A-Za-z0-9_.-]+?)\.jpg/g;

  /**
   * 商品頁的標題與圖片。
   *
   * 標題：jp 取正文第一個 `## ` 標題（即原本的 h1，含【予約】等後綴，與舊行為一致），
   * 沒有才退回檔頭的 Title；com 取檔頭 Title 去掉站名前綴。
   *
   * 圖片：主圖取第一個 `main/`，排第一。圖庫在 jp 的 markdown 裡只剩 `rthumb/`
   * 縮圖，換成 `review/` 就是原本 data-item-image 的大圖（實測同一張、weserv 可取）；
   * com 的頁面直接就是 `review/`。只收檔名以主圖檔名開頭的——推薦區塊裡別的
   * 商品也可能出現同樣的路徑。`bthumb/` 與 `thumb300/` 一律不收。
   */
  function parseProduct(text, site = 'jp') {
    const body = mdBody(text);
    let title = '';
    if (site === 'jp') {
      const h = /^#{1,2}\s+(.+)$/m.exec(body);
      title = h ? h[1].trim() : '';
    }
    if (!title) title = cleanTitle(mdTitle(text));
    else title = cleanTitle(title);

    const urls = [];
    const seen = new Set();
    const push = u => { if (!seen.has(u)) { seen.add(u); urls.push(u); } };

    const all = [...body.matchAll(IMG)];
    const main = all.find(m => m[1] === 'main');
    const base = main ? main[3] : '';
    if (main) push(main[0]);
    for (const m of all) {
      if (m[1] === 'main') continue;
      if (base && !m[3].startsWith(base + '_')) continue;
      push(m[0].replace('/rthumb/', '/review/'));
    }
    return { title, imageUrls: urls };
  }

  /**
   * 只要「製品仕様」那一段。上架用得到的是規格，「解説」是廠商的行銷文案，
   * 貼出去只會稀釋規格——所以在資料這一層就挑掉，不是在畫面上藏起來。
   *
   * markdown 裡它是獨立一行的純文字標題，內文逐行、行尾兩個空白（即原本的 <br>），
   * 直到下一個段落標題、hashtag、空連結、markdown 標題為止。
   *
   * com 站的標題是「Specifications」（英文站，推定）或「商品式样」（中文站，實測；
   * 內文其實是英文）。取不到就回空陣列——「未取得內文」本來就是看得見的狀態。
   */
  const SPEC_HEAD = { jp: /^製品仕様$/, eng: /^Specifications?$/i, cn: /^商品式样$/ };
  const SPEC_STOP = /^(?:解説|解說|注意事項|Item Description|Copyright|版权|商品说明|\[#|\[\]\(|#{1,6}\s|この商品を購入された方は)/;

  function parseSpec(text, site = 'jp') {
    const lines = mdBody(text).replace(/\r/g, '').split('\n');
    const head = SPEC_HEAD[site] || SPEC_HEAD.jp;
    const at = lines.findIndex(l => head.test(l.trim()));
    if (at < 0) return [];
    const out = [];
    for (const l of lines.slice(at + 1)) {
      if (SPEC_STOP.test(l.trim())) break;
      out.push(l.replace(/[ \t　]+$/, ''));
    }
    const body = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return body ? [{ heading: lines[at].trim(), body }] : [];
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

  // ── 高階流程：多站備援 ───────────────────────────────────────────────────

  /** 全部站都失敗：訊息逐站列出，否則使用者分不出是單一站還是代理本身的問題 */
  function allFailed(stage, attempts) {
    const err = failure(stage, 'all', attempts.map(a => SITES[a.site].label + '：' + a.message).join('；'), 'all');
    err.attempts = attempts;
    return err;
  }

  /**
   * 依 jp → eng → cn 搜尋，第一個有結果的站勝出。
   *
   *   代理錯誤     直接往外拋，不換站（換站也是打同一個代理）
   *   明確查無     記下來，照樣試下一站（jp 沒上架但 com 有的情況也找得到）
   *   其他失敗     記下來，試下一站
   *
   * 回傳 { hits, site, attempts }。hits 為空時 attempts 裡至少有一站是明確查無；
   * 所有站都是失敗（沒有任何一站明確說查無）時拋出聚合錯誤。
   */
  async function searchByJan(jan, opts) {
    const o = opts || {};
    const onSite = o.onSite || (() => {});
    const attempts = [];
    for (const site of ORDER) {
      onSite(site, 'search');
      try {
        const hits = parseSearch(await fetchPage(searchUrl(jan, site), 'search', site, o), site);
        if (hits.length) return { hits, site, attempts };
        attempts.push({ site, message: '查無商品', none: true });
      } catch (err) {
        if (err.site === 'proxy') throw err;
        attempts.push({ site, message: err.message || String(err), kind: err.kind });
      }
    }
    if (attempts.some(a => a.none)) return { hits: [], site: null, attempts };
    throw allFailed('search', attempts);
  }

  /**
   * 商品頁。永遠從 jp 開始——gcode 三站共用，不管搜尋是在哪一站成功的，
   * 只有 jp 的規格是日文原文。圖片、商品名與規格一律取自同一個頁面，
   * 不混用兩站（兩站的圖庫順序與張數不保證一致）。
   */
  async function loadProduct(gcode, opts) {
    const o = opts || {};
    const onSite = o.onSite || (() => {});
    const attempts = [];
    for (const site of ORDER) {
      onSite(site, 'detail');
      try {
        const text = await fetchPage(detailUrl(gcode, site), 'detail', site, o);
        const { title, imageUrls } = parseProduct(text, site);
        if (!imageUrls.length) throw failure('detail', site, '商品頁找不到任何圖片', 'noImages');
        return { gcode, site, lang: SITES[site].lang, title, imageUrls, explain: parseSpec(text, site), attempts };
      } catch (err) {
        if (err.site === 'proxy') throw err;
        attempts.push({ site, message: err.message || String(err), kind: err.kind });
      }
    }
    throw allFailed('detail', attempts);
  }

  MS.amiami = {
    SITES, ORDER,
    jinaUrl, weservUrl, searchUrl, detailUrl,
    fetchPage, classify, parseSearch, parseProduct, parseSpec, cleanTitle, cleanName, splitName,
    fetchImages, searchByJan, loadProduct,
  };
})();
