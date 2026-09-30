# Design

## Context

動機見 proposal.md。以下是撰寫本文件時（2026-09-30 ~ 10-01）的實測，決策都以它為依據。

### 實測一：失敗的是輸出格式，不是代理

| 請求（皆為此前未抓過的網址） | 結果 |
|---|---|
| jina + `x-return-format: html`，amiami.jp 搜尋，每 5 秒 ×5 | 5/5 挑戰頁（5977 B） |
| 同上，amiami.jp 商品頁，每 15 秒重抓持續 180 秒 | 全程挑戰頁——背景通關不再發生 |
| 同上 + `x-no-cache` | 挑戰頁 |
| jina + `x-engine: browser` | 401，需 API key |
| **jina 預設（markdown）**，2 個搜尋 + 3 個商品頁 | **5/5 第一次即成功**，5–11 秒 |
| 先以 markdown 抓過，再以 html 抓同網址 | 仍為挑戰頁（兩種格式不共用快取） |
| 直接連 amiami.jp | 429 挑戰頁 |
| allorigins / codetabs / corsproxy.io | 522 / 522 / 401 |
| weserv 取 `img.amiami.jp`、`img.amiami.com` | 200，正常 |

本機 curl 無 Origin、無 Referer，結果與 GitHub Pages 上相同——與部署環境無關。

「使用者用瀏覽器開 r.jina.ai 網址就看得到資料」的原因即在此：瀏覽器開啟時走的是預設 markdown 格式。

### 實測二：markdown 內容足以取代 DOM

以 `FIGURE-208923`、JAN `6979272330921`、`4580416948159` 取樣：

```
搜尋頁
  Title: [6979272330921 の検索結果]-amiami.jp-…
  …（分類導覽、大量推薦連結）…
  「6979272330921」の検索結果(2 件)          ← 結果範圍的起點
  絞り込み/解除
  [![Image 77](…/thumb300/263/FIGURE-208923.jpg) 商品名 3% 42,470](…detail?gcode=FIGURE-208923)
  [![Image 78](…/thumb300/263/FIGURE-208922.jpg) 商品名 10% 39,600](…detail?gcode=FIGURE-208922)
  [#美少女フィギュア](https://slist.amiami.jp/…)  ← hashtag，結果範圍的終點
  お求めの商品は探しやすいでしょうか？

  停售項目：…完成品フィギュア 販売停止中](…gcode=FIGURE-158153-R)
  查無時：Title 為 [検索結果]-…（不含 JAN）、無「の検索結果(N 件)」行

商品頁
  Title: <商品名>                              ← 已無 -amiami.jp- 後綴
  …/images/product/main/263/FIGURE-208923.jpg   ← 主圖
  …/images/product/rthumb/263/FIGURE-208923_01.jpg … _18.jpg  ← 圖庫縮圖
  製品仕様                                      ← 純文字標題行
  塗装済み完成品␣␣
  【スケール】1/7␣␣                             ← 行尾兩空白 = 原本的 <br>
  …
  解説                                          ← 下一個段落標題
  …
  [#美少女フィギュア](…)                         ← hashtag
```

`rthumb/` → `review/` 即為原本 `data-item-image` 的大圖網址（HTML 樣本 `detail-full.html` 對照一致；weserv 取 `review/263/FIGURE-208923_01.jpg` 回 200、50 KB）。

### 實測三：amiami.com 目前取不到資料

| 請求 | 結果 |
|---|---|
| jina markdown，`/eng/search/list/?s_keywords=…`、`/cn/…`、`/eng/detail/?gcode=…` | 200，通過 Cloudflare，但只有 SPA 外殼（導覽列、分類） |
| 加 `x-timeout: 20` / `x-wait-for-selector` | SPA 執行了，顯示 **「System Error Occured / Please try again a little later.」** |
| jina 直接抓 `api.amiami.com/api/v1.0/items?…` | 通過 Cloudflare，但 amiami 回 `{"RSuccess":false,…"ErrorCode":"10210","RMessage":"Invalid access."}`（缺 `X-User-Key` 標頭；jina 不轉送自訂標頭，GET 標頭與 POST body 兩種方式皆試過） |
| 直接連 `api.amiami.com` | 403 Cloudflare |

