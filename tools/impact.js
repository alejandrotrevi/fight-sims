// Simulate every profile against 1-target Casting Patchwerk of the same length with SimulationCraft's own sample
// characters: a check that each profile loads with all its events, what the fight does to a sim, and how much of
// the damage goes into adds, to compare with real players of the same spec (and calibrate, see calibrate.js).
// usage: SIMC=/path/to/simc node tools/impact.js [bossId_diff ...]  -> sims/impact.json
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SIMC = process.env.SIMC || 'simc';
const ITER = process.env.ITER || '1000';
// common specs, so each has plenty of real players to compare with
const CHARS = [
  { label: 'Havoc Demon Hunter (melee)', spec: 'DemonHunter-Havoc', file: 'MID2_Demon_Hunter_Havoc.simc' },
  { label: 'Arms Warrior (melee)', spec: 'Warrior-Arms', file: 'MID2_Warrior_Arms.simc' },
  { label: 'Arcane Mage (ranged)', spec: 'Mage-Arcane', file: 'MID2_Mage_Arcane.simc' },
  { label: 'Demonology Warlock (ranged)', spec: 'Warlock-Demonology', file: 'MID2_Warlock_Demonology.simc' },
];
const charDir = path.join(ROOT, 'sims', 'chars');
fs.mkdirSync(charDir, { recursive: true });
for (const c of CHARS) {
  const p = path.join(charDir, c.file);
  if (!fs.existsSync(p)) execFileSync('curl', ['-sfo', p, `https://raw.githubusercontent.com/simulationcraft/simc/midnight/profiles/MID2/${c.file}`]);
}
const RAID = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'raid.json'), 'utf8'));
const outFile = path.join(ROOT, 'sims', 'impact.json');
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const only = process.argv.slice(2);
const simName = s => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
// total DPS, damage taken per named enemy (the text report's "Target:" blocks) and the raid events simc registered
const run = args => {
  const json = path.join(os.tmpdir(), 'fight-sims-impact.json');
  const txt = execFileSync(SIMC, [...args, 'report_details=1', `json2=${json}`], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const cd = JSON.parse(fs.readFileSync(json, 'utf8')).sim.players[0].collected_data;
  const dtps = {}; const re = /^Target: (\S+)[^\n]*\n\s+DTPS=([0-9.]+)/gm; let m;
  while ((m = re.exec(txt))) dtps[m[1]] = +m[2];
  return { dps: cd.dps.mean, dtps, events: (txt.match(/raid_event\+?=/g) || []).length };
};
for (const b of RAID.bosses) for (const diff of ['mythic', 'heroic']) {
  const key = `${b.id}_${diff}`; if (only.length && !only.includes(key)) continue;
  const prof = path.join(ROOT, 'docs', 'profiles', `${b.slug}_${diff}.simc`); if (!fs.existsSync(prof)) continue;
  const text = fs.readFileSync(prof, 'utf8');
  const maxTime = (text.match(/^max_time=(\d+)/m) || [])[1];
  // "adds" the way the logs count them: everything that is not a boss-tagged unit on Warcraft Logs
  const A = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${key}.json`), 'utf8'));
  const bossTagged = new Set(A.bossAway.map(x => simName(x.boss)));
  const rows = [];
  for (const c of CHARS) {
    const common = [path.join(charDir, c.file), 'fight_style=CastingPatchwerk', `iterations=${ITER}`, 'threads=16'];
    // the Patchwerk baseline only depends on the kill length: reuse it from the last run when that has not changed
    const old = (out[key] || []).find(r => r.spec === c.spec && r.maxTime === +maxTime);
    const base = old ? { dps: old.base } : run([...common, `max_time=${maxTime}`, 'vary_combat_length=0.05']);
    const fight = run([...common, prof]);
    const onBosses = Object.entries(fight.dtps).filter(([n]) => bossTagged.has(n)).reduce((s, [, v]) => s + v, 0);
    const simAddShare = Math.max(0, 1 - onBosses / fight.dps);
    const real = A.addShare && A.addShare.bySpec[c.spec];
    rows.push({ label: c.label, spec: c.spec, maxTime: +maxTime, base: Math.round(base.dps), fight: Math.round(fight.dps), events: fight.events, simAddShare: +simAddShare.toFixed(3), realAddShare: real ? +real.mean.toFixed(3) : null, realPlayers: real ? real.n : 0 });
    console.log(key, c.label, Math.round(base.dps), Math.round(fight.dps), 'events', fight.events, `adds sim ${(simAddShare * 100).toFixed(1)}% real ${real ? (real.mean * 100).toFixed(1) + '% (' + real.n + ')' : '-'}`);
  }
  out[key] = rows;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
}
