## MODIFIED Requirements

### Requirement: 整合工作台頁面

專案 SHALL 新增頁面 `studio.html`，在單一次選檔中同時完成裸露遮罩與賣場套框。此頁 MUST NOT 修改 `index.html` 的任何行為，且 MUST NOT 改變 `censor.html` 的任何可觀察行為。

由於需載入偵測模型，此頁 MUST 以 `http://` 協定開啟；偵測到自身以 `file://` 開啟時 SHALL 顯示明確指引，而非讓載入靜默失敗。

視覺風格 SHALL 沿用既有兩頁的設計語彙（cream/amber/brown 色系、左清單右預覽的雙欄佈局、圓角面板、同一套字級變數）。

`studio.html` MUST NOT 顯示三頁互切的導覽列——它是主力工作頁，來回切換不是它的日常。`index.html` 與 `censor.html` 的導覽列 SHALL 維持三個項目、`studio.html` 排在第一位並標示為建議入口，讓另外兩頁仍連得回來。

`photo-framing` 與 `nudity-censoring` 的既有需求繼續且僅描述 `index.html` 與 `censor.html`；`studio.html` 的對應行為由本規格以逐位元一致的方式錨定，不重述其內容。

#### Scenario: 以本機 server 開啟

- **WHEN** 使用者透過 `http://localhost` 或 GitHub Pages 開啟 `studio.html`
- **THEN** 頁面正常運作，可選檔、預覽、輸出

#### Scenario: 誤以 file:// 雙擊開啟

- **WHEN** 使用者雙擊 `studio.html`，瀏覽器以 `file://` 載入
- **THEN** 頁面顯示需以本機 server 開啟的指引與具體指令，MUST NOT 只顯示無說明的載入失敗

#### Scenario: 不影響既有兩頁

- **WHEN** 本變更完成後，使用者雙擊 `index.html`
- **THEN** 套框工具行為與變更前完全一致，且不需要任何 server

#### Scenario: 導覽列

- **WHEN** 使用者開啟 `index.html` 或 `censor.html`
- **THEN** 導覽列顯示三個項目，`studio.html` 位於第一位且標示為建議入口，當前頁以 `aria-current="page"` 標記

#### Scenario: 主力頁不放導覽列

- **WHEN** 使用者開啟 `studio.html`
- **THEN** 頁面 MUST NOT 出現導覽列，標題直接位於頁首

### Requirement: 輸出命名與資料夾結構

工具 SHALL 提供一個輸出命名欄位。設定後，該名稱 MUST 同時套用到 ZIP 檔名、ZIP 內的資料夾名與各個檔案名；留白時 SHALL 沿用既有規則（ZIP 為 `money-sorry-<YYYYMMDD>-<HHMM>.zip`，檔案沿用原檔名加後綴）。

ZIP **一律**開一層資料夾。輸出單張時 MUST 直接下載該檔案，不打包、因此也沒有資料夾。

ZIP 內 MUST 只有圖片。已擷取的商品說明 MUST NOT 被打包——它的用途是被貼進賣場欄位，留在頁面上複製比從壓縮檔裡撈出來再開起來看更短。

命名欄位的內容 MUST 經過消毒：`/ \ : * ? " < > |` 與前後的空白、句點一律移除。中文 MUST 正常保留（UTF-8，general purpose flag bit 11）。

清單的每一列 SHALL 顯示該張照片實際會輸出的檔名，並隨命名欄位的輸入即時更新——命名結果直接標在它所屬的那一列上，不另設集中的預覽區塊。

#### Scenario: 設定命名

- **WHEN** 使用者輸入「錢錢抱歉」並輸出 30 張
- **THEN** 下載 `錢錢抱歉.zip`，內含資料夾 `錢錢抱歉/`，其中檔案為 `錢錢抱歉-01.jpg` … `錢錢抱歉-30.jpg`

#### Scenario: 未設定命名

- **WHEN** 命名欄位留白並輸出 3 張
- **THEN** 下載 `money-sorry-<YYYYMMDD>-<HHMM>.zip`，內含同名資料夾，檔案沿用原檔名加後綴

#### Scenario: 單張不打包

- **WHEN** 只有 1 張可輸出、命名為「錢錢抱歉」
- **THEN** 直接下載該檔案，不產生 ZIP，也不產生資料夾——有沒有已擷取的商品說明都一樣

#### Scenario: ZIP 內只有圖片

- **WHEN** 使用者匯入商品後命名為「錢錢抱歉」並輸出 11 張
- **THEN** ZIP 內為 `錢錢抱歉/`，含 `錢錢抱歉-01.jpg` … `錢錢抱歉-11.jpg`，MUST NOT 出現任何 `.txt`

#### Scenario: 命名含非法字元

- **WHEN** 使用者輸入 `商品/A:主圖 `
- **THEN** 實際使用的名稱為 `商品A主圖`，ZIP 內 MUST NOT 出現額外的路徑層級

#### Scenario: 命名結果即時反映在每一列

- **WHEN** 使用者在命名欄位中逐字輸入
- **THEN** 清單每一列顯示的輸出檔名同步更新為新的名稱與序號

## ADDED Requirements

### Requirement: 商品說明區塊的內容與層級

商品說明區塊 MUST NOT 放標題——不放商品名稱，也不放「商品說明」這類只描述容器的字。商品名稱已經在左欄的輸出命名卡上（可一鍵填入檔名），在這裡重複一次只是佔掉可讀內容的位置。區塊內 SHALL 只有段落標題與內文，加上一個複製動作。

區塊內的兩個層級——段落標題與內文——MUST NOT 只靠字級區分。既有字級級距相鄰兩階僅差 0.5px，只調字級等於沒有區分。

匯入多個商品時，各商品的區塊之間 SHALL 有可見的分界。

#### Scenario: 單一商品

- **WHEN** 匯入一個商品且它有說明
- **THEN** 區塊內只有段落標題、內文與複製動作，MUST NOT 出現商品名稱

#### Scenario: 多個商品

- **WHEN** 使用者匯入第二個商品
- **THEN** 兩個商品的內容各自成塊，之間有可見的分界

#### Scenario: 兩個層級可分辨

- **WHEN** 使用者閱讀商品說明
- **THEN** 段落標題與內文在視覺上明確不同，且差異 MUST NOT 僅來自字級

## REMOVED Requirements

### Requirement: 商品說明的標題與層級

**Reason**: 面板不再放標題，該需求的三個情境（單一商品的標題、多商品改顯示件數、三個層級可分辨）已無對應物。

**Migration**: 由「商品說明區塊的內容與層級」取代——同一件事的新版本，層級從三個降為兩個，並改為明文禁止標題。商品名稱的落點不變：仍在左欄「輸出設定」卡上，見 `amiami-import` 的「商品名可填入輸出命名」。
