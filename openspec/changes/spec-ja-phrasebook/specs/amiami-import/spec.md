# Spec Delta

## ADDED Requirements

### Requirement: 備援站規格以用語對照表轉為日文

來自 amiami.com 的英文規格 SHALL 經工具內建的用語對照表，**逐行**轉為 amiami.jp「製品仕様」的寫法。對照表 MUST 是工具內建、可離線驗證的固定規則；工具 MUST NOT 使用機器翻譯，MUST NOT 將規格送往任何翻譯服務。

逐行轉換的規則：

- 一行的**每個部分**都能對應時，整行換成日文；任一部分無法對應（例如角色名、特殊配件名、未對照過的註記），**整行 MUST 保留英文原文**，MUST NOT 混合半句日文半句英文。
- 對照表的日文 SHALL 依 amiami.jp 同商品製品仕様的實際寫法；amiami.jp 用字不一致時取多數。
- 空行 SHALL 保留，段落結構與原文一致。

轉換後的規格段落 SHALL 以「製品仕様」為標題，並保留英文原文供對照。內文面板 SHALL：

- 標示來源站，並標示規格已依對照表轉為日文；有保留英文的行時，SHALL 註明行數。
- 在內文中以有別於日文行的樣式標出保留英文的行。
- 提供可展開的英文原文，預設收合。

「複製全部」SHALL 只包含轉換後的標題與內文；來源標示、行的標色與英文原文 MUST NOT 進入複製內容。

一行都無法對應時，工具 SHALL 照舊顯示英文原文，並標示為非日文原文。來自 amiami.jp 的規格 MUST NOT 經過對照表。

#### Scenario: 模板化的規格整段轉完

- **WHEN** 備援站的規格為 `Pre-painted Complete Figure`／`Scale: 1/7`／`Size: Approx. H235mm (including base)`／`Material: Plastic`
- **THEN** 內文為 `塗装済み完成品`／`【スケール】1/7`／`【サイズ】全高：約235mm(台座含む)`／`【素材】プラスチック`，標題為「製品仕様」，面板標示已依對照表轉為日文

#### Scenario: 對不上的行保留英文

- **WHEN** 規格內容物中有一行 `"Fearless Smile" face part`
- **THEN** 該行原樣保留英文並以醒目樣式標出，面板註明有 1 行保留英文；其餘行照常轉換

#### Scenario: 只認得一半的行不拼湊

- **WHEN** 一行為 `Material: PVC (non-phthalate), ABS, Acrylic`，其中 `PVC (non-phthalate)` 不在對照表
- **THEN** 整行保留英文，MUST NOT 輸出部分轉換的結果

#### Scenario: 複製只有日文

- **WHEN** 使用者在備援站來源的規格上按下「複製全部」
- **THEN** 剪貼簿內容以「製品仕様」開頭、為轉換後的內文，MUST NOT 含來源標示或英文原文

#### Scenario: 英文原文可對照

- **WHEN** 規格經對照表轉換
- **THEN** 面板提供預設收合的英文原文，展開後可見原本的標題與逐行內文

#### Scenario: 一行都對不上

- **WHEN** 備援站的規格每一行都不在對照表
- **THEN** 面板照舊顯示英文原文並標示「非日文原文」，MUST NOT 以「製品仕様」為標題

#### Scenario: jp 來源不經對照表

- **WHEN** 規格取自 amiami.jp
- **THEN** 內文原樣保留，沒有轉換標示、標色或英文原文

## MODIFIED Requirements

### Requirement: 內文擷取規則

工具 SHALL 自商品頁的說明區塊只擷取「製品仕様」的標題與內文。「解説」與其餘段落 MUST NOT 被取用——上架用得到的是規格，解説是廠商的行銷文案，貼出去只會稀釋規格。排除 MUST 發生在資料層，而不是取來之後在畫面上藏起來。站內 hashtag 標籤雲 MUST 排除。

規格段落的範圍 SHALL 自「製品仕様」標題起，至下一個段落標題或 hashtag 標籤雲為止。

來自 amiami.com 的資料 SHALL 只取其規格欄位（`spec`，與 amiami.jp 的「製品仕様」逐項對應）；製作人員欄位（`memo`，對應 amiami.jp 放在「解説」裡的內容）MUST NOT 被取用。

換行 MUST 依來源原本的逐行呈現還原。僅取純文字會使規格黏成單一長串（如 `【サイズ】全高：約140mm【素材】プラスチック`），與頁面上的逐行呈現不符。

來自 amiami.jp 的內文 SHALL **原樣保留日文**，MUST NOT 翻譯或改寫。來自備援站的內文 MUST NOT 以機器翻譯處理，其轉換規則見「備援站規格以用語對照表轉為日文」需求。

說明區塊不存在、或裡面找不到規格段落時，工具 SHALL 明確標示未取得內文，MUST NOT 悄悄產生空字串，也 MUST NOT 退而取其他段落充數。內文擷取的失敗與圖片匯入的失敗 MUST 互相獨立。

#### Scenario: 只取規格

