# Proposal

## Why

使用者在正式站匯入 JAN `4571623518150` 得到「查無 4571623518150 的商品（amiami.com（英文站）、amiami.com（中文站） 無法取得，未能確認）」，但該商品在 amiami.com 英文站與中文站都查得到（`FIGURE-209570`）。這類「只在 amiami.com 上架」的商品並不少見（此例標明不寄送日本），使用者回報「很多時候查詢都有問題」。

2026-10-13 實測查明：**amiami.com 備援自 `amiami-markdown-fetch` 上線以來從未真正成功過。** amiami.com 是 SPA，資料來自 `api.amiami.com`，必須帶 `X-User-Key` 標頭；經 `r.jina.ai` 渲染頁面時，SPA 向 API 要資料多半被擋，頁面只剩「System Error Occured」。當時的 design 已記錄這點，但判斷「jina 不轉送自訂標頭」，所以備援只做了結構。

此次在 jina 的開源原始碼中找到未列在 README 的 `customHeader` body 參數：以 `POST r.jina.ai` 送出 `{ url, customHeader: { 'X-User-Key': … } }`，不需 API key 即可取得 API 的 JSON，約 1 秒，從 GitHub Pages 發出 CORS 正常。

## What Changes

- amiami.com 英文站、中文站**改打 `api.amiami.com` 的 JSON**（搜尋 `items`、商品 `item`），經 jina 的 POST + `customHeader` 取得；不再渲染 amiami.com 的 SPA 頁面。
- 新增 API 的純函式解析器（`parseApiSearch`、`parseApiItem`），輸出與 jp 解析器相同的形狀，`studio.html` 不需改邏輯。停售與中古改依 API 的旗標判斷。
- 移除只為 SPA 頁面存在的分類與解析分支（`sysError`、`shell`、com 的 markdown 錨點、推定樣本 fixture），依「不並存兩套解析器」原則。
- 挑戰頁的同站重抓帶 `x-no-cache`：jina 快取一小時、連挑戰頁也快取，不繞過的話重抓只會重播同一張。
- 辨識 amiami.jp 商品頁的「エラーが発生しました」為「此站沒有這個商品」，讓 attempts 寫出真正原因。
- 來自 amiami.com 的商品名**日文名優先**（API 的 `sname_simple_j`），沒有才用英文名。
- API 回 `Invalid access`（10210）時明確回報「拒絕存取（API 金鑰可能已更換）」，方便日後維護。

## Capabilities

### New Capabilities
<!-- 無 -->

### Modified Capabilities
- `amiami-import`: amiami.com 的取得方式由頁面改為資料 API；挑戰頁重抓須繞過代理快取；jp 商品頁不存在的辨識；備援站商品名日文優先；停售與中古依 API 旗標；規格對應 API 的 `spec` 欄位。

## Impact

- `lib/amiami.js`：`SITES` 的 eng／cn 改為 API 網址並帶 `via: 'api'`；`fetchOnce` 對 api 站改用 POST；`fetchPage` 重抓帶 `x-no-cache`；`classify` 改為 challenge／notFound／page；新增 `apiJson`、`parseApiSearch`、`parseApiItem`；jp 解析器去掉 com 分支。
- `tools/verify/fixtures/`：新增 `api-*`、`jp-detail-error.md`；移除 `com-*` 推定樣本。
- `tools/verify/amiami.mjs`、`tools/verify/studio-import.mjs`：假 fetch／路由支援 POST 與 CORS 預檢，以 API 樣本取代 com 樣本，新增回報案例的流程與畫面驗證。
- `README.md`、`CLAUDE.md`、`studio.html` 使用說明：備援說明與隱私表更新。
- 外部相依不變：仍為 `r.jina.ai` 與 `images.weserv.nl`，不需要 API key；送出的仍只有 JAN、gcode 與 amiami 的公開網址（另附 amiami 前端自己公開使用的 `X-User-Key` 值）。
