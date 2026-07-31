# 換一台電腦繼續開發

這份文件的目的：**在另一台電腦 clone 下來之後，不必回頭問任何人就能建置、驗證、繼續開發 `censor.html`（遮罩工具）。**

`index.html`（套框工具）不需要這份文件——它零依賴、雙擊就能用、clone 下來就是完整的。

---

## 一、五分鐘上手

```bash
git clone https://github.com/one-liang/money-sorry.git
cd money-sorry
git checkout feature/add-nudity-mask-tool

node build-censor.js                    # 產生 censor.html（約 18MB，不需網路）
open censor.html                        # 就可以用了（Windows 用 start，或直接雙擊）
```

**建置不需要網路**，模型權重已經在 `assets/model/` 裡（理由見 `assets/model/SOURCE.md`）。

要跑驗證的話，還需要把商品照搬過來——見第三節。

### 環境需求

| | 需求 | 備註 |
|---|---|---|
| Node | ≥ 18 | 只有建置與驗證腳本需要。目前在 v24.14.0 上開發 |
| Chrome | 系統已安裝的正式版 | 驗證用。Playwright 設 `channel: 'chrome'`，**不另外下載瀏覽器** |
| npm 套件 | 只有 `@playwright/test` | 只有 `tools/verify/` 用得到；工具本身零相依 |
| GPU | 有 WebGL 硬體加速為佳 | 沒有會退回 CPU，慢一到兩個數量級但結果一樣 |

`verify.js` / `verify-output.js` 會自動找 macOS / Windows / Linux 上的 Chrome（`tools/verify/chrome.js`）。裝在非預設位置時指定：

```bash
CHROME_PATH=/usr/bin/google-chrome node tools/verify/verify.js
```

> **三支驗證在 macOS 與 Windows 都能跑。** `verify-output.js` 的外部驗證工具依平台而異——原則是「不自驗自己的 ZIP 實作」，所以每個平台都用兩個彼此獨立的實作，一個驗完整性、一個實際解壓：
>
> | | 完整性 | 解壓 |
> |---|---|---|
> | macOS / Linux | Info-ZIP `unzip -t` | `ditto -xk`（macOS）／ `unzip -o` |
> | Windows | `tar -xOf`（system32 的 bsdtar，逐筆驗 CRC32） | .NET `ZipFile::ExtractToDirectory` |
>
> Windows 沒有內建 `unzip`（Git Bash 帶的那支不在 Windows PATH 上）。若你的 Windows 上另外裝了 Info-ZIP 並加進 PATH，完整性那關會自動優先用 `unzip -t`。

---

## 二、什麼在版控裡、什麼不在

這是換電腦最容易踩到的地方。

```
進版控 ────────────────────────────────────────────────────────
  index.html                    套框工具本體
  src/censor.template.html      遮罩工具原始碼
  src/censor-core.js            ★ 遮罩演算法核心（所有門檻與幾何係數在這）
  build-censor.js               建置腳本
  assets/model/                 MoveNet 權重 13MB（刻意進版控，見 SOURCE.md）
  assets/vendor/tf.min.js       TensorFlow.js 4.22.0
  tools/verify/                 驗證工具 + baseline.json + targets.json + 素材清單
  openspec/                     ★ 規格與每一個設計決策的理由

不進版控 ──────────────────────────────────────────────────────
  censor.html                   建置產物，每次都會整個重寫 → node build-censor.js
  test/                         商品照，含 test/reference/ → 見第三節
  tools/verify/node_modules/    → cd tools/verify && npm i
  tools/verify/out/             驗證疊圖（內容是商品照）
```

**`test/` 不進版控是使用者明確要求的**，那是商品照。這個決定的代價就是換電腦要另外搬，第三節處理。

---

## 三、把驗證素材搬過去

`test/` 有 **34 個檔案**（31 張商品照 + `test/reference/` 三張手工遮罩成品），驗證全靠它們。

**搬運方式：AirDrop、USB、或直接接線的區網傳輸。不要放雲端硬碟、不要用聊天軟體傳、不要進任何 git repo。** 這是成人商品照，同時也是這個專案「照片不離開這台電腦」原則的一部分。

