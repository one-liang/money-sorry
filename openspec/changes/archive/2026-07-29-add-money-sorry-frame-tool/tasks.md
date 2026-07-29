## 1. 資產準備

- [x] 1.1 確認 `assets/frame.png` 存在且為 1000×1000 RGBA
- [x] 1.2 產生外框的 base64 data URI（`base64 -i assets/frame.png`），供內嵌使用

## 2. 骨架與介面

- [x] 2.1 建立 `index.html` 骨架：單一檔案，內含 `<style>` 與 `<script>`，無外部資源
- [x] 2.2 實作介面版面：檔案選取區、已選檔案縮圖清單、預覽區、輸出按鈕、進度／狀態列
- [x] 2.3 實作 `<input type="file" multiple accept="image/*">` 選取，並在清單顯示縮圖與檔名
- [x] 2.4 重新選取時清空前次清單與其 object URL
- [x] 2.5 未選取任何檔案時，輸出按鈕維持停用狀態

## 3. 合成核心

- [x] 3.1 將外框 base64 內嵌並在載入時解碼為 ImageBitmap，快取供所有合成重複使用
- [x] 3.2 實作 cover 置中裁切計算：`scale = max(1000/w, 1000/h)`，回傳來源裁切矩形
- [x] 3.3 實作單張合成函式：建立 1000×1000 canvas → 繪製裁切後照片 → 疊上外框 → 回傳 Blob
- [x] 3.4 解碼時帶入 `{ imageOrientation: 'from-image' }` 以套用 EXIF 方向
- [x] 3.5 每張處理完成後呼叫 `bitmap.close()` 並釋放 object URL

## 4. 預覽與輸出

- [x] 4.1 選取檔案後自動合成第一張並顯示於預覽區
- [x] 4.2 實作批次輸出：序列處理每張照片，逐檔以 `<a download>` 觸發下載
- [x] 4.3 實作檔名規則：來源檔名去副檔名 + `-money-sorry.jpg`
- [x] 4.4 輸出格式固定為 `image/jpeg`、品質 0.92
- [x] 4.5 處理期間顯示進度（目前第幾張 / 共幾張），完成後顯示完成訊息

## 5. 錯誤處理

- [x] 5.1 單張解碼或合成失敗時捕捉例外，於清單標示該筆失敗與原因，不中斷整批
- [x] 5.2 偵測 HEIC／解碼失敗時，提示「此瀏覽器無法解碼 HEIC，請改用 Safari 開啟」
- [x] 5.3 全部失敗時顯示彙總訊息，而非靜默無回應

## 6. 驗證

- [x] 6.1 以 `assets/reference/sample-photo.webp`（836×750 橫向）驗證：輸出 1000×1000，左右各裁 57px
- [x] 6.2 以直向照片驗證：上下等量裁切，成品無變形無白邊
- [x] 6.3 以 `file://` 雙擊開啟驗證 `toBlob()` 不拋 SecurityError
- [x] 6.4 一次選取多張驗證批次下載與檔名規則正確
- [x] 6.5 於 Safari 實跑一次，確認行為與 Chrome 一致，並確認 HEIC 可正常解碼（Chrome 側已驗證）

## 8. Safari 驗證後的修正

- [x] 8.1 修正 Safari 靜默丟棄連續下載：下載間隔 180ms → 800ms（`DOWNLOAD_GAP_MS`），最後一張不再多等
- [x] 8.2 完成訊息改為「已觸發 N 個下載，請核對數量」，不宣稱下載成功
- [x] 8.3 於介面與 README 標註須核對下載檔案數量
- [x] 8.4 Chrome 回歸測試：間隔實測 826ms、成品仍為 1000×1000、HEIC 失敗處理不變

## 9. 改為單一 ZIP 下載（根治時序問題）

- [x] 9.1 實作 CRC32 表與 `crc32()`
- [x] 9.2 實作 store-only ZIP 寫入器：local file header + central directory + EOCD
- [x] 9.3 設定 general purpose flag bit 11（UTF-8 檔名），確保中文檔名不亂碼
- [x] 9.4 實作同名檔案去重（`-2`、`-3` 序號）
- [x] 9.5 ZIP 檔名規則 `money-sorry-<YYYYMMDD>-<HHMM>.zip`
- [x] 9.6 改寫批次流程：全部合成 → 打包 → 單次下載；單張則直接下載 JPG
- [x] 9.7 移除 `DOWNLOAD_GAP_MS` 與逐檔下載邏輯，更新按鈕文案與介面說明
- [x] 9.8 以系統 `unzip -t` 外部驗證 ZIP 結構與 CRC（`No errors detected`）
- [x] 9.9 以 macOS `ditto -xk` 驗證中文檔名正確、解出的每張皆為 1000×1000
- [x] 9.10 Chrome 驗證：4 張含 1 張失敗 → ZIP 內 3 筆、同名自動 `-2`、單張路徑給 JPG
- [x] 9.11 Safari 驗證：5 張 → 單一 ZIP 5/5 完整落地（對照逐檔下載為 3/5）

## 7. 文件

- [x] 7.1 撰寫 `README.md`：用途、使用方式、瀏覽器建議
- [x] 7.2 於 README 記錄換外框步驟（重新產生並替換 base64 字串）
- [x] 7.3 於 README 記錄兩個已知限制：外框橫幅會覆蓋左上／右下角、建議素材短邊 ≥ 1000px
