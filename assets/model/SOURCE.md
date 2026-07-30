# MoveNet SinglePose Thunder v4（TF.js 格式）

這四個檔案是姿態偵測模型的權重，`build-censor.js` 會把它們 base64 內嵌進 `censor.html`。

```
model.json               拓樸 + 權重清單（164KB）
group1-shard1of3.bin     4.0MB
group1-shard2of3.bin     4.0MB
group1-shard3of3.bin     3.9MB
```

## 為什麼權重進版控

**因為原始下載點已經死過一次。** 這個模型原本掛在 `tfhub.dev`，該站已下線；目前只能透過 Kaggle Models 的重導向取得，而那個 URL 也隨時可能再變。權重是決定遮罩位置的東西——換一份就等於換一套幾何，`tools/verify/baseline.json` 全部作廢。

13MB 換「clone 下來就能建置、且十年後拿到的是同一份權重」，值得。

## 來源

```
https://www.kaggle.com/models/google/movenet/frameworks/tfJs/variations/singlepose-thunder/versions/4/model.json?tfjs-format=file&tfhub-redirect=true
```

`?tfjs-format=file&tfhub-redirect=true` 這兩個參數不能省，否則拿到的是網頁而不是 JSON。`model.json` 裡的 `weightsManifest[].paths` 是相對路徑，三個 shard 要用同一個目錄前綴各自抓下來。

- 授權：Apache License 2.0（Google）
- 輸入：`[1, 256, 256, 3]`，dtype **`int32`**（不做 0..1 正規化，這點與多數模型不同）
- 輸出：`[1, 1, 17, 3]` → 17 個 COCO 關鍵點的 `(y, x, score)`，座標為輸入方框的正規化值

## 換模型

放新的 `model.json` 與 shard 進來，重跑 `node build-censor.js`。輸入尺寸由建置腳本自動從 `model.json` 讀出，不需手改。

**換完一定要重跑驗證**，並預期 `baseline.json` 需要 `--update`：

```bash
node build-censor.js
cd tools/verify && npx playwright test     # 這支不能紅，紅了代表遮罩位置真的錯了
node tools/verify/verify.js                # 這支會紅是正常的，確認疊圖無誤後 --update
```
