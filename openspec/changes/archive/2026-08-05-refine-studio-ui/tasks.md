## 1. 版面骨架

- [x] 1.1 `#model-bar` 改 `position: fixed` 貼底、顯隱走 `opacity` + `visibility`，不再用 `display`
- [x] 1.2 `ensureModel()` 就緒後 4 秒移除 `show`；`ready` class 保留，`fail` 不自動收起
- [x] 1.3 右欄 `<div>` 給 id `side`，`#side { align-self: stretch }`（`.grid` 是 `align-items: start`，不加這行 sticky 沒有空間可 travel）
- [x] 1.4 `#side > .panel:first-child` sticky ＋ `max-height: calc(100dvh - 28px)` ＋ `overflow-y: auto`
- [x] 1.5 只在 `min-width: 961px` 套用；商品說明面板不 sticky

## 2. 一鍵區改 toggle

- [x] 2.1 HTML：三列 `.brow`＝`.tg`（`role="checkbox"`）＋ `.btxt`（標籤在上、計數在下）
- [x] 2.2 CSS：軌道 40×22、圓鈕 18×18，`[aria-checked]` 三態各自的軌道色與位移；命中區 `::before` 撐到 ≥44×44
- [x] 2.3 移除 `.seg` / `.seg button` / `.bulkrow` / `data-state="lit"` / `bulk-pulse` 動畫
- [x] 2.4 `bulkBtns` 從六個 id 縮成三個；移除 `setLit()`、`pulse()`、`BULK_KEYS`
- [x] 2.5 `syncBulk()` 改寫 `aria-checked`；計數的 `<b>N</b> / M 張` 格式維持不變
- [x] 2.6 點擊處理器讀 `aria-checked` 決定方向：只有 `true` 才關，其餘一律開
- [x] 2.7 `bulkSet()` 移除 `btn` 參數與「已在目標狀態」的回彈分支；其餘（`clearUndo`、`decodable` 作用域、`pickOn` 不清 cache、`offerUndo`、`areaPct` 重算）不動

## 3. 移除漏遮彙總條

- [x] 3.1 移除 `#nobox` 的 HTML、CSS、`noboxEl` 參照與 `syncBulk()` 的 zero 區塊
- [x] 3.2 逐列的「未偵測」badge 保留不動
- [x] 3.3 註解與使用說明中「並會另外標示出來」改為指向逐列標示與預覽警示

## 4. 預覽區重整

- [x] 4.1 `#stage` 與 `#pname` 包成 `<figure id="fig">` ＋ `<figcaption id="pname">`；移除 `#pbar`
- [x] 4.2 `#zoombar` 移進 `#stage`，`position: absolute` 浮在右下角
- [x] 4.3 新增 `#offtag`（照片左上角的「不下載」）與 `#alert`（警示條）
- [x] 4.4 `updateDetail()` 改寫成同時寫三個落點，每條路徑都清掉另外兩個
- [x] 4.5 `drawPreview()` 的三處手動清 `#detail` 改為一律呼叫 `updateDetail()`
- [x] 4.6 `setAlert()` 用 `IC.alert`；`IC` 移除 `frame` 與 `eyeOff`
- [x] 4.7 拆 `.framing`（游標）與 `.movable`（`touch-action`）；套框模式恆為抓手

## 5. 移除常駐編輯說明

- [x] 5.1 移除 `#note-censor` / `#note-frame` / `#note-frame-censor` 的 HTML、CSS、三個參照
- [x] 5.2 移除 `syncPreview()` 中的三行切換
- [x] 5.3 兩段內容改寫成 `<details class="notes">` 的兩條 `<li>`

## 6. 清單列與零碎項

- [x] 6.1 `.sub` 刪掉「順序由程式保證，JPEG 只編一次。」
- [x] 6.2 `lead.append(pick, grip, ord)`；`.ord { text-align: center }`
- [x] 6.3 `.grip` 改 20×20、`::before { inset: -12px }`、`.ic` 13px，與 `.pick` 一致
- [x] 6.4 晶片改純文字；`.chip` 收窄 `min-width`，移除 `.chip .ic`
- [x] 6.5 新增 `.btn-amber` 給 `#imp-go` 與 `#use-name` 共用
- [x] 6.6 `#imp-name` 加標題行；`showName()` 查 `.t` 的路徑不變
- [x] 6.7 `clearAll()` 補 `janEl.value = ''`，並改用 `updateDetail(null)` 一次清乾淨
- [x] 6.8 候選清單的 `.pick` 規則限定到 `#imp-picks` 底下（與清單列的核取方塊同名，樣式會互相汙染）

## 7. 驗證

- [x] 7.1 `[6b]` 改測 toggle 三態、混合態按下是全開、已全開按下是全關
- [x] 7.2 `[6c]` 的 `#nobox` 斷言改為預覽警示條 ＋ 逐列標示
- [x] 7.3 `[11d]` 的「不會輸出」改測 `#stage.unpicked` 與 `#offtag`
- [x] 7.4 新增 helper `bulkTg` / `bulkState` / `setBulk`，取代六個 id 的直接點擊
- [x] 7.5 新增 `[12]`：前導欄順序、把手與核取方塊同尺寸、晶片無 icon、`#stage.framing`、清空清 JAN、兩顆按鈕共用 class
- [x] 7.6 `[11f]` 擴充為六個已移除的 id 都不存在，並斷言兩段編輯說明已在 `details.notes`
- [x] 7.7 四支驗證全綠：studio 144、amiami 46、censor 29、preview-adjust 45
- [x] 7.8 三條逐位元不變量原樣通過
- [x] 7.9 視覺確認：toggle 三態可區分、sticky 捲到底仍在視野、未勾選的預覽呈現、匯入區塊兩顆按鈕一致

