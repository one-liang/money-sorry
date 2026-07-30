#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// 確認 test/ 的素材與 test-manifest.json 一致
//
//   node tools/verify/check-test-set.js
//
// 商品照不進版控，換一台電腦要自己搬。搬完先跑這支——素材少一張或壞一張，
// 底下所有驗證的數字都會對不上，而那看起來會像程式壞了。
// ══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-manifest.json'), 'utf8'));

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
let missing = 0, differ = 0, ok = 0;

for (const [rel, want] of Object.entries(manifest.files)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.log(`  ✗ 缺檔      ${rel}`); missing++; continue; }
  const buf = fs.readFileSync(abs);
  if (sha(buf) !== want.sha256) {
    console.log(`  ✗ 內容不符  ${rel}  (${buf.length} bytes，預期 ${want.bytes})`);
    differ++;
  } else ok++;
}

// 多出來的檔案不是錯，但值得說一聲——它們會進 verify.js 卻不在 baseline 裡
const listed = new Set(Object.keys(manifest.files));
const extras = fs.existsSync(path.join(ROOT, 'test'))
  ? (function walk(d) {
      return fs.readdirSync(d).flatMap(f => {
        const p = path.join(d, f);
        return fs.statSync(p).isDirectory() ? walk(p) : [path.relative(ROOT, p)];
      });
    })(path.join(ROOT, 'test')).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && !listed.has(f))
  : [];

console.log(`\n${ok}/${Object.keys(manifest.files).length} 相符` +
            (missing ? `，${missing} 缺檔` : '') +
            (differ ? `，${differ} 內容不符` : ''));
if (extras.length) console.log(`另有 ${extras.length} 個清單外的檔案（不算錯，但 baseline.json 不會有它們）：\n  ${extras.join('\n  ')}`);

if (missing || differ) {
  console.log('\n素材不完整，先把 test/ 補齊再跑其他驗證，否則數字對不上不代表程式有問題。');
  process.exitCode = 1;
} else {
  console.log('✓ 素材與清單一致');
}