- **WHEN** 商品頁的說明區塊同時有「製品仕様」與「解説」
- **THEN** 擷取結果只有「製品仕様」那一段，解説的內容 MUST NOT 出現在任何輸出裡

#### Scenario: 備援站只取規格欄位

- **WHEN** 規格取自 amiami.com，資料同時有規格與製作人員欄位
- **THEN** 擷取結果只有規格那一段，製作人員 MUST NOT 出現在內文中

#### Scenario: 規格逐行呈現

- **WHEN** 商品規格在頁面上為多行（尺寸、素材、內容物各一行）
- **THEN** 擷取結果同樣為多行，MUST NOT 黏成一行

#### Scenario: 排除 hashtag

- **WHEN** 規格段落之後緊接站內 hashtag 標籤雲
- **THEN** 標籤雲的內容不出現在擷取結果中

#### Scenario: hashtag 區塊不存在

- **WHEN** 取得的頁面內容中沒有 hashtag 標籤雲
- **THEN** 擷取正常完成，MUST NOT 視為失敗

#### Scenario: 內文擷取失敗但圖片成功

- **WHEN** 圖片全部匯入成功，但說明區塊擷取不到內容
- **THEN** 圖片照常入列，工具明確標示未取得內文

### Requirement: 多站備援

工具 SHALL 以 amiami.jp 為預設來源；amiami.jp 在某個步驟取不到資料時，SHALL 依序改試 amiami.com 英文站、amiami.com 中文站。

「取不到資料」指：挑戰頁在重抓上限內未通過、該站回應錯誤、該站回傳無法解析出資料的內容（包括 amiami.com 資料 API 的錯誤回應），以及 amiami.jp 回報該商品頁不存在。**合法的「查無商品」不屬於取不到資料**——amiami.jp 明確回報零筆時，SHALL 仍改試其他站，但全部站皆明確零筆時，工具 SHALL 顯示「查無商品」，而非失敗。

備援 SHALL 以**步驟**為單位：搜尋與商品頁擷取各自從 amiami.jp 開始嘗試。商品代碼（`gcode`）三站共用，因此無論搜尋是在哪一站成功，商品頁擷取 SHALL 仍先試 amiami.jp，以取得日文原文的規格。

同一次匯入的圖片、商品名與規格 SHALL 來自同一站的同一筆商品資料，MUST NOT 混用兩站的內容——兩站的圖庫順序與張數不保證一致，混用會產生重複或缺漏而使用者無從察覺。

來自備援站的規格 MUST NOT 以機器翻譯轉成日文——錯誤的日文比沒有日文更糟，使用者會把它當原文貼上架。備援站規格 SHALL 依「備援站規格以用語對照表轉為日文」需求處理：只轉換對照表對得上的行，其餘保留英文。內文面板 SHALL 明確標示該段規格的來源站，以及它是經對照表轉換、而非日文原文。

#### Scenario: jp 正常時不使用備援

- **WHEN** amiami.jp 的搜尋與商品頁都正常取得
- **THEN** 工具不對 amiami.com 發出任何請求

#### Scenario: jp 搜尋失敗改用英文站

- **WHEN** amiami.jp 的搜尋取不到資料，英文站的搜尋成功
- **THEN** 工具以英文站的搜尋結果繼續，並在進度中顯示已改用英文站

#### Scenario: jp 查無改用英文站

- **WHEN** amiami.jp 的搜尋明確回報零筆，英文站有該商品
- **THEN** 工具以英文站的搜尋結果繼續，MUST NOT 顯示查無商品

#### Scenario: 搜尋在備援站成功後仍回 jp 取規格

- **WHEN** 搜尋是由英文站取得 gcode
- **THEN** 商品頁擷取先以該 gcode 嘗試 amiami.jp，成功時規格為日文原文

#### Scenario: jp 沒有該商品頁

- **WHEN** 商品頁擷取時，amiami.jp 回報該 gcode 的頁面不存在
- **THEN** 工具不重抓 amiami.jp，記下「此站沒有這個商品」並改試英文站

#### Scenario: 英文站也失敗改用中文站

- **WHEN** amiami.jp 與英文站在同一步驟都取不到資料
- **THEN** 工具改試中文站

#### Scenario: 備援站系統錯誤頁

- **WHEN** amiami.com 的資料 API 回應錯誤或無法解析的內容（以資料 API 取代頁面之後，這就是原本「系統錯誤頁」的對應情況）
- **THEN** 工具將其視為該站此步驟失敗並繼續備援，MUST NOT 解析為零筆或查無商品

#### Scenario: 規格來自備援站

- **WHEN** amiami.jp 的商品頁取不到，規格由英文站取得
- **THEN** 內文面板顯示經對照表轉換的規格，標示來源為 amiami.com 英文站且為依對照表轉換，對不上的行保留英文並標出，MUST NOT 顯示機器翻譯結果

#### Scenario: 全部站明確查無

- **WHEN** 三個站都明確回報該 JAN 零筆
- **THEN** 工具顯示「查無商品」，MUST NOT 顯示為失敗
