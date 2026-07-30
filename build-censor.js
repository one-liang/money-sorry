#!/usr/bin/env node
// 把 src/censor.template.html 加上內嵌的 tfjs 與 MoveNet 權重，產生可雙擊的 censor.html
//
//   node build-censor.js
//
// 換模型時：把新的 model.json 與權重 shard 放進 assets/model/ 後重跑這支。
// 模型輸入尺寸若改變（Thunder 是 256），同時改 src/censor.template.html 的 MODEL_INPUT。

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TEMPLATE = path.join(ROOT, 'src', 'censor.template.html');
const TFJS = path.join(ROOT, 'assets', 'vendor', 'tf.min.js');
const CORE = path.join(ROOT, 'src', 'censor-core.js');
const MODEL_DIR = path.join(ROOT, 'assets', 'model');
const OUT = path.join(ROOT, 'censor.html');

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

for (const p of [TEMPLATE, TFJS, CORE, path.join(MODEL_DIR, 'model.json')]) {
  if (!fs.existsSync(p)) die(`缺少 ${path.relative(ROOT, p)}`);
}

const template = fs.readFileSync(TEMPLATE, 'utf8');
const tfjs = fs.readFileSync(TFJS, 'utf8');
const core = fs.readFileSync(CORE, 'utf8');
const model = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, 'model.json'), 'utf8'));

const paths = model.weightsManifest.flatMap(g => g.paths);
const shards = paths.map(p => {
  const f = path.join(MODEL_DIR, p);
  if (!fs.existsSync(f)) die(`weightsManifest 指向不存在的 ${p}`);
  return fs.readFileSync(f);
});
const weights = Buffer.concat(shards);
const weightSpecs = model.weightsManifest.flatMap(g => g.weights);

const inputDim = Object.values(model.signature.inputs)[0].tensorShape.dim.map(d => +d.size);
const inputSize = inputDim[1];

const subs = {
  __TFJS__: tfjs,
  __CORE__: core,
  __MODEL_TOPOLOGY__: JSON.stringify(model.modelTopology),
  __WEIGHT_SPECS__: JSON.stringify(weightSpecs),
  __SIGNATURE__: JSON.stringify(model.signature || null),
  __WEIGHTS_B64__: weights.toString('base64'),
  __MODEL_INPUT__: String(inputSize),
};

let out = template;
for (const [token, value] of Object.entries(subs)) {
  if (!out.includes(token)) die(`模板缺少置換點 ${token}`);
  out = out.split(token).join(value);
}

fs.writeFileSync(OUT, out);

const mb = n => (n / 1048576).toFixed(2) + ' MB';
console.log('✓ censor.html');
console.log(`  模型輸入   ${inputSize}×${inputSize}`);
console.log(`  權重       ${mb(weights.length)}（${paths.length} shard、${weightSpecs.length} specs）`);
console.log(`  tfjs       ${mb(tfjs.length)}`);
console.log(`  core       ${(core.length/1024).toFixed(1)} KB`);
console.log(`  輸出       ${mb(fs.statSync(OUT).size)}`);
