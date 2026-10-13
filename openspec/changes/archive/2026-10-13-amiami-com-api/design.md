# Design

## Context

動機見 proposal.md。以下是 2026-10-13 的實測，決策都以它為依據。回報案例：JAN `4571623518150`、gcode `FIGURE-209570`（Nachoneko Birthday ver. 1/7，標明不寄送中國與日本）。

### 實測一：amiami.jp 確實沒有這件商品

| 請求 | 結果 |
|---|---|
| jina markdown，jp 搜尋 `s_keywords=4571623518150` | 「検索条件に一致する商品が見つかりませんでした」——明確查無 |
| jina markdown，jp 商品頁 `gcode=FIGURE-209570` | Title `[エラーが発生しました]-amiami.jp-…`，只有導覽與分類縮圖 |

所以 jp 判定為查無是對的，問題全在 com 備援。

### 實測二：經 jina 渲染 amiami.com 頁面不可依賴

| 請求（皆 `x-no-cache`，否則拿到的是快取） | 結果 |
|---|---|
| 預設 | 3–6 秒回「System Error Occured」 |
| `x-user-agent: <一般 Chrome UA>` | 同上 |
| `x-timeout: 30` ＋ `x-wait-for-selector` | 多數 System Error；偶爾約 32 秒後成功 |
| `x-engine: browser`（現在免 key 可用） | System Error |
| `x-respond-timing: network-idle` | System Error |
| `x-detach-invisibles` | 1 次成功、之後 4 次 System Error |
| 合計 | **22 次約成功 4 次**，與選項無關（推測取決於 jina 的出口節點） |
| 不帶 `x-no-cache` | 0.6 秒回快取的 System Error 頁——production 的 com 請求很可能一直拿到這個 |

### 實測三：API 的存取條件

| 請求 | 結果 |
|---|---|
| 瀏覽器在 www.amiami.com 上 `fetch(api, { headers: { 'X-User-Key': 'amiami_dev' } })` | 200，JSON |
| 同上，但從 `https://one-liang.github.io` 發出 | CORS 擋下（預檢無 `Access-Control-Allow-Origin`） |
| 本機 curl，預設 UA ＋ 金鑰 | 403 Cloudflare（UA 被擋） |
| 本機 curl，Chrome UA ＋ 金鑰 | 200 |
| 本機 curl，Chrome UA、無金鑰 | 403「Just a moment...」 |
| jina GET `r.jina.ai/<api 網址>`（無法帶金鑰） | 挑戰頁或 `Invalid access`（10210） |
| jina POST body `injectPageScript` | 401，script injection 需要 API key |
| corsproxy.io | 401，需要 API key |
| amiami.com 前端 JS | 金鑰只以 `X-User-Key` 標頭送出（`callApi(){const n={"X-User-Key":this.apiXUserKey}…}`） |

### 實測四：jina 的 `customHeader`

jina 的 README 沒列，但開源原始碼 `src/dto/crawler-options.ts` 有 `customHeader?: { [k: string]: string }`，於 `src/api/crawler.ts` 傳為 `extraHeaders`。

| 請求 | 結果 |
|---|---|
| `POST r.jina.ai` body `{ url: items?…&s_keywords=4571623518150, customHeader: { X-User-Key } }` | 200，0.9 秒，`RSuccess: true`、1 筆 |
| 同上，`item?gcode=FIGURE-209570&lang=eng` | 200，1.0 秒，含主圖、14 張 `review_images`、`spec`、`sname_simple_j` |
| 同上，`lang=cn` | 200，內容同英文（規格是英文） |
| 先以 GET（無金鑰）抓同一個 API 網址讓挑戰頁進快取，再以 POST + 金鑰抓、不帶 `x-no-cache` | 200 成功——無金鑰的快取不會汙染帶金鑰的請求 |
| 從 `https://one-liang.github.io` 的頁面發出 POST（含 `x-no-cache` 標頭） | 200，1.1–1.4 秒，CORS 正常 |
| 從同一頁發出 jp 的 GET ＋ `x-no-cache` | 200，CORS 正常 |
| 不存在的 gcode | `RSuccess: false`，`RValue.Error[0].ErrorCode = error_code_21` |
| weserv 取 `img.amiami.com/images/product/{main,review}/264/FIGURE-209570*.jpg` | 200 |

jina 回 JSON 時不做 markdown 轉換：`Markdown Content:` 之後就是原始 JSON（含 `<br />` 這類跳脫原樣保留）。

### 實測五：API 欄位與 jp 的對應

同商品 `FIGURE-208923` 比對：

| jp 商品頁 | API |
|---|---|
| `製品仕様` 段落（塗装済み完成品／スケール／サイズ／素材／セット内容一覧） | `item.spec`，逐項對應（英文） |
| `解説` 裡的原型制作等製作人員 | `item.memo`（頁面上的「Details」） |
| `## ` 標題（含【予約】等） | `item.sname`（含 `(Pre-order)`）；`item.sname_simple_j` 為日文名 |
| `main/` 主圖、`rthumb/` → `review/` 圖庫 | `item.main_image_url`、`_embedded.review_images[].image_url`（相對路徑） |
| 搜尋結果的「販売停止中」 | `items[].order_closed_flg === 1`（頁面上的「Order Closed」標籤） |
| （jp 的 markdown 不含中古標示） | `items[].condition_flg`；amiami.com 的中古篩選就是 `s_st_condition_flg` |

amiami.com 搜尋頁自己送出的 API 參數是 `items?pagemax=20&lang=eng&s_keywords=<JAN>`（瀏覽器實測）。

## Goals / Non-Goals

