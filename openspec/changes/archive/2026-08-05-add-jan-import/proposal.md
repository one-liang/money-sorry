## Why

上架一件日系商品，素材永遠來自同一個地方：商品頁的官方照片與規格文字。現在的流程是人工的——開 amiami 商品頁、對著 11 張圖右鍵另存 11 次、再把說明文字分兩段複製貼上，然後才開始 `studio.html` 的遮罩與套框。工具接手的是整條流程的後半段，前半段的苦工完全沒被碰到。

把前半段也接進來：貼一個 JAN 代碼，圖片直接進清單、文字直接備好，接上既有的一鍵套框與一鍵遮罩。

技術上這件事一度看起來不可能，因為 amiami 有三道牆，已逐一實測：

| 牆 | 實測結果 |
|---|---|
| CORS | `img.amiami.jp` 不發 `Access-Control-Allow-Origin`；`crossOrigin="anonymous"` 載入失敗 |
| Cloudflare | 商品頁與圖片 CDN 皆回 `403` / `429 cf-mitigated: challenge`，帶完整瀏覽器標頭仍然被擋 |
| canvas 汙染 | 圖片能以 `<img>` 顯示，但 `drawImage` 後 `toDataURL()` 拋 `SecurityError` |

第三道牆是致命的：`studio.html` 的合成管線是 `File → createImageBitmap → canvas → toBlob`，它要的是**位元組**，而以上三道牆合起來的結論是「網頁拿得到網址，拿不到位元組」。

出路是兩個公用代理，已經以 demo 端到端驗證：`r.jina.ai` 內部跑 headless browser 穿過 Cloudflare 並回應 CORS 標頭，`images.weserv.nl` 以 `access-control-allow-origin: *` 重新提供圖片位元組，因而 canvas 不再被汙染。實測一次 JAN 匯入 **12.1 秒**、11/11 張成功、11/11 張 `toBlob` 通過。

代價是專案第一次有了外部服務相依。這個代價是明碼標價的：兩個服務都是免費公共服務，都可能限流、改政策或消失。因此匯入失敗 MUST 是明確可見的錯誤而非靜默失敗，且 MUST NOT 影響 `studio.html` 既有的任何本機功能。

## What Changes

- **新增 `amiami-import` 能力**：在 `studio.html` 左欄新增「從 JAN 匯入」區塊，輸入 JANコード 後自動完成搜尋、擷取、下載三步
- **JAN → 商品**：以 `r.jina.ai` 取得 amiami 搜尋頁，從 `#search_table .product_box` 取出 `gcode`。0 筆為明確錯誤，多筆時由使用者選擇，MUST NOT 自行猜測
- **圖片匯入**：商品頁的 `[data-main-image]`（主圖）與 `[data-item-image]`（圖庫）合為一組，逐張經 `images.weserv.nl` 取得位元組，包成 `File` 後走**既有的 `accept()` 入口**追加到清單
- **因此一鍵套框與一鍵遮罩自動適用**：匯入的項目與選檔加入的項目在資料結構上沒有差別，既有的雙開關、一鍵區、拖曳排序、輸出命名、序號、ZIP 打包全部原樣繼承，MUST NOT 為匯入項目另闢一套路徑
- **內文擷取**：取 `#explain` 的子區塊，排除 `.hashtag-container`；`<br>` MUST 還原為換行，否則規格會黏成一長串。文字**原樣保留日文**，不翻譯
- **內文兩個落點**：（A）頁面上的可複製面板；（B）ZIP 內的 `.txt`，檔名跟隨輸出命名
- **商品名**：清除 `-amiami.jp-…` 站名後綴後，可一鍵填入「輸出命名」欄位
- **隱私界線**：匯入會向第三方發出請求，送出的只有 JAN 與 amiami 的公開網址。**使用者自己的照片仍然完全不離開瀏覽器**，此界線 MUST 在 UI 與 README 明確說明

非目標：不修改 `index.html`；不改變 `censor.html` 的任何可觀察行為；不新增 build 步驟、不新增後端、不新增瀏覽器擴充；不做翻譯；不支援 amiami 以外的來源；不做「拖入已存網頁資料夾」的離線備援（留待相依真的出問題時再議）。

## Capabilities

### New Capabilities
- `amiami-import`: 由 JAN 代碼匯入 amiami 商品素材的完整行為——搜尋與歧義處理、圖片位元組取得與入列、內文擷取規則、外部相依的失敗處理與隱私界線

### Modified Capabilities
- `unified-studio`: 「輸出命名與資料夾結構」需擴充——ZIP 內除既有圖片外多一個內文 `.txt`，且「輸出單張時不打包」的規則在存在內文時需要讓步（否則文字無處可去）

`photo-framing` 與 `nudity-censoring` 不修改。匯入項目進入清單後與選檔項目完全同構，兩者的既有需求繼續且僅描述 `index.html` 與 `censor.html`。

## Impact

- **修改**：`studio.html`（新增匯入區塊、內文面板、`.txt` 打包）、`README.md`（使用方式與隱私說明）
- **新增**：`lib/amiami.js`（搜尋、解析、取圖，與 UI 分離以便驗證）
- **不變**：`index.html`、`censor.html`、`models/`、`vendor/`、既有的四格輸出矩陣與逐位元不變量
- **相依**：`r.jina.ai`（需 `x-return-format: html`，preflight 已確認 `access-control-allow-headers: x-return-format`）、`images.weserv.nl`。兩者皆為免費公共服務，皆無帳號需求
- **風險**：外部服務為單點故障。緩解為「失敗時明確報錯並保留既有清單」，而非重試或退回靜默狀態
- **驗證**：解析邏輯（搜尋結果擷取、圖片清單組成、`#explain` 擷取與 `<br>` 還原）可對固定的 HTML 樣本離線驗證，不需要每次跑真實網路請求
