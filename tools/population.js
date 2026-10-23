// Sample the population of kills from random public reports (not the speed ranking), for difficulties where the
// ranking's top 1000 guilds are not representative (heroic). Spreads report-list pages evenly over the patch.
// usage: node population.js <difficulty 4|5> <pages> <fromISO> [toISO]  -> raw/population_<diff>.json, and swaps
//        raw/rankings.json[boss][diff].rows for a duration-stratified sample of it
const { q, rate } = require('./wcl');
const fs = require('fs');
const [, , DIFFN = '4', PAGES = '12', FROM = '2026-10-14T00:00:00Z', TO] = process.argv;
const DIFF = +DIFFN === 5 ? 'mythic' : 'heroic';
const from = Date.parse(FROM), to = TO ? Date.parse(TO) : Date.now();
const R = JSON.parse(fs.readFileSync('raw/rankings.json', 'utf8'));
(async () => {
  const kills = []; const seen = new Set();
  for (let i = 0; i < +PAGES; i++) {
    // newest 50 reports that started inside this slice of the patch
    const a = from + (to - from) * i / +PAGES, b = from + (to - from) * (i + 1) / +PAGES;
    const d = await q(`query($s:Float,$e:Float){ reportData { reports(zoneID: 53, startTime: $s, endTime: $e, limit: 50, page: 1) { data { code startTime guild { name server { region { slug } } } fights(killType: Kills) { id encounterID difficulty startTime endTime } } } } }`, { s: a, e: b });
    for (const r of d.reportData.reports.data) {
      if (seen.has(r.code)) continue; seen.add(r.code);
      for (const f of r.fights) if (f.difficulty === +DIFFN && R[f.encounterID]) kills.push({ boss: f.encounterID, duration: f.endTime - f.startTime, startTime: r.startTime + f.startTime, report: { code: r.code, fightID: f.id }, guild: r.guild ? { name: r.guild.name } : null, server: r.guild && r.guild.server ? { region: r.guild.server.region.slug.toUpperCase() } : null });
    }
    console.log('slice', i, new Date(a).toISOString().slice(0, 16), 'reports', seen.size, 'kills', kills.length, JSON.stringify(await rate()));
  }
  fs.writeFileSync(`raw/population_${DIFF}.json`, JSON.stringify(kills));
  // one kill per report and boss (a report can hold a guild's farm of the same boss), then stratify by duration
  for (const id of Object.keys(R)) {
    const per = {}; for (const k of kills.filter(k => k.boss === +id)) if (!per[k.report.code]) per[k.report.code] = k;
    const rows = Object.values(per).sort((x, y) => x.duration - y.duration).map((k, i) => ({ ...k, page: i }));
    R[id][DIFF + 'Top'] = R[id][DIFF + 'Top'] || R[id][DIFF];
    R[id][DIFF] = { source: 'random public reports', rows };
    console.log(id, R[id].name, DIFF, 'population', rows.length);
  }
  fs.writeFileSync('raw/rankings.json', JSON.stringify(R));
})().catch(e => { console.error(e); process.exit(1); });
