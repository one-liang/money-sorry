## Why

在拍賣／賣場上架商品時，每張商品照都要套上同一個品牌外框（「お金でごめんなさい / 錢錢抱歉」1000×1000 邊框）。目前只能一張一張丟進影像編輯軟體手動對齊、裁切、輸出，十張商品照就是十次重複勞動，且人工對齊容易產生尺寸不一致的成品。

這是一個純本機、單人使用的重複性工作，不需要帳號、不需要伺服器、不需要保存任何狀態——只要一個能一次吃進多張照片、批次輸出的小工具就能完全解決。

## What Changes

- 新增 `money-sorry` 專案：一個**零依賴、單一 HTML 檔**的本機批次套框工具
- 使用者一次選取 N 張照片（`<input type="file" multiple>`），工具對**每一張獨立處理**，輸出 N 個 1000×1000 的成品檔
- 每張照片以 **cover 置中裁切**縮放填滿 1000×1000 畫布，再將固定外框整張疊上
- 外框 `frame.png` 以 **base64 data URI 內嵌**於 HTML，避免 `file://` 協定下的 canvas cross-origin taint 導致 `toBlob()` 失敗
- 輸出 JPEG（q≈0.92），檔名沿用來源檔名加後綴，逐檔觸發瀏覽器下載
- 提供即時預覽（顯示第一張的合成結果）與處理進度
- **Non-goals**：不做多張拼貼版型、不做自由拖拉定位、不做 HEIC 解碼、不做上傳／後端／帳號、不做外框線上更換

## Capabilities

### New Capabilities

- `photo-framing`: 本機批次影像套框——檔案選取、cover 置中裁切、外框疊合、預覽、批次輸出與下載、以及不支援格式的錯誤處理

### Modified Capabilities

（無——這是全新專案，`openspec/specs/` 目前為空）

## Impact

**新增檔案**

```
money-sorry/
├── index.html              # 全部程式碼 + 內嵌 base64 外框（單一檔案，可雙擊開啟）
├── README.md               # 使用方式、換框步驟、關鍵決策紀錄
└── assets/
    ├── frame.png           # 原始外框（1000×1000 RGBA，換框時重新內嵌用）
    └── reference/
        ├── sample-output.jpeg
        └── sample-photo.webp
```

**技術面**

- 執行環境：瀏覽器（建議 Safari，因其可原生解碼 iPhone 的 HEIC）
- 相依：**零**。無 npm、無 build step、無 CDN、無 node_modules
- 瀏覽器 API：File API、`createImageBitmap`、Canvas 2D、`canvas.toBlob`、`URL.createObjectURL`
- 部署：無。雙擊 `index.html` 即用，可離線永久使用

**現有系統**

無。不觸碰工作區內任何既有專案（`kaituan`、`fenpay`、`mhn-builder` 等）。
