# Tasks

## 1. 實測

- [x] 1.1 確認 amiami.com API 以 `lang=ja`／`jpn`／`jp` 取不到日文規格。驗證：design 實測一
- [x] 1.2 抽樣 280 件英文規格，統計句型。驗證：design 實測二
- [x] 1.3 抓 37 件同商品的 amiami.jp 製品仕様逐行對照，決定每種句型的寫法（用字不一取多數）。驗證：design 實測三

## 2. 對照表

- [x] 2.1 新增 `lib/spec-ja.js`（classic script，`MS.specJa`）：類型、スケール、サイズ、素材、段落標題、特典、內容物與數量、注意事項；對不上整行保留英文。驗證：`node tools/verify/spec-ja.mjs` 全數 ✓
- [x] 2.2 以實測資料量測轉換率與與 amiami.jp 的一致率。驗證：design 實測四

## 3. 接線

- [x] 3.1 `lib/amiami.js`：`parseApiItem` 的規格段落經 `MS.specJa` 轉換，帶 `lines`、`kept`、`original`；一行都對不上或未載入時回英文原文。驗證：`amiami.mjs` 的 parseApiItem 段落
- [x] 3.2 `studio.html`：載入 `lib/spec-ja.js`；來源標示改為「已依對照表轉為日文」並註明保留英文的行數；保留英文的行以底色標出；英文原文以 `<details>` 預設收合；「複製全部」不變（只取標題與內文）。驗證：`studio-import.mjs`

## 4. 驗證

- [x] 4.1 新增 `tools/verify/spec-ja.mjs`（node:vm，不需瀏覽器）
- [x] 4.2 `api-item-full.md` 加一行對照表不認得的自由文字；`amiami.mjs` 更新規格斷言、加「一行都對不上」「未載入 spec-ja.js」與接線順序檢查
- [x] 4.3 `studio-import.mjs`：攔下剪貼簿，驗「複製全部」只有日文；驗標色、英文原文收合、jp 來源不經對照表
- [x] 4.4 真實網路端到端：`4571623518150`（轉換）、`6979272330921`（jp 原樣）。驗證：design 端到端

## 5. 文件

- [x] 5.1 `README.md`：備援站規格的轉換說明與實測、驗證說明、檔案樹
- [x] 5.2 `CLAUDE.md`：JAN 匯入要點、驗證指令、`MS.specJa`
- [x] 5.3 `studio.html` 的使用說明