搬完在新機器上驗一次：

```bash
node tools/verify/check-test-set.js
```

```
34/34 相符
✓ 素材與清單一致
```

`tools/verify/test-manifest.json` 存了每個檔案的 SHA-256。**這一步不要跳過**——少一張圖或傳壞一張，底下所有驗證的數字都會對不上，而那看起來會完全像是程式壞了。

---

## 四、跑驗證

```bash
node tools/verify/check-test-set.js       # 0. 先確認素材完整

cd tools/verify && npm i && cd ../..      # 只需一次
node build-censor.js                      # 確保 censor.html 是最新的

cd tools/verify && npx playwright test     # 1. ★ 遮罩正確性（最重要）
cd ../.. && node tools/verify/verify.js    # 2. 全批回歸，與 baseline.json 比對
node tools/verify/verify-output.js         # 3. ZIP 結構、時間戳、原檔雜湊
```

在原開發機上，這三支的預期結果是：

```
playwright test      17 passed
verify.js            31 張 · 🟢21 🟡1 🔴9 · 網路呼叫 0 次 · ✓ 與基準完全一致
verify-output.js     ✓ 全部通過
```

### 這三支各自在證明什麼

**1. `npx playwright test` —— 唯一能證明「沒有漏遮」的東西**

| 測試群 | 在驗什麼 |
|---|---|
| 參考成品比對 | 我們的遮罩必須**完全包住** `test/reference/` 那三張使用者手工塗黑的**像素**（先剝掉成品的白邊——成品是 contain 進白底方形，不是縮放，這點搞錯會讓覆蓋率被系統性高估，見 design.md 決策 13）|
| 裸露區域覆蓋 | `targets.json` 裡人工標定的裸露區域必須 **100% 被覆蓋**（該張若已被工具舉手為 🔴 則跳過） |
| 全批不變式 | 不會有「有裸露卻既沒遮罩也沒舉手」的圖溜出去 |

**這支紅了就是真的錯了**，不要放寬標準，去查 `src/censor-core.js` 的幾何。

**2. `node tools/verify/verify.js` —— 防止改動造成非預期的位移**

逐張比對遮罩座標與 `baseline.json`，容許 1.0px。它不知道什麼叫「對」，只知道「跟上次一不一樣」。

> **跨機器的注意事項**：基準是在 Mac（Apple M4）上建立的。2026-07-31 在 Windows 10 + 另一顆 GPU 上重跑，**31 張全部與基準完全一致，0px 差異**——比原先預期的樂觀。但這只是第二個資料點，**不同 GPU / 驅動的 WebGL 浮點實作仍有差異空間，換機器後出現幾 px 的差不必然是程式壞了。**
>
> 判斷方式：**先看 playwright test**。它綠、而 verify.js 只差幾 px → 是機器差異，在新機器上跑 `--update` 重建基準即可。playwright test 也紅 → 是真的迴歸，不要 update。

```bash
node tools/verify/verify.js --overlay      # 輸出疊圖到 tools/verify/out/，肉眼檢查
node tools/verify/verify.js --update       # 確認無誤後才更新基準
```

**3. `node tools/verify/verify-output.js` —— 輸出路徑**

ZIP 交給系統上的外部解壓器檢查（不自驗自己的 ZIP 實作，工具依平台而異見第一節），`raw/` 用 SHA-256 比對是否位元組層級相同，加上檔案時間戳與成品尺寸。

### 什麼時候一定要跑

- 動了 `src/censor-core.js` 的任何參數之後
- 換模型之後（見 `assets/model/SOURCE.md`）
- **進了新商品線之後** —— 模型是真人照訓練的，非人形／獸耳全身毛／機械體都落在未驗證區域

---

## 五、要改東西的話，先讀哪裡

**所有的「為什麼是這個數字」都在 `openspec/changes/add-nudity-mask-tool/`，不在程式碼註解裡。**

```
openspec/changes/add-nudity-mask-tool/
├── proposal.md    做什麼、不做什麼、為什麼要做
├── design.md      ★ 13 個設計決策 + 實測數據 + 被否決的方案與否決理由
├── specs/nudity-masking/spec.md    規格（SHALL / MUST 條款 + 情境）
└── tasks.md       實作清單（全部已完成）
```

