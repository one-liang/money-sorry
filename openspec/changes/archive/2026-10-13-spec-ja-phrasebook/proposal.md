# Proposal

## Why

`amiami-com-api` 之後，只在 amiami.com 上架的商品（例如 `4571623518150`）已經能匯入，但規格是英文：

```
Pre-painted Complete Figure
Scale: 1/7
Size: Approx. H235mm (including base)
Material: Plastic
```

賣場要的是日文規格，使用者目前得自己逐行改寫。使用者希望工具能直接轉成日文。

先確認過拿不到日文原文：amiami.com API 以 `lang=ja`／`jpn` 查詢回同一份英文，`lang=jp` 回空的規格；這類商品 amiami.jp 根本沒有上架，不存在日文原文可抓。

現行規格禁止機器翻譯，理由是「錯誤的日文比沒有日文更糟」——這個理由仍然成立。但 amiami.com 的英文規格是**模板化**的：類型、`Scale:`、`Size:`、`Material:`、`[Set Contents]` 與常見內容物，幾乎都是固定句型，與 amiami.jp 的「製品仕様」逐項對應。對固定句型做**逐行查表**，結果是可預期、可逐條驗證的，不是機器翻譯。

## What Changes

- 新增 `lib/spec-ja.js`：英文規格 → 日文的**內建用語對照表**（純函式、離線、無外部服務）。逐行處理：
  - 整行或依句型（`Size:`、`Material:`、數量 `x3`、`[… Bonus]` 等）對得上的，轉成 amiami.jp 的寫法（`【サイズ】全高：約235mm（台座含む）`、`【素材】PVC、ABS`、`【セット内容一覧】`…）。
  - **對不上的行原樣保留英文**，不猜、不逐字拼湊；一行裡只要有一個詞不認得，整行保留英文。
- 來自 amiami.com 的規格經對照表轉換後，標題改為「製品仕様」，同時保留英文原文供對照。
- 內文面板：
  - 來源標示由「非日文原文」改為「已依對照表轉為日文」，有保留英文的行時註明行數。
  - 保留英文的行在面板上以醒目樣式標出（只在畫面上，「複製全部」拿到的是純文字）。
  - 可展開查看英文原文（不進「複製全部」）。
- 一行都對不上時，維持現行行為：顯示英文原文、標示「非日文原文」。
- amiami.jp 的規格不經過對照表，一律原樣保留日文。

## Capabilities

### New Capabilities
<!-- 無 -->

### Modified Capabilities
- `amiami-import`: 備援站規格由「不翻譯」改為「以內建用語對照表逐行轉為日文、對不上的行保留英文並標示」；仍禁止機器翻譯與外部翻譯服務。

## Impact

- 新增 `lib/spec-ja.js`（classic script，掛在 `MS.specJa`）。
- `lib/amiami.js`：`parseApiItem` 的規格經 `MS.specJa` 轉換，段落帶英文原文與逐行轉換結果。
- `studio.html`：載入 `lib/spec-ja.js`；內文面板的來源標示、保留英文行的樣式、英文原文展開。
- 新增 `tools/verify/spec-ja.mjs`（對照表的離線驗證）；`amiami.mjs`、`studio-import.mjs` 更新斷言。
- `README.md`、`CLAUDE.md`、`studio.html` 使用說明更新。
- 外部相依與隱私界線不變：轉換在瀏覽器內完成，不送出任何資料。
