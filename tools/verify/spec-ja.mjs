/**
 * lib/spec-ja.js（英文規格 → amiami.jp 寫法的對照表）的驗證。
 *
 *   node tools/verify/spec-ja.mjs
 *
 * 純函式、不碰網路也不需要瀏覽器：以 node:vm 載入，給一個空的 window。
 *
 * 期望值取自 2026-10-13 對照的 37 件同商品 amiami.jp 製品仕様（見
 * openspec/changes/archive/2026-10-13-spec-ja-phrasebook/design.md）。amiami.jp 用字不一時取多數。
 * 另一半是「對不上就整行保留英文」的守則——那比轉得多更重要。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/spec-ja.js'), 'utf8'), ctx);
const { line, translate } = ctx.window.MS.specJa;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};
/** 每列 [英文, 期望的日文]；期望為 null 表示必須整行保留英文 */
const table = (title, rows) => {
  console.log('\n' + title);
  for (const [en, want] of rows) {
    const got = line(en);
    const ok = want === null ? got == null : got === want;
    check(`${JSON.stringify(en)} → ${want === null ? '保留英文' : want}`, ok, ok ? '' : `got ${JSON.stringify(got)}`);
  }
};

table('類型', [
  ['Pre-painted Complete Figure', '塗装済み完成品'],
  ['Pre-painted Posable Figure', '塗装済み可動フィギュア'],
  ['Pre-painted Complete Figure, Bonus Edition', '塗装済み完成品・特典版'],
  ['Pre-painted Posable Figure, 2pc. set', '塗装済み可動フィギュア・2体セット'],
  ['Pre-painted Posable Figure, Set of 2 Figure', '塗装済み可動フィギュア・2体セット'],
  ['pre-painted   complete figure', '塗装済み完成品'],
  ['Pre-painted Complete PVC Figure', null],
  ['Pre-painted Complete Figure, Something Else', null],
]);

table('スケール', [
  ['Scale: 1/7', '【スケール】1/7'],
  ['Scale: 1/4', '【スケール】1/4'],
  ['Scale: Non scale', null],
]);

table('サイズ', [
  ['Size: Approx. H235mm (including base)', '【サイズ】全高：約235mm(台座含む)'],
  ['Size: Approx. H140mm (non-scale)', '【サイズ】全高：約140mm(ノンスケール)'],
  ['Size: Approx. H260mm', '【サイズ】全高：約260mm'],
  ['Size: Approx. H28.6cm (Base included)', '【サイズ】全高：約28.6cm(台座含む)'],
  ['Size: H255mm (Base Excluded)', '【サイズ】全高255mm(台座を除く)'],
  ['Size: Approx. L100mm (non-scale)', '【サイズ】全長：約100mm(ノンスケール)'],
  ['Size: Approx. 12cm', '【サイズ】約12cm'],
  ['Size: Approx. 30cm (including base)', '【サイズ】約30cm(台座含む)'],
  ['Size: Approx. 13cm (Approx. W15cm)', '【サイズ】約13cm(横幅約15cm)'],
  ['Size: Approx. H170mm (Up to top of the head: Approx. 148mm) (non-scale)', '【サイズ】全高：約170mm(頭頂高：約148mm)(ノンスケール)'],
  ['Size: W150 x D160 x H190mm', '【サイズ】W150×D160×H190mm'],
  ['Size: Approx. H120mm, Approx. L200mm', '【サイズ】全高：約120mm、全長：約200mm'],
  // 人名、標籤、未對照過的註記：整行保留
  ['Size: H: Chisato Approx. 225mm, Takina Approx. 220mm (non-scale)', null],
  ['Size: Approx. H36cm (including base), Display Case: W46.5 x D36.5 x H45.5cm (Exterior)', null],
  ['Size: Approx. H95mm (w/Cup & saucer)', null],
  ['Size: Main item approx. H20cm (Base excluded / Non scale)', null],
  ['Size: Approx. L13 x 24cm', null],
]);

table('素材（分隔符照英文對應）', [
  ['Material: Plastic', '【素材】プラスチック'],
  ['Material: PVC, ABS', '【素材】PVC、ABS'],
  ['Material: PVC & ABS', '【素材】PVC＆ABS'],
  ['Material: PVC / ABS / Polyester', '【素材】PVC/ABS/ポリエステル'],
  ['Material: ATBC-PVC / ABS', '【素材】ATBC-PVC/ABS'],
  ['Material: Cloth, Magnet, Plastic', '【素材】布、磁石、プラスチック'],
  ['Material: PVC ABS', '【素材】PVC、ABS'],
  ['Material: ABS, PVC, POM', '【素材】ABS、PVC、POM'],
  ['Material: ABS, PVC, Diecast', null],
  ['Material: PVC (non-phthalate), ABS, Acrylic', null],
  ['Material: Main Part: PVC / ABS, Joint: POM', null],
  ['Material: PVC (Partially ABS)', null],
]);

