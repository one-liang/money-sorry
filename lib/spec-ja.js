/**
 * amiami.com 的英文規格 → amiami.jp「製品仕様」寫法的日文。內建用語對照表，不是機器翻譯。
 *
 * 為什麼可以查表（2026-10-13 實測，見 openspec/changes/archive/2026-10-13-spec-ja-phrasebook/design.md）：
 *   amiami.com 的英文規格是模板化的。抽樣 280 件，前二十種句型就涵蓋了絕大多數的行——
 *   類型、Scale:、Size:、Material:、[Set Contents]、Main figure、Base……
 *   再抓 37 件同商品的 amiami.jp 製品仕様逐行對照，這些句型都有固定的日文寫法。
 *   所以逐行比對句型、換成 amiami.jp 的寫法，結果可預期、可逐條驗證。
 *
 * 為什麼不做機器翻譯：錯誤的日文比沒有日文更糟——使用者會把它當原文貼上架。
 * 所以規則只有一條：**對得上才換，對不上整行保留英文**。一行裡只要有一個部分不認得，
 * 就不拼湊半句日文半句英文，整行原樣留下，由畫面標出來讓人看。
 *
 * 對照表只收**實測對照過**的寫法。amiami.jp 的用字各商品不一（塗装済み完成品／
 * 塗装済み完成品フィギュア），取多數。猜得到但沒對照過的（例如某個素材的日文），寧可不收。
 *
 * 純函式、不碰網路，見 tools/verify/spec-ja.mjs。
 * classic script，不是 ES module——引入 module 就等於引入 build 步驟。
 */
