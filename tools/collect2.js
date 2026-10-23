// Second pass per collected kill: player melee swings (out-of-range gaps) and player casts (caster idle time).
// usage: node collect2.js [filePrefix]
const { q, rate } = require('./wcl');
const fs = require('fs');
const PREFIX = process.argv[2] || '';
let spent = 0;
async function Q(query, vars) {
  if (++spent % 15 === 0) { const r = await rate(); if (r.pointsSpentThisHour > 3000) { console.log(`rate: ${r.pointsSpentThisHour}, sleeping ${r.pointsResetIn}s`); await new Promise(s => setTimeout(s, (r.pointsResetIn + 10) * 1000)); } }
  return q(query, vars);
}
async function events(code, fid, st, en, dt, filter) {
  const all = []; let s = st;
  while (s != null) {
    const d = await Q(`query($c:String!,$f:[Int]!,$s:Float,$e:Float,$x:String){ reportData { report(code:$c) { events(fightIDs:$f, startTime:$s, endTime:$e, dataType:${dt}, hostilityType:Friendlies, limit:10000, filterExpression:$x) { data nextPageTimestamp } } } }`, { c: code, f: [fid], s, e: en, x: filter || null });
    const e = d.reportData.report.events; all.push(...e.data); s = e.nextPageTimestamp;
  }
  return all;
}
(async () => {
  const files = fs.readdirSync('raw/kills').filter(f => f.includes(PREFIX));
  for (const fn of files) {
    const out = 'raw/act/' + fn; if (fs.existsSync(out)) continue;
    const k = JSON.parse(fs.readFileSync('raw/kills/' + fn));
    try {
      const f = (await Q(`query($c:String!,$f:[Int]!){ reportData { report(code:$c) { fights(fightIDs:$f){ startTime endTime } } } }`, { c: k.code, f: [k.fid] })).reportData.report.fights[0];
      const pids = new Set(k.players.map(p => p.id));
      const t = ts => Math.round(ts - f.startTime) / 1000;
      const sw = await events(k.code, k.fid, f.startTime, f.endTime, 'DamageDone', 'ability.id = 1');
      const swings = {}; for (const e of sw) if (pids.has(e.sourceID)) (swings[e.sourceID] = swings[e.sourceID] || []).push(t(e.timestamp));
      const cs = await events(k.code, k.fid, f.startTime, f.endTime, 'Casts');
      const casts = {}; for (const e of cs) if (pids.has(e.sourceID) && (e.type === 'cast' || e.type === 'begincast')) (casts[e.sourceID] = casts[e.sourceID] || []).push([t(e.timestamp), e.type === 'begincast' ? 'b' : 'c', e.abilityGameID]);
      fs.writeFileSync(out, JSON.stringify({ swings, casts }));
      console.log(fn, 'ok', sw.length, cs.length);
    } catch (e) { console.log(fn, 'fail', String(e.message).slice(0, 150)); }
  }
  console.log('ACT DONE', JSON.stringify(await rate()));
})();
