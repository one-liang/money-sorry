## 1. 留白邊偵測

- [x] 1.1 新增 `scanCanvas(bmp)`：把 ImageBitmap 繪到最長邊 ≤ 512 的離屏 canvas，回傳 `{ data, w, h, scale }`（單次 `getImageData`）
- [x] 1.2 新增 `sampleCorners(scan)`：四角各取 5×5 中位數，回傳四個 RGB
- [x] 1.3 新增 `bgColorOf(corners)`：套用淺色閘門（亮度 ≥ 215）與一致性閘門（通道最大差 ≤ 12），不通過回傳 `null`
- [x] 1.4 新增 `scanMargins(scan, bg)`：以「整列／整行全為背景」由外往內掃出上下左右四個留白厚度（背景判定：每通道差 ≤ 12 或 alpha < 8）
- [x] 1.5 新增 `trimRect(bmp)`：串起 1.1~1.4，套用軸向規則（左右皆 ≥3% 且上下 <3% → 只裁左右；反之只裁上下；四邊皆有或其他組合 → 不裁），換算回原始像素時向外放寬 2 個掃描像素，回傳 `{ x, y, w, h, trimmed }`
- [x] 1.6 補上退化保護：全圖皆背景、或裁切後寬高 ≤ 0 時退回不裁

## 2. 合成管線

- [x] 2.1 `coverRect(w, h)` 改為接受去邊後的內容尺寸，並回傳相對於去邊矩形的來源座標
- [x] 2.2 `compose(file)` 插入去邊步驟，並將去邊矩形與 cover 矩形合併為單一 `drawImage(bmp, sx, sy, sw, sh, 0, 0, 1000, 1000)`
- [x] 2.3 `compose()` 回傳值加上 `trim` 資訊（各邊裁去的原始像素數）供 UI 顯示
- [x] 2.4 驗證：以 `/Users/liang/Downloads/未命名-1_0.jpg` 為輸入，來源矩形應為約 `(114, 114.5, 771, 771)`，成品無白邊、內容不變形

## 3. 清單與預覽

- [x] 3.1 `items` 加入 `previewUrl` 快取欄位；新增模組層級的 `selectedIndex` 與 `previewToken`
- [x] 3.2 `render()`：`li` 加上 `tabindex`、`role`、選取樣式 class，並綁定 click 事件
- [x] 3.3 新增 CSS：`#list li.sel` 選取態（amber 邊框／底色）、hover 態、focus-visible 外框
- [x] 3.4 新增 `select(i)`：設定 selectedIndex、遞增 token、命中快取則直接套用、否則 await `compose()` 並在 token 過期時丟棄結果
- [x] 3.5 `refreshPreview()` 改為 `select(0)`；`accept()` 呼叫端一併調整
- [x] 3.6 清單容器綁定 ↑↓ 鍵切換選取（並阻止頁面捲動）
- [x] 3.7 `clearItems()`：連同快取的 preview blob URL 一併 `revokeObjectURL`
- [x] 3.8 預覽失敗時顯示檔名與原因（取代寫死的「第一張無法預覽」），並將該列 badge 標為失敗

## 4. 介面文案

- [x] 4.1 預覽面板標題由「預覽（第一張）」改為「預覽」，並於預覽區下方顯示目前檔名
- [x] 4.2 清單 `.dim` 顯示 `<KB> · 已去左右白邊`／`已去上下白邊`（未去邊時省略後半，不顯示像素數）
- [x] 4.3 頁尾說明區補一行：白邊會自動移除、四邊皆為淺色底的照片不處理

## 5. 驗證

- [x] 5.1 左右白邊圖：成品填滿、無白邊、內容比例正確
- [x] 5.2 上下白邊圖：只裁上下
- [x] 5.3 米色／淺灰邊圖：一樣被移除
- [x] 5.4 純白底棚拍商品照（四邊皆白）：不被裁
- [x] 5.5 深色純底照：不被裁
- [x] 5.6 多張混合批次：逐項點選皆能預覽對應那一張；連續快速點擊不出現錯張
- [x] 5.7 混入 HEIC／非圖片檔：既有失敗處理不受影響，其餘照常打包輸出
- [x] 5.8 以 `file://` 直接開啟頁面全流程可跑完（無 canvas taint、無 CORS 問題）
