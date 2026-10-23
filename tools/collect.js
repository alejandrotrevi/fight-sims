// Collect a stratified sample of kills per boss/difficulty from Warcraft Logs (v2 API) into compact per-kill JSON.
// usage: node collect.js <difficulty mythic|heroic> <kills per boss> [bossId,...]
const { q, rate } = require('./wcl');
const fs = require('fs');
const R = JSON.parse(fs.readFileSync('raw/rankings.json', 'utf8'));
const [, , DIFF = 'mythic', KARG = '30', ONLY] = process.argv;
const K = +KARG, DIFFN = DIFF === 'mythic' ? 5 : 4;
const bosses = ONLY ? ONLY.split(',') : Object.keys(R);
let spent = 0;
async function guard() {
  if (++spent % 15) return;
  const r = await rate();
  if (r.pointsSpentThisHour > 3000) { console.log(`rate: ${r.pointsSpentThisHour} spent, sleeping ${r.pointsResetIn}s`); await new Promise(s => setTimeout(s, (r.pointsResetIn + 10) * 1000)); }
}
async function Q(query, vars) { await guard(); return q(query, vars); }
const R1 = `query($c:String!,$f:[Int]!){ reportData { report(code:$c) {
  fights(fightIDs:$f) { id startTime endTime encounterID difficulty kill size fightPercentage phaseTransitions{id startTime} enemyNPCs{id gameID instanceCount groupCount petOwner} }
  masterData { actors { id gameID name type subType petOwner } abilities { gameID name type } }
  playerDetails(fightIDs:$f) } } }`;
