# Tasks

## 1. 查明與實測

- [x] 1.1 重現：jp 搜尋與 jp 商品頁對 `4571623518150` / `FIGURE-209570` 的回應（明確查無、錯誤頁）。驗證：design 實測一
- [x] 1.2 量測 jina 渲染 amiami.com SPA 的成功率與各選項的影響，確認快取會重播失敗頁。驗證：design 實測二
- [x] 1.3 以瀏覽器確認 amiami.com 前端的 API、參數與金鑰送法；測直連、CORS、各代理。驗證：design 實測三
- [x] 1.4 確認 jina `customHeader` 免 key 可用、從 GitHub Pages 發出 CORS 正常、快取不互相汙染。驗證：design 實測四
- [x] 1.5 比對同商品 jp 頁面與 API 欄位，決定規格、標題、圖片、狀態的對應。驗證：design 實測五

## 2. lib/amiami.js

- [x] 2.1 `SITES` 的 eng／cn 改為 API 網址、`via: 'api'`、`specHeading`；常數 `COM_API`／`COM_KEY`／`COM_IMG`。驗證：`amiami.mjs`「代理位址組裝」
- [x] 2.2 `fetchOnce` 對 api 站改 POST ＋ `customHeader`；`fetchPage` 的挑戰頁重抓帶 `x-no-cache`。驗證：`amiami.mjs` 斷言 POST、金鑰、只有重抓那次繞過快取
- [x] 2.3 `classify` 改為 challenge／notFound／page，移除 sysError／shell。驗證：`amiami.mjs`「頁面分類」
- [x] 2.4 新增 `apiJson`、`parseApiSearch`、`parseApiItem`；停售排除抽成 `keepLive`。驗證：`amiami.mjs` 的 API 解析段落
- [x] 2.5 jp 解析器去掉 com 分支（`COM_RESULT_ANCHOR`、`LABELS`、`COM_PREFIX`、`SPEC_HEAD` 的 eng／cn）；`searchByJan`／`loadProduct` 依 `via` 選解析器。驗證：`node tools/verify/amiami.mjs` 全數 ✓

## 3. 驗證腳本與樣本

- [x] 3.1 新增 `api-*` 與 `jp-detail-error.md` 樣本，移除 `com-*` 推定樣本
- [x] 3.2 `amiami.mjs`：假 fetch 支援 POST；新增回報案例的搜尋與商品頁流程、API 挑戰頁重抓、API 錯誤換站、API 請求遇代理限流不換站
- [x] 3.3 `studio-import.mjs`：路由支援 POST 與 CORS 預檢；新增「只在 amiami.com 上架」的畫面驗證（來源標示、日文名、規格、全為帶金鑰的 POST）與「三站明確查無」。驗證：`node tools/verify/studio-import.mjs` 全數 ✓
- [x] 3.4 真實網路端到端（不攔截）：`4571623518150`、`6979272330921`、`0000000000000`。驗證：design 附錄

## 4. 文件

- [x] 4.1 `README.md` 的 JAN 匯入章節：amiami.com 改打 API 的原因與實測、快取與重抓、金鑰失效的訊息與處理、隱私表、驗證說明
- [x] 4.2 `CLAUDE.md` 的 JAN 匯入要點、`studio.html` 的使用說明
