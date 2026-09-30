# Tasks

## 1. 樣本收集（jp 實測、com 推定）

- [ ] 1.1 以 jina 預設格式抓取並自撰 jp 的 markdown 最小樣本：單筆搜尋、多筆搜尋、查無（Title 不含 JAN）、現役＋販売停止中並存、全部停售、推薦商品與結果並存；放進 `tools/verify/fixtures/*.md`，檔頭註明「實測樣本・取樣日期」。驗證：每個檔案能對應 design D2 的一條規則
- [ ] 1.2 取一個中古商品的 jp 搜尋 markdown，確認「中古」在連結文字中的呈現，據此自撰 `search-dup-preowned.md`，並把結論補進 design.md D2。驗證：design.md D2 不再寫「需確認」
- [ ] 1.3 自撰 jp 商品頁樣本：完整（主圖＋rthumb 圖庫＋製品仕様＋解説＋hashtag）、無 hashtag、無製品仕様、只有站名標題。驗證：樣本涵蓋 design D3 每個錨點
- [ ] 1.4 自撰頁面分類樣本：挑戰頁（標題版、無標題版）、amiami.com 系統錯誤頁、amiami.com SPA 空殼、jina 自身錯誤 JSON。驗證：D4 的四種類型各至少一份
- [ ] 1.5 以 Chrome 開啟 amiami.com 英文、中文站的搜尋與商品頁，記下實際的規格標題文字與段落結構，自撰推定樣本（檔頭註明「推定樣本」），並解決 design.md 的 Open Question。驗證：design.md Open Questions 清空或註明已確認

## 2. 取用與頁面分類（lib/amiami.js）

- [ ] 2.1 `fetchDocOnce` 移除 `x-return-format`，回傳字串；以 HTTP 狀態與 jina 錯誤 JSON 區分代理錯誤（`site: 'proxy'`）與站方回應。驗證：`amiami.mjs` 新增檢查——jina 錯誤樣本被歸為代理錯誤
- [ ] 2.2 實作 `classify(text)`，回傳 `challenge` / `sysError` / `shell` / `page`，取代舊的 `isChallenge(doc)`。驗證：`amiami.mjs` 對 1.4 的每份樣本斷言分類結果，且所有正常頁面樣本皆為 `page`
- [ ] 2.3 `CHALLENGE_WAITS` 改為單次短重抓（design D5），重抓後仍為挑戰頁則拋該站錯誤。驗證：`amiami.mjs` 以假 fetch 模擬連續挑戰頁，斷言請求次數為 2 且錯誤帶 `site`

## 3. markdown 解析器（lib/amiami.js）

- [ ] 3.1 改寫 `parseSearch(text)`：依 D2 界定結果範圍、取 gcode／名稱／縮圖／狀態／中古，保留「停售排除、全停售保留」規則；錨點缺席時拋「解析不到」而非回空陣列。驗證：`amiami.mjs` 以 1.1、1.2 樣本通過原有搜尋檢查的 markdown 版（單筆、多筆、查無、不誤判推薦、停售篩選、`-R` 反例、名稱不含價格）
- [ ] 3.2 改寫 `parseProduct(text)`：主圖、rthumb→review 圖庫、去重、`cleanTitle` 支援 com 站名、清完為空回空字串。驗證：`amiami.mjs` 斷言圖片順序與網址完全等於預期清單，且無 `rthumb`／`bthumb`／`thumb300` 混入
- [ ] 3.3 改寫 `parseSpec(text)`：依 D3 取「製品仕様」至下一段落標題／hashtag，還原換行；支援備援站的規格標題（1.5 的結果）；回傳結構帶語言。驗證：`amiami.mjs` 斷言只含規格、逐行、不含解説與 hashtag、無規格時回空
- [ ] 3.4 移除 DOM 版解析器、`parseExplain`、`blockText` 與 HTML fixtures，更新 `lib/amiami.js` 檔頭註解（記錄 markdown 格式的實測依據）。驗證：`grep -r "DOMParser\|x-return-format" lib/ tools/verify/amiami.mjs` 無結果，`node tools/verify/amiami.mjs` 全數 ✓

## 4. 多站備援流程（lib/amiami.js）

- [ ] 4.1 站別定義集中一處（id、顯示名稱、搜尋／商品頁網址產生器、規格標題），`searchUrl`／`detailUrl` 改為依站產生。驗證：`amiami.mjs` 斷言三站網址格式
- [ ] 4.2 實作 `searchByJan` 的 D6 流程：jp→eng→cn、明確零筆仍續試、代理錯誤立即停止、回傳 `{ hits, site }`、全失敗拋聚合錯誤帶 `attempts`。驗證：`amiami.mjs` 以假 fetch 覆蓋——jp 成功不打 com；jp 挑戰頁→eng 成功；三站皆零筆回 `[]`；三站皆失敗的 `attempts` 有 3 筆；代理限流只發 1 次請求
- [ ] 4.3 實作 `loadProduct` 的 D6 流程：永遠從 jp 開始、圖片／名稱／規格同站、回傳 `site`。驗證：`amiami.mjs` 以假 fetch 斷言——搜尋在 eng 成功時商品頁仍先請求 jp；jp 系統錯誤時退到 eng 且規格標示為英文

## 5. studio.html 整合

- [ ] 5.1 錯誤訊息加入站別，聚合錯誤逐站列出（D8）；站別顯示名稱取自 4.1。驗證：`studio.mjs` 以攔截網路回應模擬三站皆挑戰頁，斷言狀態列含三個站名且不含「查無」
- [ ] 5.2 進度與等待提示顯示目前站別，切站時顯示「改試 …」。驗證：`studio.mjs` 模擬 jp 失敗、eng 成功，斷言出現改試英文站的進度文字
- [ ] 5.3 內文面板在規格來自備援站時標示來源站與「非日文原文」；商品名為空時不提供填入動作。驗證：`studio.mjs` 以備援站樣本斷言標示存在、填入按鈕不可用
- [ ] 5.4 確認候選縮圖與圖片下載對 `img.amiami.com` 同樣走 weserv。驗證：`studio.mjs` 斷言匯入流程中沒有直接對 `amiami.com`／`amiami.jp` 網域發出的請求
- [ ] 5.5 確認既有不變量未受影響。驗證：`node tools/verify/studio.mjs` 三個逐位元不變量仍為 ✓

## 6. 文件

- [ ] 6.1 更新 `README.md` 的 JAN 匯入章節：markdown 取用、三站備援順序、錯誤訊息怎麼看、備援站規格不翻譯的理由；隱私界線文字確認仍只送出 JAN 與公開網址。驗證：README 內容與 spec 的「多站備援」「外部相依的失敗處理」一致
- [ ] 6.2 更新 `studio.html` 使用說明區塊中外部服務的敘述，並同步 `CLAUDE.md`「JAN 匯入」要點（markdown 格式、解析改吃字串、備援）。驗證：`grep "x-return-format" README.md CLAUDE.md studio.html` 無結果

## 7. 整合驗證

- [ ] 7.1 本機 `serve` 後以真實網路匯入 `6979272330921`、`4580416948159`（全停售）與一個查無的 JAN，確認 jp 路徑成功、停售標示正確、查無訊息正確。驗證：人工操作結果記入 design.md 附錄
- [ ] 7.2 部署到 GitHub Pages 的 develop 預覽或 release 前，在 Pages 網址上重複 7.1 的第一個 JAN。驗證：在 Pages 上匯入成功
