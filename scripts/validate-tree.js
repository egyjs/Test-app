#!/usr/bin/env node
/*
 * يتحقق من سلامة شجرة الأسئلة في js/data.js:
 *   - كل انتقال يشير إلى سؤال موجود، ولا توجد حلقات أو أسئلة يتيمة
 *   - كل المسارات بالطول نفسه، وكل مسار يمر بفرع واحد في كل مستوى
 *   - محاكاة عشوائية تُظهر أن كل فرع وكل نتيجة يمكن الوصول إليها
 *
 * الاستخدام:  node scripts/validate-tree.js [عدد_المحاكاة]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['js/data.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const DATA = ctx.window.QUIZ_DATA;
const engine = ctx.window.QuizEngine.create(DATA);
const RESPONSES = ['fight', 'flight', 'freeze', 'fawn'];

const errors = [];
const fail = (msg) => errors.push(msg);

/* ---------- 1. البنية ---------- */
const ids = Object.keys(DATA.nodes);
if (!DATA.nodes[DATA.start]) fail(`start "${DATA.start}" does not exist`);

const stageModules = new Set(DATA.stages.flatMap((s) => s.modules));
for (const id of ids) {
  const n = DATA.nodes[id];
  if (!DATA.modules[n.module]) fail(`${id}: unknown module "${n.module}"`);
  if (!stageModules.has(n.module)) fail(`${id}: module "${n.module}" is not in any stage`);
  if (!n.text || !n.text.trim()) fail(`${id}: empty text`);
  if (!Array.isArray(n.options) || n.options.length < 2 || n.options.length > 4) {
    fail(`${id}: needs 2–4 options (keyboard shortcuts are 1–4)`);
    continue;
  }
  n.options.forEach((o, i) => {
    if (!o.text || !o.text.trim()) fail(`${id}[${i}]: empty option text`);
    if (o.r && !RESPONSES.includes(o.r)) fail(`${id}[${i}]: unknown reaction "${o.r}"`);
    if (o.next !== undefined && o.next !== null && !DATA.nodes[o.next]) fail(`${id}[${i}]: next "${o.next}" missing`);
  });
  const everyOptionRoutes = n.options.every((o) => o.next !== undefined);
  if (!everyOptionRoutes && n.next === undefined) fail(`${id}: no "next" (use null to end the quiz)`);
  if (n.next && typeof n.next === 'object') {
    const need = n.next.by === 'response' ? RESPONSES
      : n.next.by === 'lean' ? ['narcissist', 'victim', 'mixed'] : null;
    if (!need) fail(`${id}: unknown router "${n.next.by}"`);
    else need.forEach((k) => { if (!DATA.nodes[n.next.to[k]]) fail(`${id}: route "${k}" → "${n.next.to[k]}" missing`); });
  } else if (typeof n.next === 'string' && !DATA.nodes[n.next]) {
    fail(`${id}: next "${n.next}" missing`);
  }
}

/* ---------- 2. كل المسارات الممكنة في الشجرة ---------- */
const paths = [];
const reached = new Set();
(function walk(id, trail) {
  if (trail.includes(id)) { fail(`cycle: ${trail.concat(id).join(' → ')}`); return; }
  reached.add(id);
  const next = engine.successors(id);
  if (!next.length) { paths.push(trail.concat(id)); return; }
  next.forEach((n) => walk(n, trail.concat(id)));
})(DATA.start, []);

ids.filter((id) => !reached.has(id)).forEach((id) => fail(`unreachable node: ${id}`));
const lengths = new Set(paths.map((p) => p.length));
if (lengths.size !== 1) fail(`paths have different lengths: ${[...lengths].join(', ')}`);

paths.forEach((p) => {
  const mods = [...new Set(p.map((id) => DATA.nodes[id].module))];
  DATA.treeLevels.forEach((level, li) => {
    const hit = level.filter((m) => mods.includes(m));
    if (hit.length !== 1) fail(`path ${p.join('→')} visits ${hit.length} branches at level ${li + 1}`);
  });
});

/* ---------- 3. محاكاة عشوائية ---------- */
const RUNS = Number(process.argv[2]) || 20000;
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const dist = { level2: {}, level3: {}, level4: {}, quadrant: {}, subtype: {}, awareness: {}, dominant: {} };
const visited = new Set();
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

for (let i = 0; i < RUNS; i++) {
  const trail = [DATA.start];
  const answers = {};
  for (;;) {
    const id = trail[trail.length - 1];
    visited.add(id);
    const choice = Math.floor(rand() * DATA.nodes[id].options.length);
    answers[id] = choice;
    const next = engine.nextNode(id, choice, trail, answers);
    if (!next) break;
    trail.push(next);
  }
  const r = engine.result(trail, answers);
  bump(dist.level2, DATA.treeLevels[1].find((m) => r.modules.includes(m)));
  bump(dist.level3, DATA.treeLevels[2].find((m) => r.modules.includes(m)));
  bump(dist.level4, DATA.treeLevels[3].find((m) => r.modules.includes(m)));
  bump(dist.quadrant, r.quadrant);
  bump(dist.subtype, r.subtype);
  bump(dist.awareness, r.awareness);
  bump(dist.dominant, r.dominant.length > 1 ? 'mix' : r.dominant[0]);
}

ids.filter((id) => !visited.has(id)).forEach((id) => fail(`simulation never reached ${id}`));
Object.keys(DATA.quadrants).forEach((q) => { if (!dist.quadrant[q]) fail(`quadrant never reached: ${q}`); });
Object.keys(DATA.subtypes).forEach((s) => { if (!dist.subtype[s]) fail(`subtype never reached: ${s}`); });
Object.keys(DATA.awarenessStyles).forEach((s) => { if (!dist.awareness[s]) fail(`awareness style never reached: ${s}`); });

/* ---------- التقرير ---------- */
const pct = (n) => ((n / RUNS) * 100).toFixed(1).padStart(5) + '%';
console.log(`nodes: ${ids.length}   distinct paths: ${paths.length}   questions per path: ${[...lengths].join('/')}`);
console.log(`random simulation: ${RUNS} runs (uniformly random answers)\n`);
for (const [name, d] of Object.entries(dist)) {
  console.log(name);
  Object.entries(d).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(k).padEnd(20)} ${pct(v)}`));
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n- ` + errors.join('\n- '));
  process.exit(1);
}
console.log('\nOK: tree is valid');