## 9. 側欄整欄浮動

- [x] 9.1 sticky 從 `#side > .panel:first-child` 移到 `#side` 本身
- [x] 9.2 移除 `#side { align-self: stretch }`（grid item 的包含區塊是格線區域，拉伸反而失去浮動）
- [x] 9.3 `#expanel` 自己的 `margin-top: 22px` 移除，改吃共用的 `.panel + .panel { margin-top: 18px }`

## 10. 一鍵區與清單列的間距

- [x] 10.1 `.btxt` 改 `flex-direction: row`、`align-items: baseline`、`gap: 14px`
- [x] 10.2 `.btxt .lbl { min-width: 4.2em }`，三列的計數才會左緣對齊
- [x] 10.3 `.lead { gap: 12px }`（原 7px）

## 11. 左欄四張卡與商品說明

- [x] 11.1 左欄外層 `<div>` 給 id `main`，內容拆成四張 `.panel`
- [x] 11.2 `#imp-name` 搬進「輸出設定」卡，排在 `#naming` 之前
- [x] 11.3 `#clear` / `#clear-cancel` 搬進「照片清單」卡的 `h2`
- [x] 11.4 移除 `.imphead` 元素與 CSS；移除 `#import` 與 `#bulk` 的 `border-top`
- [x] 11.5 `updateGo()` 補 `cardList` / `cardOutput` 兩張卡的可見性；`showName()` 補呼叫 `updateGo()`
- [x] 11.6 `#expanel` 改用 `.exphead` ＋ `#exp-title`，移除 `h2` 的「商品說明」文字
- [x] 11.7 `.exp-h` 改藥丸標籤（沿用 `.badge.warn` 的配色）
- [x] 11.8 `renderExplain()` 依 `products.length` 決定標題內容，單一商品時不重複輸出 `.exp-title`
- [x] 11.9 新增測試 `[13]` `[13b]` `[13c]`，四支驗證全綠（studio 159）
- [x] 11.10 視覺確認：四張卡的區隔、計數左緣對齊、捲到底時商品說明沒被蓋住、商品說明的三個層級（實際匯入 `4570232591424` 驗過）

## 12. 匯入進度長在按鈕上

- [x] 12.1 `#imp-status` 拆出常駐的 `#imp-msg`（`.err` / `.done` 跟著搬）
- [x] 12.2 `#imp-go` 內加 `.spin`（spinner）與 `.ip`（底部進度線）；規則只掛 `#imp-go`，不污染共用的 `.btn-amber`
- [x] 12.3 `min-width: 112px`——待機 64px、忙碌 98px，不釘住的話旁邊的輸入框會被擠窄
- [x] 12.4 `.ip` 用 `transform: scaleX()` 成長；`.wait` 時改跑來回掃，不給假百分比
- [x] 12.5 `#imp-go.busy:disabled { opacity: 1 }`——忙碌不是壞掉
- [x] 12.6 `prog(step, ratio)` 把三個步驟壓成單一比例（`.25 / .25 / .5` 權重）
- [x] 12.7 `setImporting()` 成為忙／不忙的唯一開關，不忙時把進度線歸零
- [x] 12.8 `waiting(step)` 工廠 ＋ `runImport` / `importProduct` / `pickProduct` 的呼叫點接上 `#imp-msg`
- [x] 12.9 移除第一版的 `#imp-prog` 整塊（HTML／CSS／`progSegs` / `progDone` / `progHide` / `progNum` / `fadeTimer` / `STEPS`）
- [x] 12.10 未填 JAN 時按鈕不進入忙碌
- [x] 12.11 `lib/amiami.js` 與 `tools/verify/amiami.mjs` 未動（取消與 Cloudflare 等待策略留給另一支分支）
- [x] 12.12 `[13d]` 改寫：`#imp-prog` 不存在、按鈕寬度不變、`#imp-msg` 與兩張卡在忙碌時位移為 0
- [x] 12.13 四支驗證全綠（studio 169）
- [x] 12.14 手動確認：實際匯入 `4570232591424` 逐格取樣——`wait=true` 兩段、`bar` 0.50→0.95 對應 `0 / 11`→`10 / 11`、結束歸零；`#imp-msg` 的 top 匯入前後皆為 507.17（零位移）

## 13. 長命名不得撐開版面

- [x] 13.1 `.grid` 改 `minmax(0, 1fr) 420px`，單欄的 media query 一併改
- [x] 13.2 `#list` 補明確的 `grid-template-columns: minmax(0, 1fr)`（隱含 auto 軌道同樣由內容決定寬度）
- [x] 13.3 檔名籤獨立成 `.badge.file`：`max-width: 100%` ＋ **`min-width: 0`** ＋ ellipsis
- [x] 13.4 `markRow()` 給檔名籤加 `title`，截斷的是顯示不是資訊
- [x] 13.5 新增測試 `[13e]`：1280 與 480 兩種寬度下欄寬不變、列不超出欄、無橫向捲動、籤有截斷且 title 完整
- [x] 13.6 四支驗證全綠（studio 177）

## 8. 文件

- [x] 8.1 `README.md` 一鍵區示意圖改為三個 toggle
- [x] 8.2 `README.md` 補上預覽固定跟隨、模型狀態浮動列、提示三層級
- [x] 8.3 `README.md` 移除漏遮彙總條的敘述
- [x] 8.4 就地修 `add-download-selection` 中描述「分段點亮」與「漏遮警示」的情境