(() => {
  'use strict';

  const MS = (window.MS = window.MS || {});

  /** 比對用的正規化：大小寫、連續空白、全形空白都不算差異 */
  const key = s => String(s || '').replace(/[\s　]+/g, ' ').trim().toLowerCase();
  const table = pairs => new Map(Object.entries(pairs).map(([en, ja]) => [key(en), ja]));

  // ── 對照表 ────────────────────────────────────────────────────────────────
  // 新增條目時，在 tools/verify/spec-ja.mjs 加對應的檢查。

  /** 商品類型（規格的第一行）。逗號分隔的多個部分逐一查表，以「・」接起 */
  const TYPES = table({
    'Pre-painted Complete Figure': '塗装済み完成品',
    'Pre-painted Posable Figure': '塗装済み可動フィギュア',
    'Bonus Edition': '特典版',
  });

  /** 素材。全大寫的縮寫（PVC、ABS、POM、ATBC-PVC…）原樣保留，其餘查表 */
  const MATERIALS = table({
    'Plastic': 'プラスチック',
    'Cloth': '布',
    'Magnet': '磁石',
    'Polyester': 'ポリエステル',
    'Acrylic': 'アクリル',
  });
  const ABBR = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

  /** 尺寸括號裡的註記 */
  const SIZE_NOTES = table({
    'non-scale': 'ノンスケール',
    'non scale': 'ノンスケール',
    'including base': '台座含む',
    'base included': '台座含む',
    'base excluded': '台座を除く',
    'excluding base': '台座を除く',
  });

  /** 尺寸的方向字母（單一方向時）。W×D×H 這種多方向寫法 amiami.jp 保留字母，不走這張表 */
  const DIMS = { H: '全高', L: '全長', W: '横幅', D: '奥行' };

  /**
   * 特典段落 `[<誰> <哪種> Bonus]` 的「誰」。逗號分隔的多個逐一查表，以「、」接起。
   * 店名照 amiami.jp 的寫法；CyStore 在 amiami.jp 也是英文。
   */
  const WHO = table({
    'AmiAmi': 'あみあみ',
    'Animate': 'アニメイト',
    'Kotobukiya Shop': 'コトブキヤショップ',
    'CyStore': 'CyStore',
    'Goodsmile Online Shop': 'GOODSMILE ONLINE SHOP',
    'Good Smile Online Shop': 'GOODSMILE ONLINE SHOP',
    'First Press': '初回',
    'Deluxe Edition': '豪華版',
  });
  /** 「哪種」：長的寫在前面，先比對 */
  const BONUS_KIND = [
    [/\s*\bLimited Edition$/i, '限定版'],
    [/\s*\b(?:Exclusive|Limited)$/i, '限定'],
    [/\s*\bPurchase$/i, '購入'],
  ];

  /** 內容物（[Set Contents] 底下的一行）。整行查表；數量 `x3`／`: 1` 另外處理 */
  const ITEMS = table({
    'Main figure': 'フィギュア本体',
    'Figure': 'フィギュア本体',
    'Base': '専用台座',
    'Acrylic base': '専用アクリル台座',
    'Cloth base': '専用布台座',
    'Fluffy base': 'もふもふ台座',
    'Magnetic base (for magnet-soled shoes)': '専用台座(足裏マグネット対応)',
    'Magnetic base (for magnet-soled soles)': '専用台座(足裏マグネット対応)',
    'Display stand': 'ディスプレイスタンド',
    'Alternative face part': '差し替え顔パーツ',
    'Alternative expression part': '表情替えパーツ',
    'Optional face part': 'オプション顔',
    'Optional hand part': 'オプションハンド',
    'Interchangeable hand parts': '交換用手首一式',
    'Supporting pole extension part': '支柱延長パーツ',
    'Top': 'トップス',
    'Skirt': 'スカート',
    'Pants': 'ズボン',
    'Coat': 'コート',
    'Underwear': '下着',
    'Arm covers': 'アームカバー',
    'Chinese dress': 'チャイナドレス',
    'Shoes (with magnets in soles)': '靴(靴裏マグネット付)',
    'Knife': 'ナイフ',
    'Tin badge': '缶バッジ',
    'Shikishi': '色紙',
    'PET shikishi': 'PET色紙',
    'Illustration postcard': 'イラストポストカード',
    'Uchiwa part': '団扇パーツ',
    'Genga acrylic stand': '原画アクリルスタンド',
    'Genga wall scroll': '原画タペストリー',
    'LED acrylic display case': 'LEDアクリル展示ケース',
  });

  /** 內容物裡帶紙張尺寸的：`B2 wall scroll`、`Acrylic character plate (A5 size)` */
  const PAPER_ITEMS = [
    [/^([AB]\d) wall scroll$/i, m => m[1].toUpperCase() + 'タペストリー'],
    [/^Acrylic character plate \(([AB]\d) size\)$/i, m => 'アクリルキャラクタープレート(' + m[1].toUpperCase() + 'サイズ)'],
  ];

  /** 整句的注意事項 */
  const NOTES = table({
    '*The number (type) of optional parts does not include the pre-attached (standard) parts.':
      '※オプションパーツの数(種類)には、出荷時(標準)に取り付けられているものを含みません',
    '*Torso stand not included.': '※トルソーは付属しません。',
  });

  // ── 逐行規則：每個都是「英文片段 → 日文或 null」，null 表示對不上 ─────────

  const NUM = '(\\d+(?:\\.\\d+)?)';
  const UNIT = '(mm|cm)';

  /**
   * 'Approx. H235mm'、'H205mm'、'Approx. 12cm'、'W150 x D160 x H190mm'。
   * amiami.jp 的多數寫法：「全高：約260mm」、沒有「約」時「全高255mm」、括號裡「横幅約15cm」——
   * 冒號只出現在主尺寸帶「約」的時候。
   */
  function measure(s, inNote) {
    let m;
    if ((m = new RegExp('^(Approx\\.\\s*)?([HLWD])?\\s*' + NUM + '\\s*' + UNIT + '$', 'i').exec(s))) {
      const dim = m[2] ? DIMS[m[2].toUpperCase()] + (m[1] && !inNote ? '：' : '') : '';
      return dim + (m[1] ? '約' : '') + m[3] + m[4];
    }
    // 多方向：amiami.jp 保留 W／D／H 字母，只把 x 換成 ×
    const parts = /^(Approx\.\s*)?(.+?)\s*(mm|cm)$/i.exec(s);
    if (parts) {
      const dims = parts[2].split(/\s*x\s*/i);
      if (dims.length > 1 && dims.every(d => /^[WDH]\d+(?:\.\d+)?$/i.test(d))) {
        return (parts[1] ? '約' : '') + dims.map(d => d.toUpperCase()).join('×') + parts[3];
      }
    }
    return null;
  }

  /** 尺寸括號裡的一則註記：固定用語、'Approx. W15cm'、'Up to top of the head: Approx. 148mm' */
  function sizeNote(s) {
    const fixed = SIZE_NOTES.get(key(s));
    if (fixed != null) return fixed;
    const head = /^Up to (?:the )?top of the head\s*:\s*(.+)$/i.exec(s);
    if (head) { const v = measure(head[1], true); return v && '頭頂高：' + v; }
    return measure(s, true);
  }

  /** Size: 之後的值。逗號分隔的多段各自處理，以「、」接起 */
  function size(v) {
    const out = [];
    for (const seg of String(v).split(/\s*,\s*/)) {
      // 主體後面接零到多個括號註記
      const m = /^([^()]+?)((?:\s*\([^()]+\))*)$/.exec(seg.trim());
      if (!m) return null;
      const main = measure(m[1].trim());
      if (main == null) return null;
      let notes = '';
      for (const [, n] of m[2].matchAll(/\(([^()]+)\)/g)) {
        const ja = sizeNote(n.trim());
        if (ja == null) return null;
        notes += '(' + ja + ')';
      }
      out.push(main + notes);
    }
    return out.join('、');
  }

  /** 分隔符照英文的對應過去（amiami.jp 也是照著寫）：`,` → 、　`&` → ＆　`/` → /　空白 → 、 */
  const MAT_SEP = { ',': '、', '&': '＆', '/': '/' };

  function materials(v) {
    const tokens = String(v).trim().split(/(\s*[,&/]\s*|\s+)/);
    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (i % 2) { out += MAT_SEP[t.trim()] || '、'; continue; }
      if (!t) return null;
      if (ABBR.test(t)) { out += t; continue; }
      const ja = MATERIALS.get(key(t));
      if (ja == null) return null;
      out += ja;
    }
    return out || null;
  }

  function types(v) {
    const out = [];
    for (const p of String(v).split(/\s*,\s*/)) {
      const set = /^(?:(\d+)\s*pc\.?\s*set|Set of (\d+) Figures?)$/i.exec(p);
      if (set) { out.push((set[1] || set[2]) + '体セット'); continue; }
      const ja = TYPES.get(key(p));
      if (ja == null) return null;
      out.push(ja);
    }
    return out.join('・');
  }

  /** `[…]` 段落標題 */
  function heading(v) {
    if (key(v) === 'set contents') return '【セット内容一覧】';
    const b = /^(.*?)\s*\bBonus$/i.exec(v.trim());
    if (!b) return null;
    let rest = b[1], kind = '';
    for (const [re, ja] of BONUS_KIND) {
      if (re.test(rest)) { kind = ja; rest = rest.replace(re, ''); break; }
    }
    let who = '';
    if (rest.trim()) {
      const names = [];
      for (const n of rest.split(/\s*,\s*/)) {
        const ja = WHO.get(key(n));
        if (ja == null) return null;
        names.push(ja);
      }
      who = names.join('、');
    }
    return '≪' + who + kind + '特典≫';
  }

  /** 內容物，可帶數量：'Optional hand part x11'、'Base: 1' */
  function item(t) {
    const q = /^(.+?)(?:\s+[x×]\s*(\d+)|\s*:\s*(\d+))$/i.exec(t);
    const name = q ? q[1] : t;
    const n = q ? (q[2] || q[3]) : '';
    let ja = ITEMS.get(key(name));
    if (ja == null) {
      for (const [re, f] of PAPER_ITEMS) {
        const m = re.exec(name.trim());
        if (m) { ja = f(m); break; }
      }
    }
    if (ja == null) return null;
    return n ? ja + '×' + n : ja;
  }

  /** 一行英文 → 日文；對不上回 null（整行保留英文由 translate 處理） */
  function line(raw) {
    const t = String(raw).replace(/^-\s*/, '').trim();
    if (!t) return '';
    let m;
    const note = NOTES.get(key(t));
    if (note != null) return note;
    if ((m = /^Scale\s*:\s*(1\/\d+)$/i.exec(t))) return '【スケール】' + m[1];
    if ((m = /^Size\s*:\s*(.+)$/i.exec(t))) { const s = size(m[1]); return s == null ? null : '【サイズ】' + s; }
    if ((m = /^Materials?\s*:\s*(.+)$/i.exec(t))) { const s = materials(m[1]); return s == null ? null : '【素材】' + s; }
    if ((m = /^\[(.+)\]$/.exec(t))) return heading(m[1]);
    const ty = types(t);
    if (ty != null) return ty;
    return item(t);
  }

  /**
   * 整段規格 → { body, lines, translated, kept }。
   *   lines       逐行 { text, ok }；ok 為 false 的是保留英文的行，畫面要標出來
   *   translated  轉成日文的行數；kept 保留英文的行數（空行兩邊都不算）
   * translated 為 0 時呼叫端應視為「沒有日文」，照原文呈現。
   */
  function translate(body) {
    const lines = [];
    let translated = 0, kept = 0;
    for (const raw of String(body || '').replace(/\r/g, '').split('\n')) {
      if (!raw.trim()) { lines.push({ text: '', ok: true }); continue; }
      const ja = line(raw);
      if (ja) { lines.push({ text: ja, ok: true }); translated++; }
      else { lines.push({ text: raw.trim(), ok: false }); kept++; }
    }
    return { body: lines.map(l => l.text).join('\n'), lines, translated, kept };
  }

  MS.specJa = { translate, line };
})();
