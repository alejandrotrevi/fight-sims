// Fetch speed rankings for every boss. Mythic: every page. Heroic: find the last page, then sample pages evenly.
const { q, rate } = require('./wcl');
const fs = require('fs');
const BOSSES = { 3470: "Nek'zali the Soulcoiler", 3445: 'Entombed Sentinels', 3455: 'Vashnik the Malignant', 3497: 'The Lost Explorers', 3420: 'Sszorak', 3421: 'The Twin Fangs', 3429: 'The Coiled Altar', 3492: "Ula'tek" };
const page = async (id, diff, p) => { const fr = (await q(`query($id:Int!,$d:Int!,$p:Int!){ worldData { encounter(id: $id) { fightRankings(difficulty: $d, metric: speed, page: $p) } } }`, { id, d: diff, p })).worldData.encounter.fightRankings || {}; if (!fr.rankings) { fr.rankings = []; fr.hasMorePages = false; } return fr; };
(async () => {
  const out = {};
  for (const [id, name] of Object.entries(BOSSES)) {
    out[id] = { name };
    // mythic: all pages
    let rows = [], p = 1, more = true;
    while (more && p <= 60) { const fr = await page(+id, 5, p); rows.push(...fr.rankings.map(r => ({ ...r, page: p }))); more = fr.hasMorePages; p++; }
    out[id].mythic = { pages: p - 1, rows };
    // heroic: exponential + binary search for the last page
    let lo = 1, hi = 1;
    while ((await page(+id, 4, hi)).hasMorePages) { lo = hi; hi *= 2; if (hi > 4096) break; }
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; const fr = await page(+id, 4, mid); if (fr.rankings.length && fr.hasMorePages) lo = mid; else if (fr.rankings.length) { hi = mid; break; } else hi = mid; }
    const last = hi;
    const want = Math.min(last, 20); const pages = [...new Set(Array.from({ length: want }, (_, i) => 1 + Math.round(i * (last - 1) / Math.max(1, want - 1))))];
    const hrows = [];
    for (const hp of pages) { const fr = await page(+id, 4, hp); hrows.push(...fr.rankings.map(r => ({ ...r, page: hp }))); }
    out[id].heroic = { lastPage: last, sampledPages: pages, rows: hrows };
    console.log(id, name, 'mythic kills', rows.length, '| heroic last page', last, 'sampled', hrows.length, JSON.stringify(await rate()));
  }
  fs.writeFileSync('raw/rankings.json', JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
