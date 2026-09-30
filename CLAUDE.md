# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

賣場商品照的批次處理工具：套上「お金でごめんなさい / 錢錢抱歉」外框（輸出 1000×1000 JPEG）、以 NudeNet ONNX 模型自動遮罩公仔照的裸露部位、並可貼 JANコード 從 amiami 匯入素材。**純靜態網頁，沒有 build、沒有 bundler、沒有 npm 依賴**（唯一的 `package.json` 在 `tools/verify/`，只為了 Playwright）。部署在 GitHub Pages（`main` 分支根目錄，`.nojekyll`）。

使用者層面的完整說明在 `README.md`，改動行為時要一併更新它——README 是這個專案的主要文件，寫得很細。

## 常用指令

```bash
# 本機起 server（studio.html / censor.html 必須走 http://，file:// 會擋掉模型載入）
npx serve . -l 3000          # 或雙擊 serve.cmd；開 http://localhost:3000/studio.html

# 自動驗證（第一次要先裝）
cd tools/verify && npm install && npx playwright install chromium-headless-shell && cd ../..

node tools/verify/studio.mjs           # 整合頁；含三個逐位元不變量
node tools/verify/censor.mjs           # 遮罩頁
node tools/verify/preview-adjust.mjs   # index.html 的手動構圖調整；基準取自 git tag v1.2.0
node tools/verify/amiami.mjs           # JAN 匯入的解析純函式與備援流程，離線、只用 fixtures/
node tools/verify/studio-import.mjs    # JAN 匯入的畫面，攔截 jina/weserv，不需 test/
```

- 驗證腳本會自己起靜態 server（各自固定 port），不需要先跑 `serve.cmd`。
- `studio.mjs` / `censor.mjs` / `preview-adjust.mjs` 可帶一個參數指定測試圖資料夾，預設吃 `test/`——該資料夾被 `.gitignore` 排除（素材不公開），新環境裡可能不存在，需要自備圖片。
- 產出存到 `tools/verify/out/`。Playwright 驗不了「遮罩位置對不對」，那部分需要人眼看 ZIP。
- 沒有 lint、沒有單元測試框架；每支 `.mjs` 就是一個完整的測試腳本，以 `✓/✗` 輸出並計數。

## 架構

### 三個頁面，一條刻意劃出的界線

| 頁面 | 角色 | 限制 |
|---|---|---|
| `studio.html` | 主力頁：遮罩＋套框＋JAN 匯入，是另外兩頁的超集 | 需要 http:// |
| `index.html` | 只套框 | **必須維持雙擊（`file://`）即用、可單檔寄出** |
| `censor.html` | 只遮罩 | 需要 http:// |

每頁都是單一 HTML 檔，CSS 與 JS 直接寫在裡面。由此衍生的規則：

- **`index.html` 不得引用 `lib/` 或任何外部檔案。** 它有自己內嵌的一份 ZIP 實作，外框是 `FRAME_DATA_URI` 的 base64（`file://` 下讀磁碟上的 PNG 會 taint canvas，`toBlob` 拋 `SecurityError`）。
- `studio.html` 直接讀 `assets/frame.png`。**換外框時兩處都要換**，且必須是同一張圖，否則 `studio.mjs` 的不變量會失敗。
- `lib/*.js` 是 **classic script、不是 ES module**（引入 module 等於引入 build 步驟），以 IIFE 掛在全域 `window.MS` 命名空間下（`MS.amiami`、zip 相關函式）。
- `models/320n.onnx` 與 `vendor/`（onnxruntime-web）刻意進版控；ORT 在 studio 中是**第一次打開遮罩開關時才動態載入**，只套框的流程全程不下載模型（有驗證釘著）。推論固定 `numThreads = 1`，不需要 COOP/COEP。

### 行為不變量（改動前要知道的）

`studio.mjs` 以兩個現役頁面為基準做逐位元比對，所以改 `studio.html` 的合成路徑時要保持：

- 套框開・遮罩關 → 輸出 SHA-256 等於 `index.html`
- 套框關・遮罩開 → 輸出 SHA-256 等於 `censor.html`
- 兩者皆關 → 原檔位元組原樣轉存
- 處理順序固定為**先遮罩、再套框**，且全程只做一次 JPEG 編碼（`toBlob('image/jpeg', 0.92)`）

