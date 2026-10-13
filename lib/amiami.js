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
 * **amiami.com 不抓頁面，直接打它的資料 API**（2026-10-13 實測）：
 *   amiami.com 是 SPA，資料來自 api.amiami.com，必須帶 `X-User-Key` 標頭
 *   （值寫在它自己的前端 JS 裡）。經 jina 渲染頁面時，SPA 向 API 要資料多半被擋，
 *   只剩「System Error Occured」——22 次只成功約 4 次，與 UA、等待、引擎等選項無關。
 *   jina 的 POST body 有 `customHeader` 參數（README 沒列，見其原始碼
 *   src/dto/crawler-options.ts），不需 API key 就能把標頭送到目標站：
 *   API 約 1 秒回 JSON，從 GitHub Pages 發出 CORS 正常。
 * 詳見 openspec/changes/archive/2026-10-13-amiami-com-api/design.md。
 *
 * jina 會快取回應一小時，挑戰頁也一樣會被快取——所以撞到挑戰頁時的重抓要帶
 * `x-no-cache`，否則重抓到的只是同一張挑戰頁。
 *
 * 代價是外部相依。兩者都是免費公共服務，都可能限流或消失，所以這裡的失敗
 * 一律往外拋帶 stage 與 site 的錯誤，由呼叫端明確呈現——絕不靜默退回空結果。
 *
 * 解析的部分刻意寫成純函式（jina 回傳的文字 → 資料），才能對固定樣本離線驗證，
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
   * amiami.com 的資料 API。金鑰是 amiami 自己的前端寫死、以 X-User-Key 標頭送出的
   * 公開值（不是我們的帳號）；缺了它，Cloudflare 回挑戰頁、API 回 Invalid access。
   * 參數與 amiami.com 搜尋頁自己送出的相同（pagemax=20、lang、s_keywords）。
   */
  const COM_API = 'https://api.amiami.com/api/v1.0/';
  const COM_KEY = 'amiami_dev';
  const COM_IMG = 'https://img.amiami.com';

  /**
   * 三個站。順序即備援順序；jp 永遠第一——只有它的規格是日文原文。
   * 顯示名稱集中在這裡，UI 的進度與錯誤訊息都從這裡取，不各自拼字。
   *
   * via 決定取法與解析器：'page' 經 jina 取 markdown 頁面，'api' 經 jina 打資料 API。
   * 中文站的 API 回的規格其實是英文（實測），所以 lang 也是 en。它和英文站是同一個
   * 後端，留著它的價值在於：網址不同、不吃同一份快取，等於一次自然的重抓。
   */
  const comSite = (id, label, apiLang, specHeading) => ({
    id, label, lang: 'en', via: 'api', specHeading,
    search: jan   => COM_API + 'items?pagemax=20&lang=' + apiLang + '&s_keywords=' + encodeURIComponent(jan),
    detail: gcode => COM_API + 'item?gcode=' + encodeURIComponent(gcode) + '&lang=' + apiLang,
  });
  const SITES = {
    jp: {
      id: 'jp', label: 'amiami.jp', lang: 'ja', via: 'page',
      search: jan   => 'https://www.amiami.jp/top/search/list?s_keywords=' + encodeURIComponent(jan),
      detail: gcode => 'https://www.amiami.jp/top/detail/detail?gcode=' + encodeURIComponent(gcode),
    },
    eng: comSite('eng', 'amiami.com（英文站）', 'eng', 'Specifications'),
    cn:  comSite('cn',  'amiami.com（中文站）', 'cn',  '商品式样'),
  };
  const ORDER = ['jp', 'eng', 'cn'];
  const viaApi = site => !!SITES[site] && SITES[site].via === 'api';

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
   *
   * api 站改用 POST，把 X-User-Key 放進 body 的 customHeader 讓 jina 轉送。
   * fresh 為真時帶 x-no-cache：jina 的快取連挑戰頁一起存，不帶的話重抓只會重播它。
   */
  async function fetchOnce(url, stage, site, fresh) {
    const headers = fresh ? { 'x-no-cache': 'true' } : {};
    let res;
    try {
      res = viaApi(site)
        ? await fetch(JINA, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
            body: JSON.stringify({ url, customHeader: { 'X-User-Key': COM_KEY } }),
          })
        : await fetch(jinaUrl(url), fresh ? { headers } : undefined);
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
   *   challenge  Cloudflare 挑戰頁。辨識不能只靠標題——它的樣式不只一種。
   *              api.amiami.com 擋下請求時回的也是它
   *   notFound   amiami.jp 的「エラーが発生しました」頁：該 gcode 在 jp 不存在。
   *              只在 amiami.com 上架的商品（例如標明不寄送日本的）就是這樣——
   *              不認出來的話，attempts 會寫成「找不到任何圖片」，看不出真正原因
   *   page       可解析（api 站的 JSON 也是 'page'，交給 apiJson 檢查）
   */
  function classify(text) {
    const t = String(text || '');
    const title = (/^Title:\s*(.*)$/m.exec(t) || [])[1] || '';
    if (/^\s*just a moment/i.test(title)) return 'challenge';
    if (/cdn-cgi\/challenge-platform|__cf_chl|challenge-form|Enable JavaScript and cookies to continue/i.test(t)) {
      return 'challenge';
    }
    if (/^\s*\[?エラーが発生しました/.test(title)) return 'notFound';
    return 'page';
  }

  // 撞到挑戰頁時的等待。原本是 [2000, 4000, 6000, 8000]（累計 20 秒），前提是
  // 代理會在背景通關；實測這件事已不再發生，長等只是讓人更晚看到錯誤。
  // 留一次短重抓吸收偶發的瞬斷，之後就換站
  const CHALLENGE_WAITS = [3000];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const KIND_MESSAGE = {
    challenge: 'Cloudflare 驗證未通過',
    notFound:  '此站沒有這個商品',
  };

  /**
   * 注意這裡的重抓與「失敗後重試」是兩回事，不要混為一談：
   *
   *   挑戰頁   → 同站短暫重抓（繞過 jina 快取），仍不行就交給呼叫端換站
   *   限流／錯誤 → 不重試，直接往外拋
   *
   * opts.challengeWaits 只給驗證腳本縮短等待用。
   */
  async function fetchPage(url, stage, site, opts) {
    const o = opts || {};
    const onWait = o.onWait || (() => {});
    const waits = o.challengeWaits || CHALLENGE_WAITS;
    let text = await fetchOnce(url, stage, site, false);
    let kind = classify(text);
    for (let i = 0; i < waits.length && kind === 'challenge'; i++) {
      onWait(site, i + 1, waits.length);
      await sleep(waits[i]);
      text = await fetchOnce(url, stage, site, true);
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

  /** 停售的字樣。jp 的 markdown 裡它就在連結文字中（`商品名 販売停止中 26% 6,760`） */
  const UNAVAILABLE = /販売停止中?|取扱終了|販売終了|取り扱い終了/;
  /**
   * 中古。jp 的 markdown 會丟掉中古圖示（實測），連結文字裡多半看不到——看得到才標，
   * 不以 `-R` 推測。amiami.com 的中古看 API 的 condition_flg，不靠字樣
   */
  const PREOWNED = /中古/;

  /**
   * 名稱尾端的「折扣 價格」：`3% 42,470`、`26% 6,760`、`16980`。
   * 價格至少要有千分位或四位數以上，否則會把「Ver. 2」這類名稱尾巴當價格剝掉
   */
  const TRAILING_PRICE = /(?:\s+(\d{1,2})%)?\s+(\d{1,3}(?:,\d{3})+|\d{4,})(?:\s*円)?$/;

  /**
   * 連結文字 → 名稱與價格。價格不丟：同名的兩筆候選常常只有價格不同，
   * 它是使用者分辨「該選哪一筆」時少數看得到的線索。
   * price 為顯示用字串（`42,470`），off 為折扣百分比字串（`3`），沒有就是空字串。
   */
  function splitName(raw) {
    const s = squash(squash(raw).replace(UNAVAILABLE, ' '));
    const m = TRAILING_PRICE.exec(s);
    if (!m) return { name: s, price: '', off: '' };
    const price = m[2].includes(',') ? m[2] : Number(m[2]).toLocaleString('en-US');
    return { name: squash(s.slice(0, m.index)), price, off: m[1] || '' };
  }
  const cleanName = raw => splitName(raw).name;

  // 結果範圍從「「<JAN>」の検索結果(N 件)」開始；查無時只有「検索結果」與固定的說明句
  const JP_RESULT_ANCHOR = /^「.*」の検索結果\((\d+)\s*件\)\s*$/m;
  const JP_NO_RESULT = /検索条件に一致する商品が見つかりませんでした/;

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
   *
   * 只處理 amiami.jp 的 markdown；amiami.com 的搜尋結果是 API 的 JSON，見 parseApiSearch。
   */
  function parseSearch(text) {
    const body = mdBody(text);
    const m = JP_RESULT_ANCHOR.exec(body);
    if (!m) {
      if (JP_NO_RESULT.test(body)) return [];
      throw failure('search', 'jp', '搜尋頁的格式認不出來', 'unparsed');
    }
    if (m[1] === '0') return [];
    let segment = body.slice(m.index + m[0].length);
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
    if (!out.length) throw failure('search', 'jp', '搜尋頁有結果但解析不出商品', 'unparsed');
    return keepLive(out);
  }

  /**
   * 停售的那筆不列。全部都停售時保留全部——否則使用者會看到假的「查無商品」，
   * 而那件商品在 amiami 上明明找得到
   */
  function keepLive(hits) {
    const live = hits.filter(h => !h.unavailable);
    return live.length ? live : hits;
  }

  // ── 純函式：商品頁 ───────────────────────────────────────────────────────

  /**
   * 站名後綴：`<商品名>-amiami.jp-あみあみオンライン本店-`。
   * 清完是空的就回空字串——站名不是商品名，不能拿來填命名欄
   */
  const SITE_SUFFIX = /\s*-\s*amiami\.jp\s*-.*$/;
  const cleanTitle = raw => String(raw || '').replace(SITE_SUFFIX, '').trim();

  const IMG = /https?:\/\/img\.amiami\.(?:jp|com)\/images\/product\/(main|rthumb|review)\/(\d+)\/([A-Za-z0-9_.-]+?)\.jpg/g;

  /**
   * amiami.jp 商品頁的標題與圖片。
   *
   * 標題：取正文第一個 `## ` 標題（即原本的 h1，含【予約】等後綴，與舊行為一致），
   * 沒有才退回檔頭的 Title。
   *
   * 圖片：主圖取第一個 `main/`，排第一。圖庫在 markdown 裡只剩 `rthumb/` 縮圖，
   * 換成 `review/` 就是原本 data-item-image 的大圖（實測同一張、weserv 可取）。
   * 只收檔名以主圖檔名開頭的——推薦區塊裡別的商品也可能出現同樣的路徑。
   * `bthumb/` 與 `thumb300/` 一律不收。
   */
  function parseProduct(text) {
    const body = mdBody(text);
    const h = /^#{1,2}\s+(.+)$/m.exec(body);
    const title = cleanTitle(h ? h[1] : mdTitle(text));

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

  /** 去行尾空白（markdown 的硬換行、全形空白）、連續空行收成一個 */
  const tidyLines = lines => lines
    .map(l => l.replace(/[ \t　]+$/, ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();

  /**
   * 只要「製品仕様」那一段。上架用得到的是規格，「解説」是廠商的行銷文案，
   * 貼出去只會稀釋規格——所以在資料這一層就挑掉，不是在畫面上藏起來。
   *
   * markdown 裡它是獨立一行的純文字標題，內文逐行、行尾兩個空白（即原本的 <br>），
   * 直到下一個段落標題、hashtag、空連結、markdown 標題為止。
   * 取不到就回空陣列——「未取得內文」本來就是看得見的狀態。
   */
  const SPEC_HEAD = /^製品仕様$/;
  const SPEC_STOP = /^(?:解説|解說|注意事項|\[#|\[\]\(|#{1,6}\s|この商品を購入された方は)/;

  function parseSpec(text) {
    const lines = mdBody(text).replace(/\r/g, '').split('\n');
    const at = lines.findIndex(l => SPEC_HEAD.test(l.trim()));
    if (at < 0) return [];
    const out = [];
    for (const l of lines.slice(at + 1)) {
      if (SPEC_STOP.test(l.trim())) break;
      out.push(l);
    }
    const body = tidyLines(out);
    return body ? [{ heading: lines[at].trim(), body }] : [];
  }

  // ── 純函式：amiami.com API ───────────────────────────────────────────────

  /**
   * jina 回傳的文字 → API 的 JSON。jina 對 JSON 不做 markdown 轉換，
   * `Markdown Content:` 之後就是原始內容（實測）。
   *
   * 失敗一律拋錯、不回空值：
   *   不是 JSON         unparsed（例如 jina 換了外殼格式）
   *   RSuccess 不為 true
   *     ErrorCode 10210 apiKey——Invalid access，金鑰被換掉時就是這個
   *     其他           apiError，附上代碼（查不存在的 gcode 是 error_code_21）
   */
  function apiJson(text, stage, site) {
    let j;
    try { j = JSON.parse(mdBody(text).trim()); }
    catch (e) { throw failure(stage, site, 'API 回應的格式認不出來', 'unparsed'); }
    if (!j || j.RSuccess !== true) {
      const v = (j && j.RValue) || {};
      const code = String(v.ErrorCode || (Array.isArray(v.Error) && v.Error[0] && v.Error[0].ErrorCode) || '');
      // 訊息前面會接站名（amiami.com（英文站）：…），這裡不再重複
      if (code === '10210') throw failure(stage, site, '拒絕存取（API 金鑰可能已更換）', 'apiKey');
      throw failure(stage, site, '站方回報錯誤' + (code ? '（' + code + '）' : ''), 'apiError');
    }
    return j;
  }

  /** API 給的圖片路徑是相對的（`/images/product/main/264/X.jpg`） */
  const comImg = p => (/^https?:\/\//.test(p) ? p : COM_IMG + p);

  /**
   * 搜尋結果 → 與 parseSearch 相同形狀的候選。狀態與中古看 API 自己的旗標：
   *   order_closed_flg  1 ＝ 頁面上的「Order Closed」標籤，等同 jp 的販売停止中
   *   condition_flg     1 ＝ 中古（amiami.com 的中古篩選就是 s_st_condition_flg）
   * 明確查無是 total_results 為 0 且 items 為空陣列；其餘對不上的形狀一律拋錯。
   */
  function parseApiSearch(text, site) {
    const j = apiJson(text, 'search', site);
    if (!Array.isArray(j.items)) throw failure('search', site, '搜尋結果的格式認不出來', 'unparsed');
    const total = j.search_result && j.search_result.total_results;
    if (!j.items.length) {
      if (total === 0) return [];
      throw failure('search', site, '搜尋結果的格式認不出來', 'unparsed');
    }
    const out = [];
    const seen = new Set();
    for (const it of j.items) {
      if (!it || !it.gcode || seen.has(it.gcode)) continue;
      seen.add(it.gcode);
      const closed = it.order_closed_flg === 1;
      const price = Number(it.c_price_taxed);
      out.push({
        gcode: String(it.gcode),
        name: squash(it.gname),
        price: price > 0 ? price.toLocaleString('en-US') : '',
        off: '',
        thumb: it.thumb_url ? comImg(it.thumb_url) : '',
        status: closed ? 'Order Closed' : '',
        preowned: it.condition_flg === 1,
        unavailable: closed,
      });
    }
    if (!out.length) throw failure('search', site, '搜尋結果有資料但解析不出商品', 'unparsed');
    return keepLive(out);
  }

  const COM_IMG_PATH = /^\/images\/product\/(?:main|review)\//;

  /**
   * 商品資料 → 與 parseProduct + parseSpec 相同的內容。
   *
   * 標題：日文名（sname_simple_j）優先，沒有才用英文的 sname／gname——
   * 與 jp 來源的商品名一致，輸出命名不會因為來源站不同而忽日忽英。
   *
   * 圖片：main 排第一，接著 review 圖庫，去重。只收 /images/product/main|review/。
   *
   * 規格：只取 spec 一段，它與 jp 的「製品仕様」逐項對應（實測同商品比對）。
   * memo（Details：原型、彩色等製作人員）在 jp 是放在「解説」裡的，一樣不收。
   */
  function parseApiItem(text, site) {
    const j = apiJson(text, 'detail', site);
    const it = j.item;
    if (!it || !it.gcode) throw failure('detail', site, '商品資料的格式認不出來', 'unparsed');

    const title = squash(it.sname_simple_j || it.sname || it.gname);

    const paths = [it.main_image_url]
      .concat(((j._embedded && j._embedded.review_images) || []).map(r => r && r.image_url));
    const imageUrls = [...new Set(paths.filter(p => COM_IMG_PATH.test(String(p || ''))).map(comImg))];

    const spec = tidyLines(String(it.spec || '').replace(/\r/g, '').replace(/<br\s*\/?>/gi, '\n').split('\n'));
    const explain = spec ? [specSection(spec, site)] : [];

    return { title, imageUrls, explain };
  }

  /**
   * 英文規格經內建對照表（lib/spec-ja.js）轉成 amiami.jp 的寫法。轉成的段落：
   *   heading   '製品仕様'——與 jp 來源一致，「複製全部」拿到的就是能直接貼的日文
   *   body      轉換後的全文；對不上的行保留英文
   *   lines     逐行 { text, ok }，畫面據此標出保留英文的行
   *   kept      保留英文的行數
   *   original  英文原文 { heading, body }，供對照，不進「複製全部」
   * 一行都對不上時照舊回英文原文（沒有 original），畫面標示「非日文原文」。
   * spec-ja.js 沒載入時同樣退回原文——少了翻譯不該讓整個匯入失敗。
   */
  function specSection(spec, site) {
    const raw = { heading: SITES[site].specHeading, body: spec };
    const t = MS.specJa ? MS.specJa.translate(spec) : null;
    if (!t || !t.translated) return raw;
    return { heading: '製品仕様', body: t.body, lines: t.lines, kept: t.kept, original: raw };
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
        const text = await fetchPage(searchUrl(jan, site), 'search', site, o);
        const hits = viaApi(site) ? parseApiSearch(text, site) : parseSearch(text);
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
   * 只有 jp 的規格是日文原文。圖片、商品名與規格一律取自同一個來源，
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
        const p = viaApi(site)
          ? parseApiItem(text, site)
          : Object.assign(parseProduct(text), { explain: parseSpec(text) });
        if (!p.imageUrls.length) throw failure('detail', site, '商品頁找不到任何圖片', 'noImages');
        return { gcode, site, lang: SITES[site].lang, title: p.title, imageUrls: p.imageUrls, explain: p.explain, attempts };
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
    parseApiSearch, parseApiItem,
    fetchImages, searchByJan, loadProduct,
  };
})();
