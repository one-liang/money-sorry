## 1. `lib/amiami.js`：解析與取得（與 UI 分離）

- [x] 1.1 建立 `lib/amiami.js`，classic script、掛單一全域命名空間（比照 `lib/zip.js`），MUST NOT 使用 ES module
- [x] 1.2 實作代理位址組裝：`jinaUrl(url)` 與 `weservUrl(imgUrl)`（後者需去掉 scheme 再 `encodeURIComponent`）
- [x] 1.3 實作 `fetchDoc(url)`：以 `x-return-format: html` 取回 HTML 並 `DOMParser` 成 `Document`；非 2xx 時拋出含階段資訊的錯誤
- [x] 1.4 實作純函式 `parseSearch(doc)`：自 `#search_table .product_box a[href*="gcode="]` 取出 `{gcode, name, thumb}[]`，不得混入推薦商品
- [x] 1.5 實作純函式 `parseProduct(doc)`：回傳 `{title, imageUrls}`；`title` 清除 `-amiami.jp-…` 站名後綴；`imageUrls` 為 `[data-main-image]` 在前、`[data-item-image]` 依序在後，並去重
- [x] 1.6 實作純函式 `parseExplain(doc)`：取 `#explain` 子區塊，排除 `.hashtag-container`，`<br>` 還原為換行，回傳 `{heading, body}[]`；找不到區塊時回傳空陣列而非拋錯
- [x] 1.7 實作 `fetchImages(urls, {concurrency: 4, onProgress})`：逐張經 weserv 取 `Blob` 並包成 `File(name, {lastModified: 0})`；單張失敗不影響其餘，回傳成功與失敗兩份結果
- [x] 1.8 全流程 MUST NOT 對 `amiami.jp` / `img.amiami.jp` 直接發出請求

## 2. 離線解析驗證

- [x] 2.1 建立 `tools/verify/fixtures/`，放入**自行撰寫的最小結構樣本**（模擬搜尋頁與商品頁的相關 DOM），MUST NOT 收錄 amiami 的實際頁面內容
- [x] 2.2 樣本需涵蓋：單筆搜尋結果、多筆搜尋結果、零筆、含推薦商品的干擾區塊
- [x] 2.3 樣本需涵蓋：`#explain` 含 `.hashtag-container`、不含 `.hashtag-container`、含 `<br>` 的多行規格、`#explain` 缺席
- [x] 2.4 建立 `tools/verify/amiami.mjs`，對上述樣本驗證 `parseSearch` / `parseProduct` / `parseExplain` 的輸出，全部通過
- [x] 2.5 驗證 `<br>` 還原：規格 MUST 為逐行，MUST NOT 黏成單行

## 3. `studio.html`：匯入區塊

- [x] 3.1 在左欄「選擇照片」面板中加入「從 JAN 匯入」區塊：JANコード 輸入框、匯入按鈕、進度列
- [x] 3.2 區塊內常駐說明隱私界線：匯入會經過外部服務，送出的只有 JAN 與 amiami 公開網址，自己的照片不會被送出
- [x] 3.3 引用 `<script src="./lib/amiami.js">`；`index.html` MUST NOT 引用
- [x] 3.4 進度顯示三個階段（搜尋 → 擷取 → 下載 N/M），走既有的 `aria-live` 狀態列
- [x] 3.5 匯入期間停用匯入按鈕，避免重複觸發；完成或失敗後復原

## 4. 搜尋結果與歧義

- [x] 4.1 0 筆：顯示「查無此 JAN 的商品」，清單不變
- [x] 4.2 1 筆：直接進入下一階段，不打斷使用者
- [x] 4.3 多筆：於匯入區塊列出候選（縮圖＋商品名），由使用者點選後才繼續；MUST NOT 自動取第一筆
- [x] 4.4 候選清單提供取消路徑，取消後清單不變

## 5. 圖片入列

- [x] 5.1 將取得的 `File[]` 交給既有的 `accept()`，MUST NOT 另建入列路徑
- [x] 5.2 確認匯入項目自動繼承：雙開關預設值、一鍵區計數、拖曳排序、序號、量測、遮罩偵測、面積警示
- [x] 5.3 部分失敗時：成功者入列，失敗張數於狀態列明確回報，不中止整批
- [x] 5.4 確認 `lastModified: 0` 使同商品二次匯入能被既有規則標示為「重複」

## 6. 內文面板（落點 A）

- [x] 6.1 於右欄新增內文面板，顯示 `{heading, body}` 各段，未匯入時隱藏
- [x] 6.2 提供「複製全部」動作，並給出可察覺的成功回應
- [x] 6.3 多次匯入以商品為單位累積，各段標明所屬商品名，MUST NOT 只保留最後一次
- [x] 6.4 內文擷取失敗時明確標示「未取得內文」，MUST NOT 顯示空面板

## 7. 商品名填入輸出命名

