## 1. 兩層述詞

- [x] 1.1 `decodable = it => it.status === 'ready'`；`outputtable = it => decodable(it) && it.pickOn`
- [x] 1.2 `plan()`、`updateGo()` 的張數與含遮罩、漏遮警示 → `outputtable`
- [x] 1.3 `syncBulk()` 三列的分母、`bulkSet()` 的作用域 → `decodable`
- [x] 1.4 改寫原本「四處共用同一個集合」的註解為兩層的說法
- [x] 1.5 item 加 `pickOn: true`、`pickEl: null`；typedef 補一行

## 2. 逐張的核取方塊

- [x] 2.1 `.lead` 最前面插入 `<button class="pick" role="checkbox">`，內含 check 圖示
- [x] 2.2 class 不得用 `.chip.frame` / `.chip.censor`（既有測試以此計數）
- [x] 2.3 命中區 `::before { inset: -12px }` 撐到 ≥44×44，比照 `.grip`
- [x] 2.4 click 加 `stopPropagation()`，避免順便切換預覽
- [x] 2.5 `disabled = !decodable(item)`
- [x] 2.6 狀態由 `markRow()` 從 `item.pickOn` 同步，**不得只在 render() 寫死**
- [x] 2.7 `togglePick()`：clearUndo → renumber → syncPreview → updateGo，**不清 cache**

## 3. 未選取的呈現

- [x] 3.1 `li.off` 淡化縮圖／meta／晶片，與 `.sel` 疊加時另有底色
- [x] 3.2 tags 補「不下載」badge
- [x] 3.3 aria-label 分成「未勾選下載」與「不會輸出」
- [x] 3.4 `updateDetail()` 在未選取時明講不會輸出

## 4. 一鍵「下載」列

- [x] 4.1 HTML 插在套框列之前；`bulkBtns` / `bulkCount` 補 `pickOn` / `pickOff`
- [x] 4.2 `syncBulk()` 的 key→前綴改為明確映射表 `BULK_KEYS`（原本的三元式會把 pickOn 算成 censor）
- [x] 4.3 `bulkSet()` 在 `pickOn` 時不清 cache
- [x] 4.4 `bulkSet()` 開頭 `clearUndo()`；「全不選」不提供復原
- [x] 4.5 `.seg button` 加 `min-width` 並收窄內距，讓三列的分段控制左右對齊

## 5. 偵測與輸出

- [x] 5.1 `runDetections()` 維持不過濾（過濾會製造漏遮路徑）
- [x] 5.2 偵測結束的統計只計 `outputtable`
- [x] 5.3 `updateGo()` 在無選取時顯示「未勾選任何照片」，與「沒有可輸出的照片」區分

## 6. 版面清理

- [x] 6.1 移除 `#imp-note`（HTML ＋ CSS）
- [x] 6.2 移除 `#exp-note`（HTML ＋ CSS ＋ `syncExpNote()` ＋ 三個呼叫點 ＋ 元素參照）
- [x] 6.3 兩段內容改寫進 `<details class="notes">`，並修正「照片不會上傳」那句與匯入的但書
- [x] 6.4 使用說明補上核取方塊與固定分母的說明
- [x] 6.5 `#expanel { margin-top: 22px }`（沿用 `.notes` 的既有值）

## 7. 驗證

- [x] 7.1 `tools/verify/studio.mjs` 新增 [11]～[11f] 六組測試
- [x] 7.2 [11c] 追加檔案不得還原已取消的勾選
- [x] 7.3 [11d] 取消再勾回來，遮罩框仍在
- [x] 7.4 [11e] 一鍵動作撤掉復原提議
- [x] 7.5 既有 87 項全綠，三條逐位元不變量未受影響
- [x] 7.6 端到端：匯入 11 張 → 取消 3 張 → ZIP 內 8 張、序號 1–8 連號、`.txt` 仍在
- [x] 7.7 視覺確認：列高未變、三列分段控制對齊、`#expanel` 間距 22px

## 8. 文件

- [x] 8.1 `README.md` 一鍵區示意圖改為三列
- [x] 8.2 `README.md` 說明選取行為與固定分母的理由