async function events(code, f, dt, host, filter) {
  const all = []; let st = f.startTime;
  while (st != null) {
    const d = await Q(`query($c:String!,$f:[Int]!,$s:Float,$e:Float,$x:String){ reportData { report(code:$c) { events(fightIDs:$f, startTime:$s, endTime:$e, dataType:${dt}, hostilityType:${host}, limit:10000, filterExpression:$x) { data nextPageTimestamp } } } }`, { c: code, f: [f.id], s: st, e: f.endTime, x: filter || null });
    const e = d.reportData.report.events; all.push(...e.data); st = e.nextPageTimestamp;
  }
  return all;
}
async function one(bossId, row) {
  const code = row.report.code, fid = row.report.fightID;
  const file = `raw/kills/${bossId}_${DIFF}_${code}_${fid}.json`;
  if (fs.existsSync(file)) return 'cached';
  const m = (await Q(R1, { c: code, f: [fid] })).reportData.report;
  const f = m.fights[0];
  if (!f || !f.kill || f.encounterID !== +bossId) throw new Error('not the kill');
  const t = ts => Math.round(ts - f.startTime) / 1000;
  const actors = Object.fromEntries(m.masterData.actors.map(a => [a.id, a]));
  const npcs = f.enemyNPCs.map(n => ({ ...n, name: (actors[n.id] || {}).name, subType: (actors[n.id] || {}).subType }));
  const bossIds = npcs.filter(n => n.subType === "Boss").map(n => n.id);
  const bossGids = npcs.filter(n => n.subType === "Boss").map(n => n.gameID); // filterExpression target.id is the game id
  const casts = await events(code, f, 'Casts', 'Enemies');
  const buffs = await events(code, f, 'Buffs', 'Enemies');
  const deaths = await events(code, f, 'Deaths', 'Enemies');
  const addFilter = bossIds.length ? `target.type = "NPC" and target.id not in (${bossGids.join(",")})` : `target.type = "NPC"`;
  const addDmg = await events(code, f, 'DamageDone', 'Friendlies', addFilter);
  // per add instance: first/last hit, total; per-second damage by actor id
  const inst = {}, perSec = {};
  for (const e of addDmg) {
    if (e.type !== 'damage' || !e.targetID) continue;
    const k = e.targetID + '.' + (e.targetInstance || 0);
    const x = inst[k] || (inst[k] = { first: t(e.timestamp), last: 0, total: 0 });
    x.last = t(e.timestamp); x.total += (e.amount || 0) + (e.absorbed || 0);
    const s = Math.floor(t(e.timestamp)); const arr = perSec[e.targetID] || (perSec[e.targetID] = []); arr[s] = (arr[s] || 0) + (e.amount || 0) + (e.absorbed || 0);
  }
  // damage-by-target graph in 200 s windows (~0.83 s points) for bosses' presence
  const graph = {};
  for (let s = f.startTime; s < f.endTime; s += 200000) {
    const g = (await Q(`query($c:String!,$f:[Int]!,$s:Float,$e:Float){ reportData { report(code:$c) { graph(fightIDs:$f, startTime:$s, endTime:$e, dataType:DamageDone, hostilityType:Friendlies, viewBy:Target) } } }`, { c: code, f: [fid], s, e: Math.min(s + 200000, f.endTime) })).reportData.report.graph.data;
    for (const ser of g.series) {
      if (!bossIds.includes(ser.id) && ser.type !== 'Boss') continue;
      const arr = graph[ser.id] || (graph[ser.id] = []);
      ser.data.forEach((v, i) => arr.push([t(ser.pointStart + i * ser.pointInterval), Math.round(v)]));
    }
  }
  const pd = m.playerDetails.data.playerDetails;
  const players = ['tanks', 'healers', 'dps'].flatMap(r => (pd[r] || []).map(p => ({ id: p.id, name: p.name, class: p.type, spec: (p.specs && p.specs[0] && p.specs[0].spec) || null, role: r })));
  const usedAb = new Set([...casts, ...buffs].map(e => e.abilityGameID));
  const out = {
    boss: +bossId, diff: DIFF, code, fid, guild: row.guild && row.guild.name, region: row.server && row.server.region, rankPage: row.page,
    duration: (f.endTime - f.startTime) / 1000, size: f.size,
    phases: (f.phaseTransitions || []).map(p => [p.id, t(p.startTime)]),
    npcs, bossIds, players,
    abilities: Object.fromEntries(m.masterData.abilities.filter(a => usedAb.has(a.gameID)).map(a => [a.gameID, a.name])),
    casts: casts.filter(e => e.type === 'begincast' || e.type === 'cast').map(e => [t(e.timestamp), e.type === 'begincast' ? 'b' : 'c', e.sourceID, e.sourceInstance || 0, e.abilityGameID, e.targetID]),
    buffs: buffs.map(e => [t(e.timestamp), e.type, e.sourceID, e.targetID, e.targetInstance || 0, e.abilityGameID, e.stack || 0]),
    deaths: deaths.filter(e => e.type === 'death').map(e => [t(e.timestamp), e.targetID, e.targetInstance || 0]),
    addInst: inst, addPerSec: perSec, bossGraph: graph,
  };
  fs.writeFileSync(file, JSON.stringify(out));
  return 'ok';
}
(async () => {
  for (const b of bosses) {
    const rows = R[b][DIFF].rows; const n = rows.length; const picks = [];
    for (let i = 0; i < K; i++) picks.push(Math.round(i * (n - 1) / (K - 1)));
    let ok = 0;
    for (const idx of picks) {
      // try the picked rank, then its neighbours, until one loads
      for (const off of [0, 1, -1, 2, -2, 3, -3]) {
        const row = rows[idx + off]; if (!row) continue;
        try { const r = await one(b, row); ok++; console.log(b, DIFF, 'rank', idx + off, row.report.code, row.report.fightID, r); break; }
        catch (e) { console.log(b, DIFF, 'rank', idx + off, 'skip:', String(e.message).slice(0, 120)); }
      }
    }
    console.log('BOSS DONE', b, R[b].name, ok, '/', K, JSON.stringify(await rate()));
  }
})().catch(e => { console.error(e); process.exit(1); });