- [x] 7.1 匯入成功後顯示商品名與「用這個命名」動作
- [x] 7.2 按下後填入輸出命名欄位並經既有消毒規則處理，觸發清單檔名即時更新
- [x] 7.3 MUST NOT 自動覆蓋使用者已輸入的內容

## 8. 內文 `.txt`（落點 B）

- [x] 8.1 打包時，若存在已擷取的內文，於 ZIP 內加入 `<輸出命名>.txt`（留白時 `money-sorry-<YYYYMMDD>-<HHMM>.txt`），UTF-8 編碼
- [x] 8.2 `.txt` MUST NOT 佔用圖片序號
- [x] 8.3 修改「單張不打包」判斷：存在內文時即使只有 1 張仍打包
- [x] 8.4 輸出按鈕或狀態列反映 `.txt` 會一併輸出

## 9. 回歸驗證

- [x] 9.1 跑 `node tools/verify/studio.mjs`，確認既有四格輸出矩陣的逐位元不變量未受影響
- [x] 9.2 跑 `node tools/verify/censor.mjs` 與 `preview-adjust.mjs`
- [x] 9.3 確認 `index.html` 雙擊開啟仍完全可用，且未引用 `lib/`
- [x] 9.4 未使用匯入功能時，全程 MUST NOT 對外部服務發出任何請求

## 10. 端到端手動驗收

- [x] 10.1 以 `4570232591424` 匯入，確認 11 張入列、內文正確、耗時可接受
- [x] 10.2 對匯入的圖片按「套框全開」，輸出並確認無 `SecurityError`
- [x] 10.3 對匯入的圖片按「遮罩全開」，確認模型載入與偵測正常
- [x] 10.4 設定輸出命名後打包，確認 ZIP 內為 `<名稱>/` ＋ 圖片 ＋ `<名稱>.txt`
- [x] 10.5 混合驗證：選檔加入數張後再匯入，確認追加語意與既有項目保留
- [x] 10.6 錯誤路徑：無效 JAN、代理不可用時的訊息皆明確

## 11. 文件

- [x] 11.1 `README.md` 新增匯入功能的使用方式
- [x] 11.2 `README.md` 明確說明隱私界線與兩個外部相依，以及它們不可用時會發生什麼
- [x] 11.3 移除 `test/demo-amiami.html`（驗證用途已由 `tools/verify/amiami.mjs` 承接）

## 12. Cloudflare 挑戰頁（實測回報後補上）

- [x] 12.1 `isChallenge(doc)`：以標題與 `cdn-cgi/challenge-platform` / `__cf_chl` / `#challenge-form` 辨識，MUST NOT 只看標題
- [x] 12.2 `fetchDoc` 在取得挑戰頁時等待後重抓（2s／4s／6s，上限 3 次），用盡仍為挑戰頁則拋出明確錯誤
- [x] 12.3 重試只套用於挑戰頁；限流與錯誤仍然直接往外拋，圖片下載完全不重試
- [x] 12.4 等待期間顯示「正在通過 amiami 的驗證…（n / 3）」進度
- [x] 12.5 樣本 `challenge.html` 與 `challenge-notitle.html`，驗證正常頁面不被誤判
- [x] 12.6 以未被快取過的 JAN 實測，確認不再出現假的「查無商品」

## 13. 同商品重複上架（實測回報後補上）

- [x] 13.1 `parseSearch` 改以 `.product_box` 為單位，取 `.product_name`（不再用整個 `<a>`，避免名稱混入折扣與價格）
- [x] 13.2 依 `.product_day` 的狀態文字排除停售項目；MUST NOT 依賴 `-R` 尾碼（實測兩個 JAN 的答案相反）
- [x] 13.3 全部皆停售時保留全部，避免假的「查無商品」
- [x] 13.4 帶出 `preowned`（`.icon_preowned`）與 `status`，候選清單以標籤顯示
- [x] 13.5 縮圖取 `data-src`，`src` 是 `blank.gif` 佔位圖
- [x] 13.6 樣本 `search-dup-stopped` / `search-dup-preowned` / `search-all-stopped`，釘死「不可靠尾碼判斷」
- [x] 13.7 驗證頁重試上限由 3 次提高到 4 次（累計 20 秒），實測偶爾需要第 4、5 次
- [x] 13.8 以 `6976195110142` 與 `4560392859120` 實測，兩者皆直接匯入、不再跳候選清單

## 14. 說明文字移出面板（版面調整後補上）

- [x] 14.1 移除 `#imp-note`，隱私聲明改寫進頁尾的使用說明區塊
- [x] 14.2 移除 `#exp-note` 與 `syncExpNote()`，`.txt` 的說明同樣移入使用說明
- [x] 14.3 使用說明中「照片不會上傳」那句補上匯入的但書，避免兩處說法牴觸
- [x] 14.4 規格與情境同步改為「頁面的使用說明區塊」
