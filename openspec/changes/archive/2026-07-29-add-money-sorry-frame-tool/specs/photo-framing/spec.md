## ADDED Requirements

### Requirement: 多檔選取

工具 SHALL 允許使用者透過單一 `<input type="file" multiple>` 一次選取一至多張本機圖片檔案，並在介面上以縮圖列出已選取的檔案。工具 MUST NOT 上傳任何檔案至遠端。

#### Scenario: 一次選取多張照片

- **WHEN** 使用者透過檔案選擇器選取 5 張圖片
- **THEN** 介面顯示 5 張縮圖與檔名，並顯示「將產出 5 個檔案」之類的數量提示

#### Scenario: 只選取一張照片

- **WHEN** 使用者只選取 1 張圖片
- **THEN** 工具正常處理並產出 1 個成品檔，不需任何額外操作

#### Scenario: 重新選取覆蓋前次選取

- **WHEN** 使用者已選取 3 張後，再次開啟檔案選擇器並選取 2 張
- **THEN** 清單顯示最新的 2 張，前次的 3 張不再被處理

### Requirement: cover 置中裁切

工具 SHALL 將每張來源照片以 cover 規則縮放後置中裁切，填滿 1000×1000 的正方形畫布，不留白邊、不變形。縮放倍率 MUST 取 `max(1000 / 原始寬, 1000 / 原始高)`，裁切 MUST 在超出的軸向上左右（或上下）等量裁除。

#### Scenario: 橫向照片

- **WHEN** 來源照片為 836×750（寬高比 > 1）
- **THEN** 縮放倍率為 `max(1000/836, 1000/750) = 1.333`，縮放後為 1114×1000，左右各裁去 57px，輸出 1000×1000

#### Scenario: 直向照片

- **WHEN** 來源照片為 750×1000（寬高比 < 1）
- **THEN** 縮放倍率為 `max(1000/750, 1000/1000) = 1.333`，縮放後為 1000×1333，上下各裁去約 167px，輸出 1000×1000

#### Scenario: 已是正方形的照片

- **WHEN** 來源照片為 2000×2000
- **THEN** 等比縮小為 1000×1000，不進行任何裁切

#### Scenario: 小於目標尺寸的照片

- **WHEN** 來源照片短邊小於 1000px
- **THEN** 工具仍照常放大處理並輸出，不因此拒絕該檔案

### Requirement: 外框疊合

工具 SHALL 在照片繪製完成後，將固定外框以 `drawImage(frame, 0, 0, 1000, 1000)` 整張疊於畫布最上層。外框 MUST 以 base64 data URI 內嵌於 HTML 檔內，MUST NOT 透過相對路徑的 `<img src>` 或 `fetch` 從磁碟載入。

#### Scenario: 繪製順序

- **WHEN** 工具合成任一張成品
- **THEN** 先繪製裁切後的照片、再繪製外框，使外框的邊條與兩個角落橫幅覆蓋於照片之上

#### Scenario: 以 file:// 協定開啟時仍可匯出

- **WHEN** 使用者以雙擊方式（`file://` 協定）開啟 `index.html` 並執行合成
- **THEN** `canvas.toBlob()` 正常回傳 Blob，不因 cross-origin taint 而拋出 SecurityError

### Requirement: EXIF 方向修正

工具 SHALL 在解碼影像時套用來源檔案的 EXIF 方向資訊，使手機直拍的照片不會以側躺方向被合成。

#### Scenario: 帶有 EXIF orientation 的手機照片

- **WHEN** 使用者選取一張 EXIF orientation 為 6（需順時針旋轉 90°）的手機照片
- **THEN** 成品中的照片為正立方向，而非側躺

### Requirement: 即時預覽

工具 SHALL 在使用者選取照片後、正式輸出前，於畫面上顯示第一張照片的合成結果作為預覽。

#### Scenario: 選取後立即預覽

- **WHEN** 使用者完成檔案選取
- **THEN** 預覽區在不需按下任何按鈕的情況下顯示第一張照片套框後的結果

#### Scenario: 未選取任何檔案

- **WHEN** 尚未選取任何檔案
- **THEN** 預覽區顯示提示文字或空的外框輪廓，且輸出按鈕為停用狀態

### Requirement: 批次輸出與下載

