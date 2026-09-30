# Proposal

## Why

JAN 匯入目前每一次都失敗在「amiami 的 Cloudflare 驗證沒能在時限內通過」。2026-09-30 實測：經 `r.jina.ai` 以 `x-return-format: html` 抓取 amiami.jp，未曾抓過的網址**一律**回挑戰頁，持續重抓 3 分鐘仍未通過——`add-jan-import` 所依賴的「代理會在背景通關並寫入快取」這個行為已經消失。同一時間、同一批網址改用 jina 的**預設 markdown 格式**，5/5 第一次就拿到真正的內容。問題出在輸出格式的選擇，與 GitHub Pages 無關（本機 curl 結果相同）。

此外，整條匯入目前只有 amiami.jp 一個來源、一種抓法；下次代理或 Cloudflare 行為再變時，使用者只會看到一句不知道是哪裡壞掉的錯誤。

## What Changes

- **BREAKING（內部）** 頁面內容改以 jina 預設的 markdown 格式取得，不再送 `x-return-format: html`；`lib/amiami.js` 的解析函式由「Document → 資料」改為「markdown 字串 → 資料」，仍為純函式。
- 搜尋結果以 markdown 中的 `「<JAN>」の検索結果(N 件)` 錨點界定範圍，排除推薦商品；狀態（販売停止中等）改自連結文字判斷。
- 圖庫大圖改由 markdown 中的 `rthumb/` 縮圖網址推回 `review/` 大圖網址；主圖取 `main/`。
- 製品仕様改以 markdown 的純文字標題行界定（`製品仕様` 至下一個段落標題），換行依 markdown 的行尾還原。
- 新增 **amiami.com 備援**：amiami.jp 取不到資料時，依序改試 `amiami.com/eng/`、`amiami.com/cn/`。備援**以步驟為單位**切換，且利用 `gcode` 三站共用的性質：任一站取得 gcode 後，商品頁仍**優先回 amiami.jp** 取日文原文規格，jp 不可得時才用備援站的內容。
- 備援站取得的規格**不做機器翻譯**，原文呈現並清楚標示來源站與語言。
- 所有失敗訊息標示**站別（jp / eng / cn）與步驟**；備援全數失敗時，逐站列出各自的失敗原因。
- 能辨識 amiami.com SPA 的「System Error Occured」頁（其後端 API 被擋時的呈現），視為該站失敗而非「查無商品」。
- Cloudflare 挑戰頁的辨識保留，改為對 markdown 內容判定；撞到挑戰頁時的處置由「長時間等待重抓」改為「短暫重抓後切換下一站」。

## Capabilities

### New Capabilities
<!-- 無 -->

### Modified Capabilities
- `amiami-import`: 代理取用方式由 HTML 改為 markdown；新增多站備援與步驟級切換；錯誤須標示站別；挑戰頁處置改為有限重抓後切站；規格可能來自備援站時的呈現規則（不翻譯、標示來源）。

## Impact

- `lib/amiami.js`：取用、解析、挑戰頁判定、錯誤結構（新增 `site`）、備援流程全面改寫；對外 API（`searchByJan` / `loadProduct` / `fetchImages`）盡量維持形狀。
- `studio.html`：錯誤訊息組字加入站別；進度顯示可呈現「改試 eng」等切站狀態；內文面板標示規格來源站與語言；候選清單縮圖網址可能來自 `img.amiami.com`。
- `tools/verify/fixtures/`：新增 markdown 版樣本（jp 搜尋／商品頁、挑戰頁、amiami.com 系統錯誤頁、備援站樣本）；HTML 樣本隨舊解析器一併移除。
- `tools/verify/amiami.mjs`：改為餵字串給純函式；新增備援流程的離線驗證（以假的 fetch 模擬各站成敗）。
- `README.md`、頁面使用說明：外部服務與備援的說明更新；隱私界線不變（只送出 JAN 與 amiami 公開網址）。
- 外部相依不變：仍為 `r.jina.ai` 與 `images.weserv.nl`，不新增服務、不需要 API key。
