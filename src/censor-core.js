// ══════════════════════════════════════════════════════════════════════════
// censor-core — 遮罩推導的純函式核心
//
// 這份檔案是演算法的單一真實來源：
//   · build-censor.js 把它內嵌進 censor.html（瀏覽器）
//   · tools/verify/verify.js 直接 require 它（Node 回歸驗證）
// 兩邊跑同一份程式碼，驗證工具測到的才是實際會執行的東西。
//
// 所有數值的依據見 openspec/changes/add-nudity-mask-tool/design.md 決策 4、7、8。
// 座標一律為「原圖像素座標」。
// ══════════════════════════════════════════════════════════════════════════
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CensorCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // COCO 17 點
  const KP = ['nose','Leye','Reye','Lear','Rear','Lsho','Rsho','Lelb','Relb',
              'Lwri','Rwri','Lhip','Rhip','Lkne','Rkne','Lank','Rank'];
  const I = {}; KP.forEach((k, i) => I[k] = i);

  // 遮罩幾何常數。t 為沿身體軸的位置、halfW 為半寬，單位皆為「肩寬」。
  const G = {
    chest:     { t0: 0.30, t1: 1.15, halfW: 0.72 },
    // 下半身帶的位置相對「髖部」而非肩線——髖部在軸上的位置 (torso/肩寬) 隨體型
    // 從 0.55 變化到 3.2，用肩寬的固定倍數定位會讓長軀幹的體型漏掉胯部。
    lower:     { dt0: -0.35, dt1: 1.00 },
    lowerMinW: 0.60,
    front:     { wMul: 1.15 },
    back:      { dt0: 0.15, dt1: 0.20, wMul: 1.25 },
    mLeg:      { dt0: -0.25, dt1: 1.20, kneeMul: 0.75 },
    halfWCap:  1.45,        // 最終上限（朝向倍率之後才套用）。實測 1.30 對參考圖只剩 14px 餘裕，太緊
    maxWidthFrac: 0.92,       // 遮罩寬度不得超過畫面此比例，避免滿版看起來像壞掉
    pad:       0.12,
  };

  // 閾值
  const T = {
    shoulder: 0.25, bustShoulder: 0.40, bustFace: 0.30, hip: 0.25, knee: 0.25,
    valid: 0.30, minValidPts: 4, minSpread: 0.04,
    torsoLo: 0.55, torsoHi: 3.2, hipRatioHi: 1.8, minShoulderFrac: 0.05,
    greenSho: 0.30, greenHip: 0.30,
    maxAxisTilt: 45,          // 軀幹軸偏離垂直超過此角度即視為趴/跪/躺姿
    mLegKneeSpan: 1.6, mLegKneeRise: 0.25,
  };

  // ── ① 結構合理性檢查 ────────────────────────────────────────────────
  // 信心分數會騙人：模型會在沒有人的圖上幻覺出關鍵點（實測 013460_21 幻覺出
  // 0.33 信心的肩膀對）。這裡檢查關鍵點是否構成合理人形，不合理就完全不出遮罩。
  function plausible(k, w, h) {
    const g = n => k[I[n]], c = n => g(n).s;
    const shoC = Math.min(c('Lsho'), c('Rsho'));
    const hipC = Math.min(c('Lhip'), c('Rhip'));
    const fail = reason => ({ ok: false, reason: reason, shoC: shoC, hipC: hipC });

    if (shoC < T.shoulder) return fail('肩部信心不足 (' + shoC.toFixed(2) + ')');

    const valid = k.filter(p => p.s >= T.valid);
    if (valid.length < T.minValidPts) return fail('有效關鍵點僅 ' + valid.length + ' 個');
    const bw = Math.max.apply(null, valid.map(p => p.x)) - Math.min.apply(null, valid.map(p => p.x));
    const bh = Math.max.apply(null, valid.map(p => p.y)) - Math.min.apply(null, valid.map(p => p.y));
    const spread = (bw * bh) / (w * h);
    if (spread < T.minSpread) return fail('關鍵點塌陷 (散佈 ' + (spread * 100).toFixed(1) + '%)');

    const shoW = Math.hypot(g('Lsho').x - g('Rsho').x, g('Lsho').y - g('Rsho').y);
    if (shoW < Math.min(w, h) * T.minShoulderFrac) return fail('肩寬過小');

    const sm = { x: (g('Lsho').x + g('Rsho').x) / 2, y: (g('Lsho').y + g('Rsho').y) / 2 };

    if (hipC >= T.hip) {
      const hipW = Math.hypot(g('Lhip').x - g('Rhip').x, g('Lhip').y - g('Rhip').y);
      const hm = { x: (g('Lhip').x + g('Rhip').x) / 2, y: (g('Lhip').y + g('Rhip').y) / 2 };
      const torso = Math.hypot(hm.x - sm.x, hm.y - sm.y);
      const tr = torso / shoW;
      // 側面視角會把肩寬投影壓扁，比例尺一崩遮罩就會塌成一小團 → 寧可舉手
      if (tr < T.torsoLo || tr > T.torsoHi) return fail('軀幹比例異常 (torso/肩寬 ' + tr.toFixed(2) + ')');
      if (hipW / shoW > T.hipRatioHi) return fail('髖肩比異常 (' + (hipW / shoW).toFixed(2) + ')');
      // 軀幹接近水平（趴、跪、躺）時，臀部相對髖部的位置與直立姿勢完全不同：
      // 臀部同時往軸向與垂直軸方向鼓出，我們的矩形推導補不滿（實測趴跪抬臀只蓋到 78%）。
      // 這個特徵分得很開——實測 31 張裡趴跪姿是 73°/77°，其餘最高 26°，中間空 47 度。
      const tilt = Math.abs(90 - Math.abs(Math.atan2(hm.y - sm.y, hm.x - sm.x) * 180 / Math.PI));
      if (tilt > T.maxAxisTilt) return fail('軀幹接近水平（偏離垂直 ' + tilt.toFixed(0) + '°），臀部幾何不可靠');
      return { ok: true, mode: 'full', shoC: shoC, hipC: hipC, shoW: shoW, hipW: hipW, torso: torso, sm: sm, hm: hm };
    }

    // 半身模式：沒有髖部就少了一個錨點。此時「有沒有臉」是最可靠的區分依據——
    // 有臉 = 半身照（可推導），沒臉 = 局部大特寫（無脈絡，不可推導）。
    const faceC = Math.max(c('nose'), c('Leye'), c('Reye'));
    if (faceC < T.bustFace) return fail('半身模式但無可辨識的臉 (face ' + faceC.toFixed(2) + ')');
    if (shoC < T.bustShoulder) return fail('半身模式肩部信心不足 (' + shoC.toFixed(2) + ')');
    return { ok: true, mode: 'bust', shoC: shoC, hipC: hipC, shoW: shoW, faceC: faceC, sm: sm };
  }

  // ── ② 正 / 背 判定 ─────────────────────────────────────────────────
  // 只分正面與背面。曾經有第三類「側面」，判準是 肩寬/軀幹長 與左右耳信心差，
  // 但在 31 張實測素材上這兩個特徵都沒有鑑別力：比值從 0.386 連續分佈到 0.930
  // 沒有分界，已知正面的 019307_06 (0.447) 比已知側面的 206175_13 (0.774) 還低；
  // 純側面的 206175_01 兩耳信心差是 0.00。誤判成側面會讓遮罩多吃一個 ×1.55，
  // 實測把下半身帶推到滿版。與其留一個猜的分類，不如拿掉它、把正面帶本身放寬。
  function orientation(k, P) {
    const g = n => k[I[n]];
    // MoveNet 的 L/R 是人物自身的左右：面向鏡頭時人物左肩落在畫面右側
    return g('Lsho').x > g('Rsho').x ? 'front' : 'back';
  }

  // ── ③ 遮罩幾何 ─────────────────────────────────────────────────────
  // 沿身體軸定位、垂直軸展開，最後取外接軸對齊矩形。取外接矩形必定 ≥ 旋轉矩形，
  // 而多遮是安全方向，剛好也是輸出需要的軸對齊黑矩形。
  function deriveMasks(k, P, ori, w, h) {
    const g = n => k[I[n]], c = n => g(n).s;
    const sm = P.sm, shoW = P.shoW;

    let ax = 0, ay = 1;                                    // 身體軸單位向量（肩→髖）
    if (P.mode === 'full') { ax = (P.hm.x - sm.x) / P.torso; ay = (P.hm.y - sm.y) / P.torso; }
    const px = -ay, py = ax;                               // 垂直於軸

    function rect(t0, t1, halfW) {
      // 上限在此統一套用，確保它是「最終」邊界而不是中途的值
      halfW = Math.min(halfW, G.halfWCap);
      const xs = [], ys = [];
      [t0, t1].forEach(t => [-halfW, halfW].forEach(s => {
        xs.push(sm.x + ax * t * shoW + px * s * shoW);
        ys.push(sm.y + ay * t * shoW + py * s * shoW);
      }));
      let x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
      let x1 = Math.max.apply(null, xs), y1 = Math.max.apply(null, ys);
      const mw = (x1 - x0) * G.pad, mh = (y1 - y0) * G.pad;
      x0 -= mw; x1 += mw; y0 -= mh; y1 += mh;
      // 寬度上限：超過就以中心等量收窄，而不是讓它撐到畫面兩端
      const maxW = w * G.maxWidthFrac;
      if (x1 - x0 > maxW) {
        const cx = (x0 + x1) / 2;
        x0 = cx - maxW / 2; x1 = cx + maxW / 2;
      }
      return { x0: Math.max(0, x0), y0: Math.max(0, y0),
               x1: Math.min(w, x1), y1: Math.min(h, y1) };
    }

    const out = [rect(G.chest.t0, G.chest.t1, G.chest.halfW)];
    if (P.mode !== 'full') return out;                     // 半身模式不憑空推測下半身

    const hipT = P.torso / shoW;                           // 髖部在身體軸上的位置
    // 下半身帶的起點不得晚於胸部帶的終點，否則兩條帶之間會出現一條沒遮到的空隙
    // （實測 206172_04 曾在 t=1.15~1.51 之間留下 0.015 畫面高的裸露縫）
    let t0 = Math.min(hipT + G.lower.dt0, G.chest.t1);
    let t1 = hipT + G.lower.dt1;
    let halfW = Math.max(P.hipW / shoW, G.lowerMinW);
    let mLeg = false;

    // M字腿：膝高於髖 且 兩膝大幅張開 → 改用膝距定寬
    if (Math.min(c('Lkne'), c('Rkne')) >= T.knee) {
      const kneeSpan = Math.abs(g('Lkne').x - g('Rkne').x);
      const hipY = (g('Lhip').y + g('Rhip').y) / 2;
      const kneeY = Math.min(g('Lkne').y, g('Rkne').y);
      if (kneeY < hipY + T.mLegKneeRise * P.hipW && kneeSpan > T.mLegKneeSpan * P.hipW) {
        mLeg = true;
        // 0.75 係數用來收斂膝距；最終上限統一在 rect() 裡套用
        halfW = (kneeSpan / 2) * G.mLeg.kneeMul / shoW;
        t0 = Math.min(hipT + G.mLeg.dt0, G.chest.t1); t1 = hipT + G.mLeg.dt1;
      }
    }
    // 少了「側面」這一類之後，正面帶本身放寬一些當作安全補償
    if (ori === 'back') { t0 += G.back.dt0; t1 += G.back.dt1; halfW *= G.back.wMul; }
    else                { halfW *= G.front.wMul; }

    out.push(rect(t0, t1, halfW));
    out.mLeg = mLeg;
    return out;
  }

  // ── 分級 ───────────────────────────────────────────────────────────
  // GREEN  結構通過且關鍵點信心充足
  // YELLOW 結構通過但關鍵點部分殘缺、或以半身模式處理
  // RED    結構未通過（無遮罩建議，必須人工處理）
  function grade(P) {
    if (!P.ok) return 'RED';
    return (P.mode === 'full' && P.shoC >= T.greenSho && P.hipC >= T.greenHip) ? 'GREEN' : 'YELLOW';
  }

  // ── 一次跑完：關鍵點 → { grade, reason, orientation, masks } ─────────
  function analyze(kps, w, h) {
    const P = plausible(kps, w, h);
    if (!P.ok) return { grade: 'RED', reason: P.reason, ori: null, mode: null, masks: [], mLeg: false };
    const ori = orientation(kps, P);
    const masks = deriveMasks(kps, P, ori, w, h);
    return {
      grade: grade(P), reason: '', ori: ori, mode: P.mode,
      masks: masks.map(m => ({ x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 })),
      mLeg: !!masks.mLeg,
    };
  }

  // ── 前處理幾何：置中 pad 成正方形後的縮放與位移 ─────────────────────
  // padX / padY 取整數（floor），且填補與座標還原 MUST 用同一組值，否則會有半像素偏移。
  function padGeometry(w, h, inputSize) {
    const S = Math.max(w, h);
    const padX = Math.floor((S - w) / 2), padY = Math.floor((S - h) / 2);
    return { S: S, scale: inputSize / S, padX: padX, padY: padY,
             padRight: S - w - padX, padBottom: S - h - padY };
  }

  // 模型輸出的正規化座標 [y, x, score] → 原圖像素座標
  function restoreKeypoints(raw, w, h, inputSize) {
    const geo = padGeometry(w, h, inputSize);
    return raw.map(r => ({ x: r[1] * geo.S - geo.padX, y: r[0] * geo.S - geo.padY, s: r[2] }));
  }

  return {
    KP: KP, I: I, G: G, T: T,
    plausible: plausible, orientation: orientation, deriveMasks: deriveMasks,
    grade: grade, analyze: analyze,
    padGeometry: padGeometry, restoreKeypoints: restoreKeypoints,
  };
});
