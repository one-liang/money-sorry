## Why

上架成人向 figure 商品照時，蝦皮／FB 等平台要求裸露部位必須以色塊遮蔽。目前每天約 100 張以上的商品照全靠人工在影像編輯軟體逐張拉黑色矩形，是純重複勞動；而**漏遮一張的代價是商品下架、警告，最壞是封帳號**——這個失敗模式還是靜默的（自己不會發現，等平台通知才知道）。

既有的 `index.html` 解決了套框，但完全沒有觸及遮罩。這個 change 補上遮罩這一段。

三個 spike（S1/S2/S3）已在 `test/` 的 31 張真實商品照上跑完，證實「姿態關鍵點 → 幾何推導遮罩」這條路可行，實測數據見 `design.md`。本提案建立在那些數字之上，不是估計。

## What Changes

- 新增 **`censor.html`**：一個獨立的本機批次遮罩工具，與 `index.html` 並存、互不干涉
- 內嵌 **TensorFlow.js + MoveNet SinglePose Thunder**（base64 data URI），在 `file://` 下零 fetch 執行；**BREAKING**：這個檔案約 18MB，`money-sorry` 專案不再是「全部零依賴」——但 `index.html` 維持 60KB 與零依賴不變
- 對每張照片自動推導**軸對齊純黑矩形遮罩**：胸部帶，以及依正面／背面／側面分別產生的胯部帶／臀部帶／合併帶
- **結構合理性檢查**：關鍵點不構成合理人形時（局部特寫、側面姿勢崩壞、幻覺偵測）**主動舉手轉人工**，而非產生看似合理但錯誤的遮罩
- **複核牆**：逐張顯示建議遮罩，可拖曳調整／新增／刪除；未處理完的紅色項目會**鎖死輸出鍵**，確保不會靜默輸出未遮的圖
- 一律產生遮罩建議，**不做「是否裸露」的自動判斷**——穿衣服的由人工刪框
- 遮罩座標存於**原圖座標空間**，輸出時同尺寸的已遮圖 + **完全未修改的原檔**兩份
- **Non-goals**：不做馬賽克／模糊／貼圖等其他遮罩樣式（只有純黑矩形）、不做遮罩範本存檔重用、不做雲端／上傳／帳號、**不在 `censor.html` 內做套框**——遮罩與套框是兩個互不蘊含的需求，兩個工具各自獨立

## Capabilities

### New Capabilities

- `nudity-masking`: 本機批次裸露部位遮罩——檔案選取、姿態偵測、結構合理性判定、遮罩幾何推導、複核與手動調整、輸出鎖死、雙版輸出（已遮 + 原檔）

### Modified Capabilities

（無——`index.html` 與 `photo-framing` 的既有需求完全不動）

## Impact

**新增檔案**

```
money-sorry/
├── censor.html                 # 遮罩工具（HTML+CSS+JS + 內嵌 tfjs + 內嵌模型權重，約 18MB）
└── assets/
    └── model/                  # MoveNet Thunder 原始權重，換模型時重新內嵌用
        ├── model.json
        └── group1-shard{1,2,3}of3.bin
```

**不動的檔案**

`index.html`、`assets/frame.png`、`openspec/specs/photo-framing/spec.md` 完全不受影響。

**技術面**

- 執行環境：瀏覽器，需 **WebGL**（實測 Chrome + ANGLE Metal / Apple M4）
- 相依：TensorFlow.js 4.22.0、MoveNet SinglePose Thunder v4——兩者皆以 base64 內嵌，**執行期零網路呼叫**（S1 已用 fetch/XHR 攔截器證實為 0 次）
- 效能實測：開啟到模型可用 2.7 秒；單張推論 16–22 ms；100 張純推論約 2 秒
- 部署：無。雙擊 `censor.html` 即用，可離線
- `test/` 已加入 `.gitignore`，商品照素材不進版控

**工作流程**

兩個工具各自獨立，不構成管線：

```
       ┌─▶ censor.html ─▶ masked/（已遮，維持來源尺寸）
商品照 ─┤              └─▶ raw/（完全原檔，位元組不變）
       │
       └─▶ index.html  ─▶ 1000×1000 已套框成品
```

需要遮罩與需要套框是兩件互不蘊含的事。兩者都要時，使用者自行把 `masked/` 的檔案再餵給 `index.html`。

**人力估算（100 張）**：推論 2 秒 + 複核約 6 分鐘（58% 掃視確認、19% 拖曳微調、19% 手動畫框）。
