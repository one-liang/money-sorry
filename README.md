# money-sorry（錢錢抱歉 · 賣場批次套框）

把商品照批次套上「お金でごめんなさい / 錢錢抱歉」外框，一次選 N 張、輸出 N 張 1000×1000 的成品。

**零依賴、零 build、純本機。** 雙擊 `index.html` 就能用，不需要 node、不需要網路，照片不會離開這台電腦。

## 使用方式

1. 雙擊 `index.html`（**建議用 Safari 開**，見下方 HEIC 說明）
2. 點選或拖入商品照，可一次多張
3. 右側預覽會顯示合成結果；**點左邊清單的任一張**（或按 <kbd>↑</kbd><kbd>↓</kbd>）可切換預覽對象
4. 按「打包下載 N 張（ZIP）」

**多張**會打包成一個 ZIP：`money-sorry-20260729-2137.zip`。
**單張**則直接給 JPG，不多包一層。

ZIP 內的檔名為 `原檔名-money-sorry.jpg`，例如 `nendoroid-front.webp` → `nendoroid-front-money-sorry.jpg`。同名的照片會自動變成 `-2`、`-3`，不會互相覆蓋。

> **為什麼是 ZIP 而不是逐檔下載**：Safari 會**靜默丟棄**間隔太短的連續程式化下載——實測 5 連下載只有 3 個落地，被丟掉的那筆連 Safari 自己的下載紀錄都不會登記，使用者完全收不到錯誤。而 Safari 正是這個工具因為 HEIC 而推薦的瀏覽器。打包成單一下載可徹底消除這個問題（實測 5/5）。細節見 `design.md` 決策 4。

## 合成規則

```
每張照片獨立處理：

  createImageBitmap(file, { imageOrientation: 'from-image' })   ← 套用 EXIF 方向
        ↓
  偵測並去除純色留白邊 → 得到「內容矩形」
        ↓
  1000×1000 canvas
    ① 鋪白底（去背 PNG 轉 JPEG 才不會變黑）
    ② 內容矩形以 cover 置中裁切後填滿
    ③ 外框整張疊上
        ↓
  toBlob('image/jpeg', 0.92)
        ↓
  多張 → store-only ZIP（手寫，零依賴）→ 單次下載
  單張 → 直接下載 JPG
```

**cover 置中裁切**：`scale = max(1000 / 內容寬, 1000 / 內容高)`，超出的軸向左右（或上下）等量裁除。不留白、不變形。

```
836×750 的橫向照片（無留白邊）：
  scale = max(1000/836, 1000/750) = 1.333
  縮放後 1114×1000 → 左右各裁 57px → 輸出 1000×1000
```

### 自動去除純色留白邊

賣場素材常見「內容被塞在正方形畫布中間、左右（或上下）補白」的圖。這種圖原本會原樣輸出（因為它已經是正方形，cover 不裁不縮），商品在框裡顯得很小。工具會先把留白邊排除，再以剩下的內容去算 cover。

```
1000×1000，左右各約 114px 純白：
  去邊後內容 771×1000
  scale = max(1000/771, 1000/1000) = 1.297
  來源取 771×771 置中 → 輸出 1000×1000，內容填滿、比例不變
```

判定刻意保守，**寧可不裁也不要裁進內容**：

| 條件 | 作用 |
|---|---|
| 四角取樣亮度 ≥ 215 | 只認淺色留白，深色純底照不會被吃掉 |
| 四角之間通道最大差 ≤ 12 | 白／米色／淺灰都吃得到；四角落在內容上則放棄 |
| 只修單軸（左右**或**上下） | **四邊都有留白＝純色底商品照，不動它** |
| 整列／整行全為背景才算留白 | 遇到任一內容像素就停，不用逐點 bounding box |

有去邊的照片會在左邊清單標示「已去左右白邊」／「已去上下白邊」，方便掃一眼確認有沒有誤判。判定門檻的取值理由與實測數據見 `openspec/changes/archive/2026-07-29-trim-margins-and-click-preview/design.md`。

> 去邊後若內容不是正方形，填滿 1000×1000 仍然只有三種結局：裁掉、留白、變形。本工具選擇**置中裁掉**——上例會從上下各捨去約 148 輸出像素。頂天構圖（例如頭頂貼齊上緣）會被切到，預覽可逐張檢查。

## 已知限制

- **外框橫幅會蓋住照片的左上角與右下角**（各約 52% 寬 × 10% 高）。這是外框設計本身的性質，商品主體請盡量置中。完全不會被蓋到的區域是 `x 21..978 / y 89..892`。
- **來源照片短邊建議 ≥ 1000px**。小於這個尺寸會被放大而略糊（例如 750px 需放大 33%）。工具不會因此拒絕該檔。去留白邊會讓實際放大倍率更高，效果同理。
- **去留白邊只處理純色、單軸的留白**。漸層留白、帶陰影或浮水印的邊、以及只有單邊有留白的圖都不會被處理；四邊都是淺色底的棚拍照也刻意不處理，避免貼著商品裁。
- **HEIC 只有 Safari 能解碼**。Chrome / Firefox 選到 iPhone 的 `.heic` 會標示失敗並提示改用 Safari，但不影響同批其他檔案。
- 不做多張拼貼版型，也不做自由拖拉定位。一張照片進、一張成品出。

## 換外框

外框以 **base64 data URI 內嵌在 `index.html` 裡**，不是從 `assets/frame.png` 載入的。

這是必要的：在 `file://` 協定下，Chrome 把每個本機檔案視為獨立的 opaque origin，用 `<img src="assets/frame.png">` 載入後繪入 canvas 會使 canvas 被 taint，接著 `canvas.toBlob()` 會拋出 `SecurityError`。使用者選的照片走 File API 不會有這問題，唯獨磁碟上的外框資產會。

要換框時：

```bash
# 1. 換掉來源外框
cp 新外框.png assets/frame.png

# 2. 產生 base64
base64 -i assets/frame.png | tr -d '\n' | pbcopy

# 3. 編輯 index.html，把 FRAME_DATA_URI 這行的 base64 換成剪貼簿內容
#    const FRAME_DATA_URI = 'data:image/png;base64,<貼在這>';
```

若新外框不是 1000×1000，同時把 `index.html` 裡的 `const SIZE = 1000;` 改成新的邊長即可（cover 計算會自動跟著走）。

## 檔案

```
money-sorry/
├── index.html                    # 全部：HTML + CSS + JS + 內嵌外框（約 70KB）
├── assets/
│   ├── frame.png                 # 原始外框 1000×1000 RGBA，換框時用
│   └── reference/
│       ├── sample-photo.webp     # 測試素材
│       └── sample-output.jpeg    # 風格參考（非本工具輸出格式）
└── openspec/                     # 規格與設計決策
    ├── specs/photo-framing/      # 目前的主規格（12 條 requirement）
    └── changes/archive/          # 每次變更的 proposal / design / tasks
        ├── 2026-07-29-add-money-sorry-frame-tool/
        └── 2026-07-29-trim-margins-and-click-preview/
```