也就是說：**備援在撰寫當下實際上拿不到資料**。它的價值是結構上的——amiami.com 的前端或 Cloudflare 規則改變時能自動接上，而且把「是哪一站壞了」變成看得見的資訊。本設計因此把重心放在「備援失敗時能被準確辨識與回報」，而不是假設它能成功。

## Goals / Non-Goals

**Goals:**
- jp 路徑恢復可用，且不依賴代理的背景快取時序。
- 解析維持純函式、可離線以 fixture 驗證。
- 備援的每一種失敗形態（挑戰頁、系統錯誤頁、SPA 空殼、代理錯誤）都能被辨識、歸屬到站別。
- 撞牆時的總等待時間縮短：最壞情況（三站皆挑戰頁）也應在約 30 秒內給出結論。

**Non-Goals:**
- 不呼叫 `api.amiami.com`（需要自訂標頭，免費代理無法轉送；自架代理超出「純靜態」定位）。
- 不申請 jina API key（key 放在靜態頁等於公開）。
- 不做機器翻譯。
- 不做書籤工具（bookmarklet）式的匯入；它是另一種互動模式，markdown 路徑可用時沒有必要。

## Decisions

### D1. 改用 markdown 格式，解析器改吃字串

`fetchDocOnce` 不再送 `x-return-format`，回傳 `res.text()` 字串。解析函式簽名由 `(Document) → 資料` 改為 `(string) → 資料`。

- 替代方案：markdown 抓一次暖快取、再用 html 抓 → 實測兩格式不共用快取，無效。
- 替代方案：`x-return-format: text` → 會丟掉連結網址，gcode 與圖片網址都拿不到。
- 代價：markdown 沒有 id/class 可定位，只能靠文字錨點（`の検索結果(N 件)`、`製品仕様`、`解説`、hashtag 連結網域 `slist.amiami.jp`）。這些錨點都是**站方的顯示文字**，改版時較 id 容易變動；以 fixture 釘住，並在錨點缺席時回報「解析不到」而非零筆（見 D4）。

### D2. 搜尋結果的界定

範圍 = `「<JAN>」の検索結果(N 件)` 那一行之後，到第一個 `slist.amiami.jp` hashtag 連結或頁尾問卷行之前。範圍內每個 `[![…](thumb)<名稱文字>](…detail?gcode=X)` 為一筆。

- 名稱：連結文字去掉圖片語法，再去掉尾端的 `N% 價格`、`価格`，以及狀態字樣。
- 狀態：以既有的 `UNAVAILABLE` 規則比對連結文字（實測「販売停止中」確實出現在連結文字內）。
- 中古：**已確認 jp 的 markdown 完全不含中古標示**（2026-10-01 取 `4560392859120`：`FIG-MOE-5596-R` 為中古，連結文字只有 `レーシングミク 2011ver. 1/8 完成品フィギュア （初音ミク） 11,980`，圖示整個消失）。中古只在商品頁的 `## 【中古】(本体A/箱B)…` 標題裡看得到。因此 jp 搜尋結果的 `preowned` 實際上恆為 false；com 站的標籤文字（`二手商品`）則保留得下來。這只影響候選清單的「中古」標示，不影響篩選（篩選依停售字樣，確實存在於連結文字）；而篩選後同名的現役項目通常只剩一筆、直接匯入，不會進候選清單。匯入後商品名本身帶【中古】，使用者仍看得到。spec 已據此修正。
- 查無：無 `の検索結果(` 行、且 Title 不含 JAN → 明確零筆。有該行但 `(0 件)` 也是零筆。**兩者都沒有**（頁面結構不明）→ 視為「解析不到」，屬於該站失敗，觸發備援。這一條是為了守住「假的查無商品」。

### D3. 商品頁的界定