`preview-adjust.mjs` 則要求 `index.html` 對沒動過構圖的照片，輸出與 `v1.2.0` 逐位元相同。

### 套框管線

`createImageBitmap(file, { imageOrientation: 'from-image' })` → 偵測並去除單軸純色留白邊（保守判定，寧可不裁）→ 1000×1000 canvas：白底 → 內容 cover 置中裁切（可手動拖曳/縮放覆寫）→ 疊外框 → JPEG。多張打包成手寫 store-only ZIP 單次下載（Safari 會靜默丟棄連續程式化下載）。

### 遮罩

定位解剖部位而非判斷「露不露」。私處召回偏弱，所以有**幾何補框**（有兩個胸部框、沒下體框時依比例推算並強制補框，以黃色虛線標示）。取捨原則是**漏遮會被下架，多遮只是醜**——任何會減少遮罩的改動都要有守護（例如一鍵關閉全部遮罩有「復原」）。

### JAN 匯入（`lib/amiami.js`）

經兩個外部代理：`r.jina.ai`（穿過 amiami 的 Cloudflare）與 `images.weserv.nl`（補 CORS，避免 canvas 被汙染）。要點：

- jina **一律用預設的 markdown 格式**，不可送 `x-return-format: html`——實測 html 格式對未抓過的網址只拿得到驗證頁，markdown 第一次就成功（依據見 `amiami-markdown-fetch` 的 design.md）。
- 解析函式（`classify` / `parseSearch` / `parseProduct` / `parseSpec` …）是 **markdown 字串 → 資料的純函式**，靠顯示文字當錨點（`の検索結果(N 件)`、`製品仕様`…），才能用 `tools/verify/fixtures/` 的自撰樣本離線驗證。錨點缺席時**拋錯，不可回傳零筆**（會變成假的「查無商品」）。新增解析規則時要加對應的 fixture 與檢查。
- 三站備援 jp → amiami.com/eng → /cn，站別集中定義在 `SITES`。搜尋在任一站成功後，商品頁**永遠先回 jp**（gcode 三站共用，只有 jp 規格是日文原文）；圖片、名稱、規格取自同一頁；備援站規格不翻譯、UI 要標示來源。com 的 fixture 是推定樣本（撰寫當下 com 後端被擋）。
- Cloudflare 驗證頁要辨識；同站短重抓一次後換站。**代理本身**限流／5xx／連不上時直接停止、不換站；限流與錯誤不重試，圖片下載完全不重試。
- 失敗一律拋出帶 `stage` 與 `site`（`jp`/`eng`/`cn`/`proxy`/`all`）的錯誤讓 UI 明確呈現，全站失敗帶逐站 `attempts`，不可靜默回傳空結果。
- 同商品多筆上架時依**狀態**（販売停止中／中古）篩選，不可依 `gcode` 的 `-R` 尾碼判斷。
- 除了 JAN 與 amiami 公開網址，任何使用者資料都不得離開瀏覽器。

## 開發流程

- **OpenSpec（spec-driven）**：主規格在 `openspec/specs/`（`photo-framing`、`nudity-censoring`、`unified-studio`、`amiami-import`），每次變更的 proposal / design / tasks 在 `openspec/changes/`，完成後封存到 `openspec/changes/archive/<日期>-<名稱>/`。設計決策與實測數據多半記在封存的 `design.md` 裡。可用 `/opsx:propose`、`/opsx:apply`、`/opsx:archive`、`/opsx:explore`。
- **Git flow**：`feature/*` → `develop` → `release/x.y.z` → `main`（打 tag `vX.Y.Z`）。
- **Commit 訊息**：Conventional Commits、描述用繁體中文，scope 常見 `studio`、`preview`、`ui`、`verify`、`openspec`，例如 `feat(studio): 貼 JAN 匯入 amiami 素材`、`docs(openspec): 封存 trim-explain-panel`。
- 文件、註解、UI 文案皆為繁體中文；程式碼註解傾向解釋「為什麼」與實測依據。
