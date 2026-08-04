/**
 * 手寫 store-only ZIP（無壓縮）與下載觸發。
 *
 * 為什麼要打包：Safari 會「靜默」丟棄間隔太短的連續程式化下載，連下載紀錄都不會
 * 登記，使用者完全收不到錯誤。打包成單一下載可以徹底避開。
 *
 * 為什麼不壓縮：JPEG 本來就壓過了，deflate 幾乎省不到空間，卻要多背一個壓縮實作。
 * store-only 讓整段程式維持在數十行、零依賴。
 *
 * 為什麼是外部檔案：censor.html 與 studio.html 都需要 http:// 協定（偵測模型），
 * 沒有「單一檔案可攜」的包袱，可以共用這一份。index.html 刻意**不**引用它——
 * 它必須維持雙擊即用、可以單獨寄給別人的性質，所以那邊留著自己內嵌的一份。
 *
 * classic script，不是 ES module——引入 module 就等於引入 build 步驟。
 */
(() => {
  'use strict';

  const MS = (window.MS = window.MS || {});

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  /**
   * @param {{name: string, bytes: Uint8Array}[]} entries
   *   name 可含 `/` 以表示資料夾層級（例如 `錢錢抱歉/01.jpg`）。不另外寫入目錄項目——
   *   unzip、Windows 檔案總管與 macOS 內建解壓器都會依路徑自動建出資料夾。
   */
  function makeZip(entries) {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const parts = [];
    const central = [];
    let offset = 0;

    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const crc = crc32(e.bytes);
      const size = e.bytes.length;

      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);    // flag bit 11：檔名為 UTF-8（中文檔名需要）
      lv.setUint16(8, 0, true);         // method 0 = store
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, e.bytes);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + size;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const c of central) { parts.push(c); cdSize += c.length; }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    ev.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
  }

  /** 同名檔案改成 `-2`、`-3`，不互相覆蓋 */
  function dedupe(name, used) {
    if (!used.has(name)) { used.add(name); return name; }
    const dot = name.lastIndexOf('.');
    const stem = dot < 0 ? name : name.slice(0, dot);
    const ext  = dot < 0 ? ''   : name.slice(dot);
    let i = 2;
    while (used.has(stem + '-' + i + ext)) i++;
    const out = stem + '-' + i + ext;
    used.add(out);
    return out;
  }

  /** `YYYYMMDD-HHMM`；前綴由各頁自己接，兩頁的檔名規則不同 */
  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function download(blob, name, revokeAfter) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), revokeAfter || 2000);
  }

  MS.crc32    = crc32;
  MS.makeZip  = makeZip;
  MS.dedupe   = dedupe;
  MS.stamp    = stamp;
  MS.download = download;
})();