- 標題：markdown 第一行 `Title:`，經 `cleanTitle` 清站名後綴（jp 的 `-amiami.jp-…`，com 的 `AmiAmi [Character & Hobby Shop]`）；清完為空則回空字串，由 UI 不提供填入。
- 主圖：第一個 `/images/product/main/` 網址。
- 圖庫：依出現順序收 `/images/product/rthumb/` 網址，改寫為 `/review/`，去重。`bthumb/`（頁首大縮圖）與推薦區的 `thumb300/` 不收。
- 規格：找到獨立成行的 `製品仕様`（備援站為 `Specifications` / `商品式样`，實作時以樣本確認），取到下一個已知段落標題（`解説`、`Item Description` 等）、hashtag 行或下一個 markdown 標題為止。行尾的兩空白（markdown 硬換行）還原為換行、去除行尾空白、壓縮連續空行。

### D4. 頁面分類：先分類，再解析

每次取得內容後，先判定類型，再決定是否解析：

```
classify(text) →
  'challenge'   Cloudflare 挑戰頁（標題 Just a moment／cdn-cgi/challenge-platform／__cf_chl 特徵）
  'sysError'    amiami.com 的 System Error Occured 頁
  'shell'       amiami.com SPA 外殼（有站名、無任何商品內容錨點）
  'page'        可解析
```

`challenge` 走 D5 的重抓；`sysError` / `shell` 直接判定該站此步驟失敗。這讓「失敗」與「查無」在進入解析之前就分開，解析函式本身只處理 `page`。

### D5. 挑戰頁：短重抓，然後換站

`CHALLENGE_WAITS` 由 `[2000, 4000, 6000, 8000]`（累計 20 秒）改為 `[3000]`（重抓 1 次）。

- 理由：實測 html 格式 180 秒都等不到，markdown 格式則第一次就成功——中間態幾乎不存在。長等待的唯一效果是讓使用者等更久才看到錯誤。保留一次重抓是為了吸收偶發的瞬斷。
- 最壞情況：三站 × 搜尋（每站最多 2 次請求 + 3 秒）≈ 20–30 秒，比現在的單站 20 秒多不了多少，卻涵蓋三個站。

### D6. 備援流程

```
searchByJan(jan)
  for site in [jp, eng, cn]:
     try  hits = search(site)          ── 代理錯誤（jina 4xx/5xx/網路）→ 直接拋，不換站
          if hits.length → return { hits, site }
          else → 記下「site: 查無」，繼續         ── 明確零筆也要試下一站
     catch SiteError → 記下「site: 原因」，繼續
  若所有站都是「查無」→ return []（UI 顯示查無商品）
  否則 → 拋 AggregateSiteError(逐站原因)

loadProduct(gcode)
  for site in [jp, eng, cn]:           ── 永遠從 jp 開始，gcode 三站共用
     try  p = detail(site); if p.imageUrls.length → return { ...p, site }
          else → 記下「site: 找不到圖片」，繼續
     catch SiteError → 記下，繼續
  拋 AggregateSiteError
```

- 「代理錯誤不換站」：jina 限流時換站只是用另一個網址再打同一個被限流的服務，違反「限流不重試」。以 HTTP 狀態碼與回應是否為 jina 自己的 JSON 錯誤區分代理錯誤與站方錯誤。
- 錯誤物件：`err.stage`（`search` / `detail`）保留，新增 `err.site`（`jp` / `eng` / `cn` / `proxy`）；聚合錯誤帶 `err.attempts = [{ site, message }]`。

### D7. amiami.com 的網址與解析

- 搜尋：`https://www.amiami.com/{eng|cn}/search/list/?s_keywords=<JAN>`
- 商品頁：`https://www.amiami.com/{eng|cn}/detail/?gcode=<gcode>`
- 圖片網域為 `img.amiami.com`，路徑結構與 jp 相同，weserv 已驗證可取。

