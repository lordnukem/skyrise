// Diff two parity traces (JS and Godot). Numbers match within 1e-9 (relative), a missing
// key matches null, and Godot's 2.0 matches JS's 2. Prints the first differences and a
// count; exit code 1 when anything differs.
//   node godot/tools/compare.mjs js.json godot.json
import { readFileSync } from 'node:fs';

// Godot's JSON.stringify leaves control characters in strings raw (only the rename test's
// input has one); escape them so JSON.parse accepts the file.
const lenient = (t) => t.replace(/[\u0000-\u001f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(lenient(readFileSync(p, 'utf8'))));
const diffs = [];
let compared = 0;

function cmp(x, y, path) {
  compared++;
  if (x === undefined) x = null;
  if (y === undefined) y = null;
  if (typeof x === 'number' && typeof y === 'number') {
    if (x === y || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) return;
    diffs.push(`${path}: ${x} != ${y}`); return;
  }
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
    if (x !== y) diffs.push(`${path}: ${JSON.stringify(x)} != ${JSON.stringify(y)}`);
    return;
  }
  if (Array.isArray(x) !== Array.isArray(y)) { diffs.push(`${path}: array vs object`); return; }
  if (Array.isArray(x)) {
    if (x.length !== y.length) diffs.push(`${path}: length ${x.length} != ${y.length}`);
    for (let i = 0; i < Math.min(x.length, y.length); i++) cmp(x[i], y[i], `${path}[${i}]`);
    return;
  }
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) cmp(x[k], y[k], `${path}.${k}`);
}

cmp(a.extras, b.extras, 'extras');
for (let i = 0; i < a.scenarios.length; i++) {
  const A = a.scenarios[i], B = b.scenarios[i];
  if (!B) { diffs.push(`scenario ${A.name} missing`); continue; }
  // Walk the traces in step; label each entry so a diff says where in the run it is.
  for (let j = 0; j < Math.max(A.trace.length, B.trace.length); j++) {
    const ea = A.trace[j], eb = B.trace[j];
    const tag = ea?.label ?? JSON.stringify(ea?.op ?? eb?.op);
    cmp(ea, eb, `${A.name}#${j} ${tag}`);
  }
}
const steps = a.scenarios.reduce((n, s) => n + s.trace.filter((e) => e.label).length, 0);
console.log(`${a.scenarios.length} scenarios, ${steps} snapshots, ${compared} values compared, ${diffs.length} differences`);
for (const d of diffs.slice(0, 40)) console.log('  ' + d);
process.exit(diffs.length ? 1 : 0);
