// List auras that land on the bosses (from the Enemies buff events), with median windows
const fs = require('fs');
const [, , BOSS, DIFF = 'mythic'] = process.argv;
const files = fs.readdirSync('raw/kills').filter(f => f.startsWith(`${BOSS}_${DIFF}_`));
const agg = {};
for (const f of files) {
  const k = JSON.parse(fs.readFileSync('raw/kills/' + f));
  const name = id => (k.npcs.find(n => n.id === id) || {}).name;
  const open = {};
  for (const [t, ty, src, tgt, inst, ab] of k.buffs) {
    const key = name(tgt) + '|' + (k.abilities[ab] || ab) + '|' + ab;
    if (!name(tgt)) continue;
    const a = agg[key] || (agg[key] = { kills: new Set(), wins: [] });
    a.kills.add(f);
    const ok = key + inst;
    if (ty === 'applybuff') open[ok] = t; else if (ty === 'removebuff' && open[ok] !== undefined) { a.wins.push([open[ok], t - open[ok]]); delete open[ok]; }
  }
}
for (const [k, a] of Object.entries(agg).sort((x, y) => y[1].kills.size - x[1].kills.size)) {
  const w = a.wins.sort((x, y) => x[0] - y[0]);
  console.log(k.padEnd(60), 'kills', a.kills.size, 'wins', w.length, 'first', w.slice(0, 8).map(x => x[0].toFixed(0) + '+' + x[1].toFixed(1)).join(' '));
}
