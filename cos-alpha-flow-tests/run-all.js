// Cross-platform runner (Windows/macOS/Linux): node run-all.js [extension folder] [t14 t15 ...]
// Runs each test against the extension (default ../cos-alpha-flow), saves output to out-tN.txt, prints a summary.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const ext = path.resolve(__dirname, args[0] && !/^t\d+$/.test(args[0]) ? args.shift() : '../cos-alpha-flow');
const tests = args.length ? args : Array.from({ length: 26 }, (_, i) => `t${i + 1}`);
if (!fs.existsSync(path.join(ext, 'manifest.json'))) { console.error(`Không thấy manifest.json trong ${ext}`); process.exit(2); }
let failed = [];
for (const t of tests) {
  process.stdout.write(`##### ${t} ... `);
  const r = spawnSync(process.execPath, [path.join(__dirname, `${t}.js`), ext], { cwd: __dirname, encoding: 'utf8', timeout: 500000 });
  const out = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(__dirname, `out-${t}.txt`), out);
  const lines = out.trim().split(/\r?\n/);
  console.log(lines.filter(l => l.startsWith('===')).pop() || lines.pop() || '(no output)');
  for (const l of lines) if (/^FAIL|^ERRORS: (?!none)/.test(l)) console.log('   ' + l);
  if (r.status !== 0) failed.push(t);
}
console.log(failed.length ? `\nCó test lỗi: ${failed.join(', ')} (xem out-<tên>.txt)` : '\nTất cả test đều qua.');
process.exit(failed.length ? 1 : 0);
