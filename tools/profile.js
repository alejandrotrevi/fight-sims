// Turn out/<boss>_<diff>.json (measured) into a simc footer for Raidbots' SimC Expert Mode.
// usage: node profile.js <bossId> <mythic|heroic> [outDir]  -> <outDir>/<slug>_<diff>.simc and out/<boss>_<diff>.events.json
const fs = require('fs');
const [, , BOSS, DIFF = 'mythic', OUTDIR = 'docs/profiles'] = process.argv;
const A = JSON.parse(fs.readFileSync(`data/${BOSS}_${DIFF}.json`));
const cfgFile = `config/${BOSS}.json`;
const C0 = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile)) : {};
const C = { ...C0, ...(C0[DIFF] || {}) }; // config.mythic / config.heroic override the shared settings
const simName = s => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
const f1 = x => (Math.round(x * 10) / 10).toString();
const slug = C.slug || simName(A.name).toLowerCase();

const maxTime = Math.round(A.duration.population.med);
const horizon = maxTime * 1.06; // events after the longest simulated fight never fire
const segStart = i => (A.segments[i] && A.segments[i].start ? A.segments[i].start.med : 0);
const segEnd = i => (A.segments[i + 1] && A.segments[i + 1].start ? A.segments[i + 1].start.med : horizon);
const half = s => +((s.p75 - s.p25) / 2).toFixed(1);
const enough = w => w.kills >= A.sample * 0.5;
const events = [];

// targets: config can name the simulated enemies (e.g. one golem when the raid splits up)
const allBosses = A.bossAway.map(b => b.boss);
const asAdds = new Set(C.bossAsAdds || []); // boss-tagged units that come and go like adds
const windowed = new Set(C.windowed || []); // boss-tagged units that are a target only in short windows (simulated as a target that is invulnerable otherwise)
const bosses = (C.enemies || allBosses.filter(b => !asAdds.has(b))).slice();
for (const b of A.bossAway.filter(b => asAdds.has(b.boss))) for (const w of b.present) {
  if (!enough(w) || w.tm > horizon) continue;
  events.push({ kind: 'adds', name: b.boss, t: w.tm, count: 1, duration: +w.length.med.toFixed(1), scale: 1, kills: w.kills, spread: half(w.off), share: null, fromGraph: true });
}
// a target that only exists in windows: invulnerable everywhere outside them
const onlyIn = (name, wins) => {
  let t = 0;
  for (const w of wins.slice().sort((a, b) => a.t - b.t)) { if (w.t - t > 1) events.push({ kind: 'away', name, t: +Math.max(0.1, t).toFixed(1), duration: +(w.t - t).toFixed(1), outside: true, kills: A.sample }); t = w.t + w.duration; }
  if (horizon - t > 1) events.push({ kind: 'away', name, t: +t.toFixed(1), duration: +(horizon - t).toFixed(1), outside: true, kills: A.sample });
};
for (const b of A.bossAway.filter(b => windowed.has(b.boss))) onlyIn(b.boss, b.present.filter(w => enough(w) && w.tm <= horizon).map(w => ({ t: w.tm, duration: w.length.med })));

