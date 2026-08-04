## MODIFIED Requirements

### Requirement: 獨立的遮罩頁面

專案 SHALL 新增獨立頁面 `censor.html`，提供選圖、偵測、遮罩、輸出的完整流程。此頁 MUST NOT 修改 `index.html` 的行為，且 MUST NOT 與 `index.html` 共用程式碼或互相呼叫——`index.html` 必須維持單一檔案、雙擊即用、可單獨傳遞的性質。

此限制 MUST NOT 延伸到其他同樣需要 `http://` 協定的頁面。`censor.html` SHALL 得與 `studio.html` 透過 `lib/` 下的 classic script 共用實作（ZIP 打包、下載觸發、檔名去重等），以避免同一份程式碼出現第三份複製。共用模組 MUST NOT 使用 ES module，MUST NOT 引入 build 步驟，且抽換 MUST NOT 改變 `censor.html` 的任何可觀察行為。

由於需載入約 12MB 的偵測模型，此頁 MUST 以 `http://` 協定開啟；MUST NOT 假設能以 `file://` 雙擊使用。頁面在偵測到自身以 `file://` 開啟時 SHALL 顯示明確指引，而非讓模型載入靜默失敗。

視覺風格 SHALL 沿用 `index.html` 的設計語彙（cream/amber/brown 色系、左清單右預覽的雙欄佈局、圓角面板）。

#### Scenario: 以本機 server 開啟

- **WHEN** 使用者透過 `http://localhost` 開啟 `censor.html`
- **THEN** 模型正常載入，介面顯示可用狀態

#### Scenario: 誤以 file:// 雙擊開啟

- **WHEN** 使用者雙擊 `censor.html`，瀏覽器以 `file://` 載入
- **THEN** 頁面顯示「此頁需以本機 server 開啟」的指引與具體指令，MUST NOT 只顯示無說明的載入失敗

#### Scenario: 不影響套框工具

- **WHEN** 本變更完成後，使用者雙擊 `index.html`
- **THEN** 套框工具行為與變更前完全一致，且不需要任何 server

#### Scenario: 套框頁不得引用共用模組

- **WHEN** 使用者只複製 `index.html` 一個檔案到別台電腦並雙擊開啟
- **THEN** 套框工具完整可用，MUST NOT 因缺少 `lib/` 而失效

#### Scenario: 抽換共用模組後行為不變

- **WHEN** `censor.html` 中的重複實作改為引用 `lib/`
- **THEN** 對同一批照片與同一組遮罩框，其輸出的位元組 MUST 與抽換前完全相同，且 `tools/verify/censor.mjs` 全數通過
