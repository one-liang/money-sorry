## Why

賣場平台不允許露點與過度暴露的商品圖，但美少女公仔的官方宣傳照大量存在這類畫面——真露點、原廠光暈遮蔽、愛心貼紙、比基尼、丁字褲背面。目前要上架只能逐張自己開圖片編輯器拉黑方塊，一個商品 5~20 張圖，量大且容易漏掉，而**漏一張的代價是商品被下架**。

已完成可行性驗證（spike，31 張真實素材）：NudeNet 這類真人照訓練的偵測模型對公仔的泛化程度足以實用，張級召回 29/31（94%），但部位級完整正確僅約 65%，無法純自動。詳細數據與失敗模式見 `design.md`。

## What Changes

- 新增獨立頁面 `censor.html`：選圖 → 自動偵測應遮部位 → 疊黑色方塊 → 批次輸出。視覺風格沿用 `index.html`（cream/amber/brown 色系、左清單右預覽的雙欄佈局）。
- 遮罩判定**不判斷「是否裸露」，只定位解剖部位**。胸部、私處、臀部一律遮，涵蓋 `EXPOSED` 與 `COVERED` 兩組類別——這使得比基尼、薄衣、原廠光暈與貼紙遮蔽的部位都會被納入。
- 偵測結果為**候選**，使用者 MUST 能在預覽上手動新增、移動、刪除黑方塊。自動偵測不是最終結果。
- 針對 spike 實測出的失敗模式建立三道護欄：
  - **幾何補框**：偵測到雙乳卻沒偵測到下體時，依人體比例推算胯部位置強制補框（實測最常見的漏遮型態）。
  - **零命中警告**：整張沒偵測到任何部位時明確警示，MUST NOT 靜默放行。
  - **遮罩面積警示**：遮罩佔比過高時提示該圖遮後可能不堪用（實測特寫照可達 91%）。
- **BREAKING（對專案慣例而言）**：`censor.html` 需要以 `http://localhost` 開啟，無法比照 `index.html` 雙擊使用。模型檔約 12MB，不適合走 base64 內嵌。專案自此有兩種操作模式，README 需明確區分。
- 新增 `serve.cmd` 一鍵起本機靜態站；新增 `vendor/`（onnxruntime-web）與 `models/`（偵測模型）。
- 推論全程在瀏覽器內執行，本機 server 僅供應靜態檔案。照片不離開這台電腦這項承諾不變。

## Capabilities

### New Capabilities

- `nudity-censoring`：裸露部位的偵測、黑方塊遮罩的產生與人工調整、批次輸出，以及偵測不可靠時的警示行為。

### Modified Capabilities

（無。`photo-framing` 的 requirement 完全不變；`censor.html` 與 `index.html` 各自獨立，不共用程式碼也不互相呼叫。）

## Impact

- **新增檔案**
  - `censor.html`：全部的 HTML + CSS + JS（比照 `index.html` 的單檔慣例，但模型與 runtime 外掛）。
  - `vendor/ort.min.js` 與 `ort-wasm-*.wasm`：onnxruntime-web。
  - `models/320n.onnx`：NudeNet detector，約 11.6MB。
  - `serve.cmd`：`npx serve .`。
- **不動的檔案**：`index.html`、`assets/frame.png`、`openspec/specs/photo-framing/`。
- **README**：需新增章節說明兩種開啟方式的差異，以及為何遮罩頁不能雙擊。
- **`.gitignore`**：`models/` 是否進版控需決定（12MB 二進位檔）。
- **驗證**：沿用 `tools/verify/` 既有的 Playwright；測試素材為 `test/`（已被 `.gitignore` 排除，不進版控）。
- **相依**：新增 onnxruntime-web 與 ONNX 模型兩項執行期相依。`index.html` 的零依賴性質不受影響。
- **順序限制**：遮罩 MUST 在套框之前執行。套框會將圖裁成 1000×1000，先套框會使偵測座標與輸出座標不一致。
