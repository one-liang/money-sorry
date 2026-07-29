## Context

`money-sorry` 是一個單人自用的本機工具，用途是把商品照批次套上固定的品牌外框後上架賣場。

**外框實測資料**（`assets/frame.png`，1000×1000 RGBA，30KB，84.8% 像素為全透明）：

```
 x=0        524                999
   ┌─────────────┬─────────────┐ y=0
   │ お金でごめん │             │
   │  なさい      │   透明       │
   ├─────────────┘             │ y=89
   │                            │
   │    ▓▓▓ 完全透明視窗 ▓▓▓     │   958 × 804
   │    x 21..978 / y 89..892   │   （唯一保證不被蓋到的矩形）
   │                            │
   ├──────────┐                 │ y=892
   │          │   錢錢抱歉 ◇    │
   └──────────┴─────────────────┘ y=999
   ↑ 四邊各約 20px 不透明條紋
```

兩個角落橫幅為斜切平行四邊形，會覆蓋照片的左上（約 52% × 9%）與右下（約 52% × 11%）。這是外框設計本身的性質，不是需要迴避的缺陷。

**合成管線**：

```
選 N 張照片
     │
     ├─ 逐張序列處理 ────────────────┐
     ▼                              │
 createImageBitmap(file,             │
   { imageOrientation: 'from-image' })│  ← EXIF 修正
     ▼                              │
 canvas 1000×1000                    │
   ① drawImage(照片, cover 置中裁切)   │
   ② drawImage(frame, 0,0,1000,1000)  │  ← 內嵌 base64
     ▼                              │
 toBlob('image/jpeg', 0.92)          │
     ▼                              │
 <a download> 觸發                    │
     ▼                              │
 bitmap.close() 釋放 ←───────────────┘
```

**約束**：單人自用、無需帳號與後端、必須能離線使用、工作區頂層 `~/Desktop/Liang` 有 TCC 限制導致 `node`/`npm` 不便執行。

## Goals / Non-Goals

**Goals:**

- 一次選 N 張照片 → 拿到 N 個 1000×1000 已套框的成品，零額外操作
- 零依賴、零 build step、雙擊即用，且三年後打開仍能運作
- 完全本機處理，照片不離開這台機器

**Non-Goals:**

- 多張照片拼貼成單一版型（樣本成品 `assets/reference/sample-output.jpeg` 僅作風格參考，不是本工具的輸出目標）
- 自由拖拉／縮放／旋轉外框或照片
- 介面上更換外框（外框固定；換框走「重新內嵌 base64」的離線流程）
- HEIC 解碼、上傳、帳號、雲端儲存、行動版最佳化

## Decisions

### 1. 單一 HTML 檔，零依賴、零 build

**選擇**：所有 HTML / CSS / JS 寫在一個 `index.html` 內，不引入任何 npm 套件或 CDN 資源。

**理由**：整個工具約 200 行，引入 build tool 的維護成本高於程式碼本身。無 `node_modules` 就沒有相依過期問題；無 CDN 就能離線使用。同時避開工作區頂層執行 `node`/`npm` 的 TCC 限制。

**替代方案**：Vite + 任一框架 —— 為了 200 行程式碼建立 build pipeline，收益為負。

### 2. 外框以 base64 data URI 內嵌，而非 `<img src="assets/frame.png">`

**選擇**：把 `frame.png` 轉成 `data:image/png;base64,...` 直接寫進 HTML。

**理由**：這是**必要**而非偏好。在 `file://` 協定下，Chrome 將每個本機檔案視為獨立的 opaque origin；用 `<img src="assets/frame.png">` 載入後繪入 canvas 會使 canvas 被 taint，接著 `canvas.toBlob()` 會拋出 `SecurityError`，且錯誤訊息不直觀、極難除錯。使用者選取的照片走 File API（`createImageBitmap(file)`）不會 taint，唯獨外框這個磁碟資產會。

30KB PNG → base64 約 40KB，內嵌後 `index.html` 約 60KB，完全可接受。

**替代方案**：
- 起一個本機 HTTP server（`python3 -m http.server`）—— 破壞「雙擊即用」
- 用 `fetch()` 讀取 —— `file://` 下同樣被 CORS 擋

**代價**：換外框需重新產生 base64 並替換 HTML 中的字串。因外框固定，此代價可接受；換框步驟記在 `README.md`。

### 3. 輸出 JPEG q=0.92，而非 PNG

**選擇**：`canvas.toBlob('image/jpeg', 0.92)`。

**理由**：照片鋪滿整個 1000×1000 底層，成品沒有任何透明區域，PNG 的無損與 alpha 都用不上，檔案卻大約 5 倍。1000×1000 JPEG q0.92 約 150–200KB，符合蝦皮／露天等平台對 1:1 商品圖的規格。

### 4. 打包成單一 ZIP 下載，且 ZIP 自行手寫（store-only）

**選擇**：多張時把全部成品打包成一個 store-only（不壓縮）ZIP，只觸發一次下載；單張時直接給 JPEG，不包 ZIP。