`design.md` 是最值得先讀的。它記錄了幾件事，這些是重跑實驗才會知道、光看程式碼看不出來的：

- 為什麼用姿態關鍵點而不是 NSFW 偵測器（很多素材已經被光暈預先審查過，而「M字腿」是姿勢不是身體部位）
- 為什麼是 Thunder 不是 Lightning 或 MultiPose
- 為什麼「側面」這一類被整個移除（實測 23 張，`肩寬/軀幹長` 分佈完全連續，沒有鑑別力）
- 為什麼下半身帶要錨定髖部（不錨定會讓長軀幹體型漏遮，實測有一張只蓋到 35%）
- 為什麼趴跪／躺臥要一律舉手（軸傾角 73°/77° 與其餘 ≤26° 之間空了 47 度，分得很乾淨）

### 演算法在哪

`src/censor-core.js` 是**單一真實來源**——`censor.html` 內嵌它、Node 驗證工具也 require 它，**兩邊跑的是同一份程式碼**。改參數只需改這一個檔案，然後 `node build-censor.js`。

檔案開頭兩個常數物件就是全部的可調參數：

```js
const G = { ... }   // 幾何：帶子的位置與寬度，單位是「肩寬的倍數」
const T = { ... }   // 門檻：信心值、結構合理性檢查的上下界
```

想讓遮罩更貼身，主要的旋鈕是 `G.chest.halfW`（胸部帶半寬）與 `G.chest.t1`（下緣）。目前的遮罩聯集面積是使用者手工參考成品的 2.1–2.3 倍，主因是胸部帶從鎖骨蓋到乳下緣、而手工的只蓋乳頭一帶。**調小它之後 playwright test 會立刻告訴你有沒有掉出 100% 覆蓋。**

半身模式（`bust`）的胸部帶是**刻意鋪滿畫面寬**的，那不是算爆——理由見 design.md 決策 7d。要收窄它前先讀那一節。

---

## 六、不要做的事

| | 為什麼 |
|---|---|
| **不要 commit `test/`** | 使用者明確要求。已在 `.gitignore` |
| **不要動 `index.html`** | 它是獨立的另一個工具，60KB、零依賴、雙擊即用。遮罩工具的任何東西都不該滲進去 |
| **不要在執行期加任何網路呼叫** | `censor.html` 有自我檢查（攔截 `fetch`/`XHR`/`WebSocket`/`sendBeacon`），介面上會顯示「網路呼叫 0 次」，驗證工具也會斷言為 0。照片不離開這台電腦是這個專案的硬性前提 |
| **不要為了讓測試變綠而放寬 `targets.json`** | 那份標定是唯一能證明「沒有漏遮」的東西。標定本身若真的畫錯了（有前例，差 5–6px）可以修，但要在 commit 訊息裡說清楚是修標定還是修程式 |
| **不要 commit `censor.html`** | 18MB 的建置產物，每次改模板都整個重寫，進版控會讓歷史暴增 |

---

## 七、目前狀態

分支 `feature/add-nudity-mask-tool`，從 `develop` 開出。

OpenSpec change `add-nudity-mask-tool` 的 59 項任務全部完成，`openspec validate --strict` 通過。三支驗證全綠（在 macOS 與 Windows 上都跑過）。

合回去的時候：

```bash
openspec archive add-nudity-mask-tool      # 把 change 併入正式規格並歸檔
git checkout develop && git merge --no-ff feature/add-nudity-mask-tool
```

### 已知的缺口

- **一張圖裡有兩尊 figure 時只會偵測到一尊**，第二尊不會有遮罩、也不會被結構檢查擋下。**這是目前唯一已知的靜默漏遮路徑。** 要修得換 MultiPose 模型
- 🔴 佔 29%（31 張裡有 9 張），這些必須人工畫框。刻意的取捨——寧可舉手也不要靜默地畫錯
- `targets.json` 只標了 12 張。**進新商品線時把新素材補進去**，否則覆蓋測試涵蓋不到新的體型與姿勢