// adds: at least 1% of the raid's damage and alive 3 s or more (config can force or drop by game id)
// config.adds[gameId]: false to drop, or { scale, countScale, why }: scale its alive time (e.g. 0.5 when only half the
// raid can reach it) or its count (e.g. 0.5 when the raid splits and each half kills its own)
// config.asEnemy[gameId]: { mult, why }: an add that takes extra damage (simc's vulnerable event only reaches enemies, never
// raid-event adds), simulated as a target that exists only while the wave is alive, the rest of the wave as adds
const addCfg = a => (C.adds && a.gameId in C.adds) ? C.adds[a.gameId] : null;
const keepAdd = a => addCfg(a) === false ? false : (addCfg(a) || (C.asEnemy && a.gameId in C.asEnemy) ? true : (a.damageShare >= 0.01 && a.waves.some(w => w.life.med >= 3)));
for (const a of A.adds) {
  if (!keepAdd(a)) continue;
  const ae = C.asEnemy && C.asEnemy[a.gameId];
  const cfg = ae || addCfg(a) || {};
  const live = [];
  for (const w of a.waves) {
    if (!enough(w) || w.tm > horizon) continue;
    const inSeg = !cfg.segments || cfg.segments.includes(w.seg); // config can limit a scaling to some phases (e.g. the one the raid splits for)
    const scale = (inSeg && cfg.scale) || 1, countScale = (inSeg && cfg.countScale) || 1;
    let count = Math.max(1, Math.round(w.count.med * countScale));
    const duration = +(w.life.med * scale).toFixed(1);
    if (ae) { live.push({ t: w.tm, duration }); if (ae.mult) events.push({ kind: 'vuln', name: a.name, aura: ae.label || 'takes extra damage', mult: ae.mult, t: w.tm, duration, kills: w.kills, spread: half(w.off) }); count -= 1; }
    if (count > 0) events.push({ kind: 'adds', name: a.name, t: w.tm, count, measuredCount: +w.count.med.toFixed(1), countScale, duration, measuredLife: +w.life.med.toFixed(1), scale, why: inSeg ? cfg.why : undefined, kills: w.kills, spread: half(w.off), share: a.damageShare });
  }
  if (ae) { bosses.push(a.name); onlyIn(a.name, live); }
}
// boss away: whole phases a simulated boss is absent for, then the gaps inside the phases it is present for
for (const b of A.bossAway) {
  if (!bosses.includes(b.boss) || windowed.has(b.boss) || C.skipAway) continue;
  b.segPresence.forEach((p, i) => {
    if (p === null || p >= 0.25) return;
    const t = segStart(i), end = Math.min(segEnd(i), horizon); if (t > horizon) return;
    // mostly absent, but back for a real window in most kills (12 s or more; shorter is the damage graph's smoothing):
    // absent around that window only
    const back = b.present.filter(w => w.seg === i && enough(w)).map(w => ({ t: Math.max(t, w.tm), e: Math.min(end, w.tm + w.length.med) })).filter(w => w.e - w.t >= 12).sort((x, y) => x.t - y.t);
    let s = t;
    for (const w of back) { if (w.t - s > 1) events.push({ kind: 'away', name: b.boss, t: +s.toFixed(1), duration: +(w.t - s).toFixed(1), phase: i, presence: p, partial: true, kills: A.sample }); s = w.e; }
    if (end - s > 1) events.push({ kind: 'away', name: b.boss, t: +s.toFixed(1), duration: +(end - s).toFixed(1), phase: i, presence: p, partial: back.length > 0, kills: A.sample });
  });
  for (const w of b.windows) {
    if (!enough(w) || w.tm > horizon) continue;
    events.push({ kind: 'away', name: b.boss, t: w.tm, duration: +w.length.med.toFixed(1), depth: w.depth.med, kills: w.kills, spread: half(w.off) });
  }
}
// damage taken windows: auras configured with their multiplier from the spell data
// (only on a simulated target: simc applies a vulnerable event with an unknown target to the main boss instead)
for (const [auraId, v] of Object.entries(C.vulnerable || {})) for (const a of A.auras.filter(x => x.auraId === +auraId)) for (const w of a.windows) {
  if (!enough(w) || w.tm > horizon || !bosses.includes(a.target)) continue;
  events.push({ kind: 'vuln', name: a.target, aura: v.label || a.aura, auraId: +auraId, mult: v.mult, measured: v.measured, t: w.tm, duration: +w.length.med.toFixed(1), kills: w.kills, spread: half(w.off) });
}
// movement: each measured dip becomes a movement of the role's expected lost seconds, centred on the dip
const skipLabel = new Set(C.labelSkip || []);
const casts = A.casts.filter(c => c.perKill.med <= 15 && allBosses.includes(c.caster) && !skipLabel.has(c.abilityId))
  .flatMap(c => c.occurrences.filter(o => o.off.p75 - o.off.p25 <= 3).map(o => ({ name: c.ability, t: o.tm })));
