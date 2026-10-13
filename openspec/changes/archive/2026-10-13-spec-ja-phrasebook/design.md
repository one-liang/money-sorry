# Design

## Context

動機見 proposal.md。以下是 2026-10-13 的實測，決策都以它為依據。

### 實測一：拿不到日文原文

以回報案例 `FIGURE-209570`（只在 amiami.com 上架）打 amiami.com API 的 `item`：

| `lang` | `spec` |
|---|---|
| `eng` | `Pre-painted Complete Figure\nScale: 1/7\nSize: Approx. H235mm (including base)\nMaterial: Plastic` |
| `ja` | 同上（英文） |
| `jpn` | 同上（英文） |
| `jp` | 空字串 |

amiami.jp 沒有這件商品，所以沒有任何地方有日文規格可抓。要日文只能轉換。

### 實測二：英文規格是模板化的

經 jina 以 `customHeader` 打 API，抽樣 280 件（分類 `s_cate_tag=1`、關鍵字 nendoroid、figma、pop up parade、1/7、1/4、prize），規格逐行去掉數字後統計句型，前幾名：

| 件數 | 句型 |
|---|---|
| 199 | `[Set Contents]` |
| 184 | `Main figure` |
| 171 | `Base` |
| 146 | `Material: Plastic` |
| 134 | `Pre-painted Complete Figure` |
| 103 | `Size: Approx. HNmm (non-scale)` |
| 99 | `Scale: N/N` |
| 73 | `Pre-painted Posable Figure` |
| 43 | `Size: Approx. HNmm` |
| 28 | `Size: Approx. HNmm (including base)` |
| 23 | `Size: Approx. Ncm` |
| 18 | `Material: PVC & ABS` |
| 13 | `Material: PVC, ABS`、`[Bonus]` |

只出現一次的多半是專有名詞（角色名、武器、特殊配件：`Jack the Ripper weapon set (scythe x1, …)`、`Neo Akasha Terminal (…)`）。

### 實測三：同商品的 amiami.jp 寫法

以貪婪法挑出涵蓋最多常見句型的商品，另加 20 件一般模板商品，經 jina 抓 amiami.jp 商品頁的製品仕様（撞到挑戰頁的以 `x-no-cache` 重抓），得 37 件對照。結構逐項對應：

| 英文 | amiami.jp |
|---|---|
| `Pre-painted Complete Figure` | `塗装済み完成品`（15 件；`塗装済み完成品フィギュア` 2 件、`彩色済み完成品フィギュア` 1 件） |
| `Pre-painted Posable Figure` | `塗装済み可動フィギュア` |
| `, Bonus Edition`／`, 2pc. set` | `・特典版`／`・2体セット` |
| `Scale: 1/7` | `【スケール】1/7` |
| `Size: Approx. H260mm` | `【サイズ】全高：約260mm`（`全高：約` 19 次、`全高約`／`全高 約` 7 次） |
| `Size: H255mm (Base Excluded)` | `【サイズ】全高255mm(台座を除く)` |
| `(non-scale)`／`(including base)` | `(ノンスケール)`／`(台座含む)`——括號是半形 |
| `Approx. 13cm (Approx. W15cm)` | `約13cm(横幅約15cm)` |
| `(Up to top of the head: Approx. 148mm)` | `(頭頂高：約148mm)` |
| `W150 x D160 x H190mm` | `W150×D160×H190mm`（字母保留） |
| `Material: PVC & ABS`／`PVC / ABS`／`PVC, ABS` | `【素材】PVC＆ABS`／`PVC/ABS`／`PVC、ABS`——分隔符照英文 |
| `Cloth, Magnet, Plastic` | `布、磁石、プラスチック` |
| `[Set Contents]` | `【セット内容一覧】` |
| `[Bonus]`／`[AmiAmi Exclusive Bonus]`／`[First Press Limited Bonus]` | `≪特典≫`／`≪あみあみ限定特典≫`／`≪初回限定特典≫` |
| `Main figure`／`Figure` | `フィギュア本体` |
| `Base` | `専用台座`（20 件；`台座`、`ベース` 各 1） |
| `Interchangeable hand parts` | `交換用手首一式` |
| `Optional hand part x11` | `オプションハンド×11` |

自由文字（`"Fearless Smile" face part` → `「不敵な微笑み顔」フェイスパーツ`、`Rurudo Lion tiny mode` → `るるどらいおんのちっちゃいモード`）是意譯或專有名詞，查表做不到，也不該猜。

### 實測四：轉換結果

實作後以同一批資料量測：

