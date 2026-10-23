// Third pass per collected kill: each player's total damage and damage into non-boss enemies (adds), to check the
// sim's add share against reality per spec.
// usage: node collect3.js [fileFilter]
const { q, rate } = require('./wcl');
const fs = require('fs');
const FILTER = process.argv[2] || '';
let n = 0;
async function Q(query, vars) {
  if (++n % 15 === 0) { const r = await rate(); if (r.pointsSpentThisHour > 3000) { console.log(`rate: ${r.pointsSpentThisHour}, sleeping ${r.pointsResetIn}s`); await new Promise(s => setTimeout(s, (r.pointsResetIn + 10) * 1000)); } }
  return q(query, vars);
}
(async () => {
  fs.mkdirSync('raw/share', { recursive: true });
  for (const fn of fs.readdirSync('raw/kills').filter(f => f.includes(FILTER))) {
    const out = 'raw/share/' + fn; if (fs.existsSync(out)) continue;
    const k = JSON.parse(fs.readFileSync('raw/kills/' + fn));
    const gids = k.npcs.filter(x => k.bossIds.includes(x.id)).map(x => x.gameID);
    try {
      const d = (await Q(`query($c:String!,$f:[Int]!,$x:String){ reportData { report(code:$c) {
        all: table(fightIDs:$f, dataType: DamageDone, hostilityType: Friendlies, viewBy: Source)
        adds: table(fightIDs:$f, dataType: DamageDone, hostilityType: Friendlies, viewBy: Source, filterExpression: $x) } } }`,
        { c: k.code, f: [k.fid], x: `target.type = "NPC" and target.id not in (${gids.join(',')})` })).reportData.report;
      const addBy = {}; for (const e of d.adds.data.entries) addBy[e.id] = e.total;
      const players = d.all.data.entries.filter(e => e.type !== 'Pet' && e.type !== 'NPC').map(e => ({ id: e.id, icon: e.icon, total: e.total, adds: addBy[e.id] || 0 }));
      fs.writeFileSync(out, JSON.stringify({ players }));
      console.log(fn, 'ok', players.length);
    } catch (e) { console.log(fn, 'fail', String(e.message).slice(0, 160)); }
  }
  console.log('SHARE DONE', JSON.stringify(await rate()));
})();
