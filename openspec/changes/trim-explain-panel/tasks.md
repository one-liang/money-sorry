## 1. 擷取層只取規格

- [x] 1.1 `lib/amiami.js` 新增純函式 `parseSpec(doc)`：先以 `#detail_detail__item_spec` 定位規格內文，該 id 不存在時退回 `/仕様/` 的標題比對；兩者皆落空回空陣列
- [x] 1.2 `loadProduct()` 的 `explain` 改由 `parseSpec(doc)` 產生
- [x] 1.3 `parseExplain()` 本身不動，只在註解上說明「挑哪幾段是 `parseSpec` 的事」
- [x] 1.4 `MS.amiami` 匯出加上 `parseSpec`（離線驗證要呼叫得到）

## 2. 面板去掉標題與 .exp-sec

- [x] 2.1 移除 `<h2 id="exp-title">` 與 `expTitle` 參照
- [x] 2.2 移除 CSS `#exp-title`、`.exp-title`、`.exp-sec + .exp-sec`
- [x] 2.3 `#expanel .exphead` 改為 `justify-content: flex-end`，單獨留下的「複製全部」靠右
- [x] 2.4 `renderExplain()` 移除 `solo` 分支與 `.exp-title` 的產生；`.exp-h` / `.exp-b` 直接 append 到 `.exp-item`，不再建 `.exp-sec`
- [x] 2.5 `explainText()` 移除商品名稱那一段（`head`），多商品之間的分隔線保留
- [x] 2.6 `.exp-item + .exp-item` 的分隔線保留——它現在是多商品之間唯一的分界

## 3. ZIP 不再附內文

- [x] 3.1 輸出流程移除 `const txt = explainText()` 與把 `.txt` 推進 `files` 的分支
- [x] 3.2 `out.length === 1 && !txt` 改回 `out.length === 1`，移除「有內文時單張也打包」的例外與其註解
- [x] 3.3 完成訊息移除「＋ 商品說明」
- [x] 3.4 `explainText()` 保留——它仍是「複製全部」的來源

## 4. 移除本頁導覽列

- [x] 4.1 移除 `studio.html` 的 `<nav class="tabs">` 與 `nav.tabs` 三條 CSS
- [x] 4.2 `index.html` 與 `censor.html` 一行不動，兩頁仍連得回 `studio.html`

## 5. 驗證

- [x] 5.1 `tools/verify/amiami.mjs` 新增 `parseSpec` 一節：只回一段、回的是 `製品仕様`、解説不得混入、沒有 id 時走標題退路、`#explain` 缺席回空陣列
- [x] 5.2 `parseExplain` 的既有斷言全部保留（它的行為沒變）
- [x] 5.3 `tools/verify/studio.mjs` `[11f]`：`.txt` 的斷言改為「使用說明不再提到 `.txt`」＋「商品說明的去向有寫」
- [x] 5.4 `[13b]` 注入的假面板去掉 `#exp-title` 與 `.exp-sec`
- [x] 5.5 `[13c]` 改驗「面板不放商品名稱標題」「`.exphead` 只有一個動作」「本頁沒有 `nav.tabs`」
- [x] 5.6 `node tools/verify/amiami.mjs` 全綠（53 passed）
- [x] 5.7 `node tools/verify/studio.mjs` 全綠（180 passed）
- [x] 5.8 手動：截圖確認面板長相、多商品分隔線、頁首拿掉導覽列後沒有塌陷，無 JS 例外

## 6. 文件

- [x] 6.1 `README.md`：導覽列的敘述改為「只有另外兩頁有」
- [x] 6.2 `README.md`：版面示意圖與 ZIP 樹狀圖去掉 `.txt` 與商品名稱標題
- [x] 6.3 `README.md`：說明只取 `製品仕様`、內文不進 ZIP
- [x] 6.4 `README.md`：`amiami.mjs` 的驗證範圍補上 `parseSpec`