**Goals:**
- 只在 amiami.com 上架的商品能匯入，且不依賴 jina 節點的運氣。
- 維持 `searchByJan` / `loadProduct` 的輸出形狀與既有規則（jp 優先、商品頁先回 jp、同源不混用、代理錯誤不換站、不翻譯）。
- 解析維持純函式、可離線以 fixture 驗證。

**Non-Goals:**
- 不改變備援順序，不讓 com 先於 jp（jp 規格才是日文原文）。
- 不申請 jina API key、不自架代理。
- 不在 jp 搜尋已明確查無時跳過 jp 商品頁——規格說商品頁永遠先回 jp，多一次請求（約 5 秒）可接受。

## Decisions

### D1. amiami.com 打 API，不渲染頁面

`SITES.eng` / `SITES.cn` 帶 `via: 'api'`，`search` / `detail` 產生 API 網址；`fetchOnce` 依 `via` 決定 GET `r.jina.ai/<網址>` 或 POST `r.jina.ai`（body 帶 `customHeader`）。

- 替代方案：jina 渲染 SPA 並加長等待 → 實測二，約 18% 成功率。
- 替代方案：script injection、corsproxy.io → 需要 key。
- 替代方案：書籤工具在 amiami.com 上呼叫 API → 可行但改變互動模式；在 `customHeader` 可用時沒有必要。
- 風險：`customHeader` 是未公開參數，jina 可能移除。屆時 API 會回挑戰頁或 `Invalid access`，被辨識為該站失敗並逐站回報，不會變成假的查無。

### D2. 金鑰

`COM_KEY = 'amiami_dev'`，是 amiami 前端寫死、以 `X-User-Key` 送出的公開值，不是任何帳號的憑證。API 回 `ErrorCode 10210`（Invalid access）時回報 kind `apiKey`「拒絕存取（API 金鑰可能已更換）」，日後只要到前端 JS 找新值替換常數。

### D3. 中文站保留

中文站與英文站是同一個後端，API 回的規格同為英文（`lang` 因此設為 `en`）。保留它的理由：網址不同、不吃同一份 jina 快取，英文站偶發失敗時等於一次自然的重抓；查無時多一個約 1 秒的請求，可接受。規格標題沿用中文站頁面的「商品式样」以示來源。

### D4. 挑戰頁重抓繞過快取

jina 快取一小時（README：`x-no-cache` "bypass the cached page (lifetime 3600s)"），挑戰頁與 System Error 頁也會被快取（實測二最後一列）。`fetchPage` 的同站重抓改帶 `x-no-cache: true`，jp 的 GET 與 API 的 POST 都一樣；第一次請求不帶，保留快取對正常頁面的好處。

### D5. 分類

`classify` 只剩三類：`challenge`（含 api.amiami.com 的挑戰頁）、`notFound`（jp 的「エラーが発生しました」）、`page`。`sysError`、`shell` 只為 SPA 頁面存在，隨 D1 移除。`notFound` 不重抓、直接換站，attempts 訊息為「此站沒有這個商品」。

### D6. API 解析

- `apiJson`：`mdBody` 後 `JSON.parse`；失敗 → `unparsed`；`RSuccess !== true` → `apiKey`（10210）或 `apiError`（附代碼，錯誤可能在 `RValue.ErrorCode` 或 `RValue.Error[0].ErrorCode`）。
- `parseApiSearch`：`items` 非陣列 → `unparsed`；空陣列且 `total_results === 0` → `[]`（明確查無）；空陣列但總數不為 0 → `unparsed`。每筆對應為 `{ gcode, name: gname, price: c_price_taxed 千分位, off: '', thumb: img.amiami.com + thumb_url, status: 'Order Closed' | '', preowned: condition_flg === 1, unavailable: order_closed_flg === 1 }`，去重後套用與 jp 相同的停售排除（抽成 `keepLive`）。
- `parseApiItem`：標題 `sname_simple_j || sname || gname`（使用者選擇日文優先）；圖片 = 主圖 ＋ `review_images`，只收 `/images/product/(main|review)/`、補網域、去重；規格只取 `spec`（`<br>` 還原換行、去行尾空白、空行收斂），`memo` 不收（實測五：它對應 jp 的解説）。

## Risks / Trade-offs

- [`customHeader` 是未公開參數] → 失敗會被辨識並逐站回報；屆時再評估書籤工具方案。
- [金鑰可能被 amiami 更換] → 專屬錯誤訊息 ＋ README／CLAUDE.md 記載替換方式。
- [依賴 amiami 的非公開 API 欄位] → 形狀對不上時一律拋 `unparsed`，不回零筆；fixture 釘住每個用到的欄位。
- [中文站幾乎總是與英文站同結果] → 只在英文站失敗或查無時才多一個約 1 秒的請求。

## Migration Plan

- 純前端改動，隨 release 1.6.1 部署到 GitHub Pages；無資料遷移。
- `com-*` 推定樣本與其斷言一併移除，不並存兩套 com 解析器。
- 回滾：revert 該 release；回滾後 com 備援回到實際上不可用的狀態。

## 附錄：實作後的實測（2026-10-13）

本機 server ＋ Playwright，實際經過 jina／amiami／weserv、不攔截：

| JAN | 結果 | 耗時 |
|---|---|---|
| `4571623518150` | jp 查無 → 英文站 API；jp 商品頁錯誤頁 → 英文站 API；15 張（主圖 ＋ 14 張 review）、規格 Specifications 並標示來源、命名「Nachoneko Birthday ver. 1/7スケールフィギュア」 | 9.1 s |
| `6979272330921` | 仍走 jp：2 筆候選 → 20 張、製品仕様日文，0 個 amiami.com 請求 | 24.5 s（含選擇） |
| `0000000000000` | jp、英文站、中文站皆明確查無 → 「查無 0000000000000 的商品」，不再附「無法取得」 | 12.1 s |