const label = t => { const c = casts.filter(x => x.t <= t + 1 && x.t >= t - 12).sort((a, b) => b.t - a.t)[0]; return c ? c.name : 'Movement'; };
for (const d of A.downtime) {
  const s0 = segStart(d.seg);
  for (const role of ['melee', 'ranged']) for (const x of d[role].dips) {
    if (x.lost < 0.5) continue;
    const t = s0 + x.center - x.lost / 2; if (t > horizon) continue;
    events.push({ kind: 'move', role, t: +t.toFixed(1), duration: +x.lost.toFixed(1), window: [+(s0 + x.start).toFixed(1), +(s0 + x.end).toFixed(1)], peak: x.peak, lostCI: x.lostCI, label: label(s0 + x.center) });
  }
}
// calibration (tools/calibrate.js): scale the adds' exposure, count x alive time, so the share of damage that goes into
// adds matches real players of the same spec; the measured count and alive time stay on the page
const CALF = fs.existsSync('sims/calibration.json') ? ((JSON.parse(fs.readFileSync('sims/calibration.json', 'utf8'))[`${BOSS}_${DIFF}`] || {}).factor || 1) : 1;
// it corrects area damage spilling onto adds next to a boss; adds that spawn while every main boss is gone are the
// target, not splash, and keep their measured size
const mainBosses = bosses.filter(b => !windowed.has(b) && !(C.asEnemy && A.adds.some(a => a.name === b && a.gameId in C.asEnemy)));
const allAway = t => mainBosses.every(b => events.some(e => e.kind === 'away' && e.name === b && e.t <= t && t < e.t + e.duration));
if (CALF !== 1) for (const e of events.filter(e => e.kind === 'adds')) {
  if (allAway(e.t)) { e.mainTarget = true; continue; }
  const secs = e.count * e.duration * CALF, c = Math.max(1, Math.round(e.count * CALF));
  e.uncalibrated = { count: e.count, duration: e.duration }; e.count = c; e.duration = +(secs / c).toFixed(1); e.calib = CALF;
}
events.sort((a, b) => a.t - b.t);

// ---------- the footer
const L = [];
const ds = A.kills.map(k => k.duration);
L.push(`# ${A.name} (${DIFF}) - measured fight profile for SimulationCraft / Raidbots`);
L.push(`# Raidbots: Fight Style = Casting Patchwerk (NOT Patchwerk: it deletes raid events), Number of Bosses = 1,`);
L.push(`#   then Custom APL and SimC Options > tick "SimC Expert Mode" > paste this into Script Footer.`);
L.push(`# Measured from ${A.sample} ${DIFF} kills on Warcraft Logs, patch 12.1.5 (${Math.round(Math.min(...ds))}-${Math.round(Math.max(...ds))} s kills).`);
L.push(`# Kill length: median of ${A.duration.populationSize} ${A.populationLabel || 'ranked guild kills'} = ${maxTime} s (10th pct ${Math.round(A.duration.p10)}, 90th ${Math.round(A.duration.p90)}). Set your own here:`);
L.push(`max_time=${maxTime}`);
L.push('vary_combat_length=0.05');
L.push('');
L.push(bosses.length > 1 ? '# Bosses (all attackable at once unless an event below says otherwise)' : '# The boss');
if (C.enemiesNote) L.push(`# ${C.enemiesNote}`);
for (const b of bosses) L.push(`enemy=${simName(b)}`);
const n = {};
const id = base => { n[base] = (n[base] || 0) + 1; return `${base}_${n[base]}`; };
const section = (kind, head, fmt) => { const es = events.filter(e => e.kind === kind); if (!es.length) return; L.push(''); L.push(head); for (const e of es) L.push(...fmt(e)); };
section('adds', '# Adds: spawn = first hit on the wave, duration = first hit to last hit (median), count = median wave size' + (CALF !== 1
  ? `\n# Exposure (count x duration) calibrated x${CALF}: simc has no positions, so every area spell reaches every add.\n# This makes the share of damage that goes into adds match real players of the same spec. Measured values: boss page.` : ''), e => [
  `# ${e.name} x${e.count}: ${e.kills}/${A.sample} kills, spawn +-${e.spread}s${e.scale !== 1 ? `, alive ${e.measuredLife}s x ${e.scale}` : ''}${e.countScale && e.countScale !== 1 ? `, ${e.measuredCount} spawn x ${e.countScale}` : ''}${e.why ? ` (${e.why})` : ''}`,
  `raid_events+=/adds,name=${id(simName(e.name))},count=${e.count},first=${f1(e.t)},duration=${f1(e.duration)},cooldown=9999,health=1e10`]);
