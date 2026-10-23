// Calibrate how much of each AoE the adds soak. SimulationCraft has no positions, so every area spell reaches every
// add; real players often cannot. From sims/impact.json, compare each sample character's share of damage into adds
// with real players of the same spec (median over the kills), and scale the adds' exposure (count x alive time) by
// the odds ratio, geometric mean over the characters with at least 8 real players. Run impact.js again afterwards:
// each run refines the factor from the last.
// usage: node tools/calibrate.js [bossId_diff ...]  -> sims/calibration.json
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const IMPACT = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'impact.json'), 'utf8'));
const file = path.join(ROOT, 'sims', 'calibration.json');
const CAL = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const only = process.argv.slice(2);
const odds = p => p / (1 - p);
for (const [key, rows] of Object.entries(IMPACT)) {
  if (only.length && !only.includes(key)) continue;
  const use = rows.filter(r => r.realPlayers >= 8 && r.realAddShare > 0.01 && r.simAddShare > 0.005);
  const prev = (CAL[key] && CAL[key].factor) || 1;
  if (!use.length) { CAL[key] = { factor: prev, note: 'no adds to calibrate, or too few real players of the sample specs' }; console.log(key, 'not calibrated'); continue; }
  const ln = use.map(r => Math.log(odds(r.realAddShare) / odds(r.simAddShare)));
  const step = Math.exp(ln.reduce((s, x) => s + x, 0) / ln.length);
  const factor = Math.min(3, Math.max(0.2, prev * step));
  CAL[key] = { factor: +factor.toFixed(3), previous: prev, step: +step.toFixed(3), basis: use.map(r => ({ spec: r.spec, sim: r.simAddShare, real: r.realAddShare, players: r.realPlayers })) };
  console.log(key, 'factor', prev, '->', factor.toFixed(3), use.map(r => `${r.spec.split('-')[1]} sim ${(r.simAddShare * 100).toFixed(1)}% real ${(r.realAddShare * 100).toFixed(1)}%`).join(' | '));
}
fs.writeFileSync(file, JSON.stringify(CAL, null, 1));