**為什麼不逐檔下載（實測，2026-07-29 macOS）**：最初的實作是逐檔觸發 `<a download>`，中間插一個小延遲。實測發現 **Safari 會靜默丟棄間隔太短的連續程式化下載**，被丟掉的那筆連 `~/Library/Safari/Downloads.plist` 都不會登記——使用者完全收不到任何錯誤。5 連下載落地率：

| 間隔 | 落地 |
|---|---|
| 180ms | 3/5、2/3 |
| 400ms | 4/5 |
| 800ms | 5/5、5/5 |

拉長間隔到 800ms 雖然當下測得過，但那只是**時序啟發式**：機器更慢或圖更大時仍可能重現，而瀏覽器不提供下載結果的回報，JS 無從偵測也無從重試。對一個「批次匯出」工具來說，靜默漏檔是最不可接受的失敗模式——尤其 Safari 正是本工具因 HEIC 而推薦的瀏覽器。單一下載徹底消除這個問題，且 30 張不必空等 24 秒。

**為什麼手寫而不用 JSZip**：JSZip 走 CDN 會破壞離線可用性，內嵌又要多背約 100KB。而 store-only ZIP 只需要 CRC32 表 + local file header + central directory + EOCD，約 100 行純計算，零依賴。

**為什麼不壓縮（method 0 = store）**：成品是 JPEG，已經壓過了，deflate 幾乎省不到空間，卻要多背一個壓縮實作。

**實作要點**：general purpose flag bit 11（`0x0800`）必須設，否則中文檔名在解壓時會亂碼。同名檔案自動加 `-2`、`-3` 序號，否則 ZIP 內會互相覆蓋。

**驗證**：產出的 ZIP 以系統 `unzip -t` 驗過 CRC 與結構（`No errors detected`），並以 macOS 內建解壓器（`ditto -xk`）確認中文檔名正確、每張皆為 1000×1000。Safari 實跑 5 張 → 單一 ZIP，5/5 完整（對照逐檔下載的 3/5）。

> 註：Info-ZIP 的 `unzip` CLI 在列表時不理會 UTF-8 flag，中文檔名會顯示成亂碼；那是該 CLI 的限制，macOS 解壓器與 Finder 均正確。

### 5. 逐張序列處理，而非全部並行

**選擇**：`for` 迴圈搭配 `await`，一張處理完並 `bitmap.close()` 後才處理下一張。

**理由**：30 張 4000×3000 的照片同時解碼約需 1.4GB 記憶體，足以讓分頁崩潰。序列處理的副產品是天然的進度指示。單張處理僅數十毫秒，序列化不造成體感延遲。

### 6. HEIC 不解碼，改為明確提示

**選擇**：偵測到解碼失敗時，該筆標示失敗並提示改用 Safari，其餘檔案照常處理。

**理由**：Safari 可原生解碼 HEIC，Chrome / Firefox 不行。自用工具引入 `heic2any`（約 1MB wasm）不划算，且會使工具無法維持單一檔案形態。「用 Safari 開」是零成本的解法。

### 7. cover 置中裁切，而非 contain 留白

**選擇**：`scale = max(1000/w, 1000/h)`，超出的軸向等量裁除。

**理由**：留白會讓成品出現白邊，破壞外框的視覺完整性。商品照主體通常置中，置中裁切最不容易切到重點。

## Risks / Trade-offs

| 風險 | 緩解 |
|---|---|
| 外框橫幅覆蓋照片左上／右下角，若商品延伸至角落會被吃掉 | 記錄於 README；預覽區讓使用者在輸出前就看見結果並可改選照片 |
| 來源照片短邊 < 1000px 會被放大而略糊（例如 750px 需放大 33%） | README 註明建議素材短邊 ≥ 1000px；不阻擋，仍照常輸出 |
| 打包前所有成品的位元組需同時留在記憶體（30 張約 6MB、100 張約 20MB） | 自用批次量遠小於此，不做串流打包；若日後真要處理數百張，改用 `CompressionStream` 或分批打包 |
| 手寫 ZIP 若有結構錯誤，可能產出「看起來成功但解不開」的檔案 | 不自驗自己的實作——以系統 `unzip -t` 與 macOS `ditto -xk` 外部驗證；spec 內已固定為驗收條件 |
| ZIP 不支援 ZIP64，單檔或總量超過 4GB 會失效 | 1000×1000 JPEG 每張約 50KB，需約 8 萬張才會觸及；不處理 |
| 換外框需手動重產 base64 | README 記錄一行 `base64 -i assets/frame.png` 的換框步驟 |
| 外框若被替換成不同尺寸，寫死的 1000×1000 會失準 | 畫布尺寸與 cover 計算集中為單一常數，換框時只需改一處 |
| `createImageBitmap` 的 `imageOrientation: 'from-image'` 在舊瀏覽器不支援 | 自用情境下瀏覽器為最新版；不做 polyfill |

## Migration Plan

不適用——全新專案，無既有資料或使用者需要遷移。回滾方式為刪除 `money-sorry/` 目錄。

## Open Questions

無。探索階段已就輸出數量（N→N）、裁切對齊（置中）、版型範圍（不做拼貼）定案。