section('away', '# Boss out of reach: absent for a whole phase, or taking under 35% of its normal damage', e => [
  e.outside ? `# ${e.name} is only a target in its measured windows` : e.depth === undefined ? `# ${e.name} absent this phase${e.partial ? " outside its measured window" : ""} (present ${Math.round(e.presence * 100)}% of it)` : `# ${e.name}: ${e.kills}/${A.sample} kills, damage falls to ${Math.round(e.depth * 100)}%`,
  `raid_events+=/invulnerable,name=${id(simName(e.name) + '_away')},target=${simName(e.name)},first=${f1(Math.max(0.1, e.t))},duration=${f1(e.duration)},cooldown=9999`]);
section('vuln', '# Damage taken windows, timed from the aura in the logs. simc ADDS the multiplier: 0.3 = +30%, 1 = +100%', e => [
  `# ${e.aura} on ${e.name}: +${Math.round(e.mult * 100)}% damage taken, ${e.kills}/${A.sample} kills, start +-${e.spread}s`,
  `raid_events+=/vulnerable,name=${id(simName(e.aura))},target=${simName(e.name)},multiplier=${e.mult},first=${f1(e.t)},duration=${f1(e.duration)},cooldown=9999`]);
for (const role of ['melee', 'ranged']) {
  const mv = events.filter(e => e.kind === 'move' && e.role === role); if (!mv.length) continue;
  const total = mv.filter(e => e.t <= maxTime).reduce((s, e) => s + e.duration, 0);
  L.push('');
  L.push(role === 'melee'
    ? `# Melee movement (distance_max=6: melee only): time out of melee range, from auto-attack gaps; ${f1(total)} s in a ${maxTime} s kill`
    : `# Ranged movement (distance_min=6: ranged only): time casters could not hard-cast, from cast gaps; ${f1(total)} s in a ${maxTime} s kill`);
  for (const e of mv) L.push(`# ${e.label}: ${e.window[0]}-${e.window[1]} s, up to ${Math.round(e.peak * 100)}% of ${role}`,
    `raid_events+=/movement,name=${id((role === 'melee' ? 'M_' : 'R_') + simName(e.label))},players_only=1,${role === 'melee' ? 'distance_max=6' : 'distance_min=6'},first=${f1(e.t)},duration=${f1(e.duration)},cooldown=9999`);
}
fs.mkdirSync(OUTDIR, { recursive: true });
const file = `${OUTDIR}/${slug}_${DIFF}.simc`;
fs.writeFileSync(file, L.join('\n') + '\n');
fs.writeFileSync(`data/${BOSS}_${DIFF}.events.json`, JSON.stringify({ maxTime, bosses, events }));
console.log(file); if (process.env.SHOW) console.log(L.join('\n'));