**解析規則目前無法以真實樣本驗證**（實測三）。fixture 以「真實 amiami.com 在正常瀏覽器中渲染後，經 jina 轉成 markdown 應有的樣子」自撰，依據為：以 Chrome 開啟 amiami.com 商品頁觀察的實際文字結構。這一點在 fixture 檔頭明記為「推定樣本」，與 jp 的「實測樣本」區分。未來 amiami.com 恢復可取時，第一件事是以真實回應替換推定樣本。

### D8. UI 呈現

- 錯誤訊息：`amiami.jp 搜尋失敗：…`；聚合錯誤逐行 `amiami.jp：Cloudflare 驗證未通過` / `amiami.com（英文）：網站系統錯誤` / `amiami.com（中文）：…`。
- 進度：`搜尋中（amiami.jp）` → `改試 amiami.com（英文）`。
- 內文面板：規格來自備援站時，標題列加註 `來源：amiami.com 英文站・非日文原文`。
- 站別顯示名稱集中定義一處，UI 與錯誤訊息共用。

## Risks / Trade-offs

- [jina 的 markdown 路徑也可能哪天被擋] → D4 分類 + D6 聚合錯誤會準確說出「三站皆為挑戰頁」，至少不會再變成假的查無；屆時可再回到 explore 評估書籤工具方案（explore 中已討論過其可行性）。
- [markdown 錨點是顯示文字，比 id 脆弱] → 錨點缺席時歸為「解析不到 → 該站失敗」而非零筆；fixture 覆蓋每個錨點。
- [中古判定可能失準] → 中古只影響候選清單的標示，不影響篩選（篩選依「販売停止中」等字樣，已確認存在於連結文字）；實作時補中古樣本。
- [amiami.com 的解析規則是推定的] → 明確標示推定樣本；備援站解析失敗時一樣回報為該站失敗，不會汙染結果。
- [備援讓最壞情況的等待變長] → D5 縮短單站等待，總時間與現況相當。
- [明確零筆也去試備援站，多花請求] → 查無時 jp 回應很快，多兩次請求約 10 秒；換來「jp 未上架但 com 有」的情況也找得到。可接受。

## Migration Plan

- 純前端改動，隨一般 release 部署到 GitHub Pages；無資料遷移。
- 舊的 HTML fixture 與 DOM 解析器一起移除（不並存兩套解析器——並存等於要維護兩倍的錨點）。
- 回滾：revert 該 release 即可，但回滾後 jp 路徑會回到目前不可用的狀態。

## Open Questions

- amiami.com 正常渲染時，規格段落的標題文字確切為何（`Specifications` / `商品式样` 為使用者提供，需以 Chrome 實頁確認大小寫與全形半形）。不影響架構，只影響 fixture 與錨點常數。

## 附錄：實作後的實測（2026-10-01）

**真實網路端到端**（本機 server + Playwright，實際經過 jina / amiami / weserv）：

| JAN | 結果 | 耗時 |
|---|---|---|
| `6979272330921` | 2 筆候選 → 選第一筆，20 張（主圖 + 19 張 review 大圖），製品仕様逐行正確 | 19.7 s（含選擇） |
| `4580416948159` | 兩筆皆「販売停止中」→ 全部保留並標示 → 7 張 | 12.4 s |
| `0000000000000` | jp 明確查無；eng／cn 系統錯誤 → 「查無…（英文站、中文站 無法取得，未能確認）」 | 12.9 s |
| `4560392859120` | 停售那筆被排除，自動匯入 `-R` 中古 → 8 張，商品名帶【中古】 | 15.9 s |

四次皆 0 個直接對 amiami 網域的請求。

**以真實回應驗解析器**：上表各 JAN 的 jp 搜尋／商品頁原始 markdown 直接餵給 `parseSearch` / `parseProduct` / `parseSpec`，結果與預期一致；撰寫當下取得的 7 份 amiami.com 回應，`classify` 全數判為 `shell` 或 `sysError`，無一被當成可解析頁面。

**實作中修正的設計**：jp 搜尋 markdown 不含中古標示（D2 已更新），spec「同商品的重複上架」隨之改為「來源有標示時才標中古，不以代號推測」。