| 項目 | 結果 |
|---|---|
| 280 件英文規格（有規格者 277 件）的非空行 | 1596 行，轉成 1410 行（88.3%），保留英文 186 行 |
| 整段轉完 | 197 件；一行都轉不成 5 件 |
| 37 件 amiami.jp 對照 | 259 行；轉成 235 行，其中 **220 行與 amiami.jp 一字不差**，15 行是上表那種用字差異（`全高約`、`PVC/ABS` 的商品寫成 `PVC＆ABS` 等），沒有意思錯誤的；保留英文 24 行，全是專有名詞或意譯 |

### 真實網路端到端（不攔截）

| JAN | 結果 |
|---|---|
| `4571623518150` | 15 張、來源英文站；內文 `塗装済み完成品`／`【スケール】1/7`／`【サイズ】全高：約235mm(台座含む)`／`【素材】プラスチック`，標示「已依對照表轉為日文」，英文原文可展開 |
| `6979272330921` | 走 amiami.jp，內文原樣日文，沒有轉換標示 |

## Goals / Non-Goals

**Goals**
- 備援站的模板化英文規格，直接得到可以貼上架的 amiami.jp 寫法。
- 對不上的部分一眼看得出來，原文隨時可對照。

**Non-Goals**
- 翻譯自由文字、角色名、配件名。
- 處理 amiami.jp 的規格（它本來就是日文原文）。
- 統一 amiami.jp 自己的用字差異。

## Decisions

### 查表，不接翻譯服務

| 方案 | 不採用的理由 |
|---|---|
| 外部翻譯 API（DeepL、Google） | 金鑰藏不住（純前端）；免費非官方端點隨時會壞；違反「除了 JAN 與 amiami 公開網址，資料不離開瀏覽器」 |
| 瀏覽器內建 Translator API | 只有桌機 Chrome 138+；機器翻譯對規格用語常錯（「全高」「台座含む」這種固定寫法譯不出來） |
| **內建對照表** | 離線、可預期、可逐條驗證；模板化的規格正好適合 |

原規格禁止機器翻譯的理由（錯誤的日文比沒有日文更糟）仍然成立，對照表正是照這個理由設計的：只換確定的、其餘不碰。

### 對不上就整行保留

一行裡只要有一個部分不認得就整行保留英文，例如 `Material: PVC (non-phthalate), ABS, Acrylic`——`PVC (non-phthalate)` 沒對照過，就算 `ABS`、`Acrylic` 認得也不換。半日半英的一行，比整行英文更容易被誤當成可以直接貼。

### 只收對照過的寫法

猜得到但沒在 37 件對照裡看過的（`Diecast`、`Metal`、`PVC (non-phthalate)`、`Pre-painted Complete PVC Figure`），寧可不收。對照表的每一條都能指回實測。用字不一時取多數（`全高：約`、`専用台座`、`塗装済み完成品`）。

### 放在獨立的 `lib/spec-ja.js`

對照表是會持續增長的資料，與 `lib/amiami.js` 的取得、解析分開；兩者都是純函式，`spec-ja.js` 連網路與 DOM 都不碰，驗證以 `node:vm` 載入即可，不需瀏覽器。`parseApiItem` 在組規格段落時呼叫它；沒載入時退回英文原文，少了翻譯不該讓整個匯入失敗。

### 段落資料的形狀

```js
{ heading: '製品仕様', body: '<轉換後全文>', lines: [{ text, ok }], kept: 1,
  original: { heading: 'Specifications', body: '<英文原文>' } }
```

`body` 與 `lines` 的文字完全相同，畫面依 `lines` 標色，「複製全部」只用 `heading` 與 `body`——所以標色與原文天然不會進入複製內容，不必另外過濾。一行都對不上時回傳原本的 `{ heading, body }`，畫面照舊走「非日文原文」那條路。

### 數量與標點照 amiami.jp

`x3`、`: 1` → `×3`、`×1`；括號用半形（amiami.jp 的尺寸、內容物註記都是半形）；素材分隔符照英文對應（`&` → `＆`、`/` → `/`、`,` 與空白 → `、`）。

## Risks / Trade-offs

- **amiami.com 改了英文模板** → 對不上的行變多，但只會「保留英文」、不會轉錯；`spec-ja.mjs` 的期望值也是取自實測，可據以補表。
- **amiami.jp 的寫法與表不同的個案** → 是用字差異而非意思錯誤（實測 15/235）；面板標明是轉換結果，使用者知道不是原文。
- **對照表成長後維護成本** → 每條一列檢查，新增時照 README 的流程補。