工具 SHALL 依序處理每一張已選取的照片，將結果以 JPEG（品質 0.92）輸出。成品檔名 MUST 為來源檔名（去除副檔名）加上 `-money-sorry.jpg` 後綴。處理期間 SHALL 顯示進度。

輸出**多張**時，工具 MUST 將全部成品打包成**單一 ZIP** 並只觸發一次下載；MUST NOT 逐檔觸發多次下載（Safari 會靜默丟棄間隔過短的連續程式化下載）。輸出**單張**時 MUST 直接下載該 JPEG，不包 ZIP。

#### Scenario: 多張打包成單一 ZIP

- **WHEN** 使用者選取 3 張照片並按下輸出
- **THEN** 瀏覽器只觸發 **1 次**下載，內容為一個包含 3 個 JPEG 的 ZIP，每個皆為 1000×1000 且已套框
- **AND** ZIP 檔名為 `money-sorry-<YYYYMMDD>-<HHMM>.zip`

#### Scenario: 單張不打包

- **WHEN** 使用者只選取 1 張照片並按下輸出
- **THEN** 直接下載該 JPEG 檔本身，不產生 ZIP

#### Scenario: 檔名規則

- **WHEN** 來源檔名為 `nendoroid-front.webp`
- **THEN** 輸出檔名為 `nendoroid-front-money-sorry.jpg`

#### Scenario: 顯示進度

- **WHEN** 批次處理進行中
- **THEN** 介面顯示目前進度（例如「處理中 2 / 3」），並在全部完成後顯示完成訊息

### Requirement: ZIP 打包格式

工具 SHALL 以自行實作的 store-only（不壓縮，method 0）ZIP 打包成品，不得引入外部函式庫。產出的 ZIP MUST 能被 `unzip -t` 驗證通過，並能被 macOS 內建解壓器正確解開。

#### Scenario: ZIP 結構有效

- **WHEN** 產生包含多個成品的 ZIP
- **THEN** `unzip -t` 回報 `No errors detected`，每筆的 CRC32 皆正確

#### Scenario: 中文檔名不亂碼

- **WHEN** 來源檔名含中文（例如 `商品照 A.png`）
- **THEN** ZIP 內的檔名以 UTF-8 儲存並設定 general purpose flag bit 11，macOS 解壓後顯示為正確的中文檔名

#### Scenario: 同名檔案不互相覆蓋

- **WHEN** 使用者選取兩個檔名相同的照片（例如來自不同資料夾的兩個 `商品照 A.png`）
- **THEN** ZIP 內第二筆自動更名為 `商品照 A-money-sorry-2.jpg`，兩筆皆完整保留

### Requirement: 部分失敗仍可輸出

當批次中有部分檔案無法處理時，工具 SHALL 將成功的部分照常打包輸出，並於介面標示失敗的筆數與原因。

#### Scenario: 4 張中有 1 張無法解碼

- **WHEN** 使用者選取 3 張正常照片與 1 張無法解碼的檔案並按下輸出
- **THEN** ZIP 內含 3 個成品，介面顯示「3 張已打包，1 個失敗」並標示該筆的失敗原因

### Requirement: 記憶體控管

工具 SHALL 逐張序列處理照片，且每張處理完成後 MUST 立即釋放該張的 ImageBitmap 與 object URL，避免一次選取大量高解析度照片時耗盡分頁記憶體。

#### Scenario: 大量高解析度照片

- **WHEN** 使用者一次選取 30 張 4000×3000 的照片
- **THEN** 工具逐張處理並全部完成，分頁不因記憶體耗盡而崩潰

### Requirement: 不支援格式的錯誤處理

當瀏覽器無法解碼某個來源檔案（例如 Chrome 下的 HEIC）時，工具 SHALL 跳過該檔並在介面上標示原因，且 MUST 繼續處理其餘檔案，MUST NOT 中止整批作業。

#### Scenario: 混入無法解碼的 HEIC

- **WHEN** 使用者在 Chrome 中選取 3 張 JPEG 與 1 張 HEIC 並按下輸出
- **THEN** 3 個 JPEG 成品正常下載，HEIC 該筆在清單上標示為失敗並提示「此瀏覽器無法解碼 HEIC，請改用 Safari 開啟」

#### Scenario: 選取了非圖片檔案

- **WHEN** 使用者選取了一個非圖片檔案
- **THEN** 該檔被標示為失敗並附上原因，其餘檔案照常處理