table('段落標題', [
  ['[Set Contents]', '【セット内容一覧】'],
  ['[Bonus]', '≪特典≫'],
  ['[AmiAmi Exclusive Bonus]', '≪あみあみ限定特典≫'],
  ['[AmiAmi Limited Edition Bonus]', '≪あみあみ限定版特典≫'],
  ['[First Press Limited Bonus]', '≪初回限定特典≫'],
  ['[Deluxe Edition Bonus]', '≪豪華版特典≫'],
  ['[Kotobukiya Shop, CyStore Limited Bonus]', '≪コトブキヤショップ、CyStore限定特典≫'],
  ['[Goodsmile Online Shop Limited Bonus]', '≪GOODSMILE ONLINE SHOP限定特典≫'],
  ['[Goodsmile Online Shop Purchase Bonus]', '≪GOODSMILE ONLINE SHOP購入特典≫'],
  ['[Animate Limited Bonus]', '≪アニメイト限定特典≫'],
  ['[Some Unknown Store Limited Bonus]', null],
  ['[Vermin]', null],
]);

table('內容物', [
  ['Main figure', 'フィギュア本体'],
  ['Figure', 'フィギュア本体'],
  ['-Main figure', 'フィギュア本体'],
  ['Base', '専用台座'],
  ['Main figure x1', 'フィギュア本体×1'],
  ['Base: 1', '専用台座×1'],
  ['Optional hand part x11', 'オプションハンド×11'],
  ['Alternative face part', '差し替え顔パーツ'],
  ['Interchangeable hand parts', '交換用手首一式'],
  ['Magnetic base (for magnet-soled shoes)', '専用台座(足裏マグネット対応)'],
  ['Shoes (with magnets in soles)', '靴(靴裏マグネット付)'],
  ['Acrylic base', '専用アクリル台座'],
  ['Tin badge', '缶バッジ'],
  ['PET shikishi', 'PET色紙'],
  ['B2 wall scroll', 'B2タペストリー'],
  ['Acrylic character plate (A5 size)', 'アクリルキャラクタープレート(A5サイズ)'],
  ['*Torso stand not included.', '※トルソーは付属しません。'],
  ['*The number (type) of optional parts does not include the pre-attached (standard) parts.',
   '※オプションパーツの数(種類)には、出荷時(標準)に取り付けられているものを含みません'],
  // 自由文字、專有名詞、部分認得：整行保留，不拼湊
  ['"Fearless Smile" face part', null],
  ['Injured face part', null],
  ['Main figure x2 ("Splatoon" Girl / "Splatoon 2" Girl)', null],
  ['Alternative hand, left x3, right x4', null],
  ['Base(', null],
  ['Features: Light: Top/Bottom (White)', null],
]);

console.log('\ntranslate（整段）');
{
  // 回報案例 4571623518150 的規格
  const r = translate('Pre-painted Complete Figure\nScale: 1/7\nSize: Approx. H235mm (including base)\nMaterial: Plastic');
  check('回報案例整段轉完', r.body === '塗装済み完成品\n【スケール】1/7\n【サイズ】全高：約235mm(台座含む)\n【素材】プラスチック'
        && r.translated === 4 && r.kept === 0, JSON.stringify(r.body));

  const m = translate('Pre-painted Complete Figure\r\n\r\n[Set Contents]\r\nMain figure\r\nRurudo Lion tiny mode\r\nBase');
  check('CRLF 照樣逐行', m.lines.length === 6, JSON.stringify(m.lines));
  check('空行保留', m.lines[1].text === '' && m.lines[1].ok, JSON.stringify(m.lines[1]));
  check('對不上的行原樣保留、標為 ok:false', m.lines[4].text === 'Rurudo Lion tiny mode' && m.lines[4].ok === false, JSON.stringify(m.lines[4]));
  check('計數：空行不算', m.translated === 4 && m.kept === 1, `${m.translated}/${m.kept}`);
  check('body 等於逐行文字接起', m.body === m.lines.map(l => l.text).join('\n'));
  check('保留英文的行原文照抄，連前置的 - 也不動', translate('-Unknown thing x2').lines[0].text === '-Unknown thing x2');

  const none = translate('Only free text\nNothing here');
  check('一行都對不上：translated 為 0', none.translated === 0 && none.kept === 2);
  check('空字串不拋錯', translate('').translated === 0 && translate(null).body === '');
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
