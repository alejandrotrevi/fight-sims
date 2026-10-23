// Aggregate the collected kills of one boss/difficulty into measured timings.
// usage: node analyze.js <bossId> <mythic|heroic>   -> out/<boss>_<diff>.json + a text summary on stdout
const fs = require('fs');
const [, , BOSS, DIFF = 'mythic'] = process.argv;
const R = JSON.parse(fs.readFileSync('raw/rankings.json', 'utf8'));

const MELEE = new Set(['Warrior-Arms', 'Warrior-Fury', 'Rogue-Assassination', 'Rogue-Outlaw', 'Rogue-Subtlety', 'DeathKnight-Frost', 'DeathKnight-Unholy',
  'Paladin-Retribution', 'Monk-Windwalker', 'DemonHunter-Havoc', 'Druid-Feral', 'Shaman-Enhancement', 'Hunter-Survival']);
const RANGED = new Set(['Mage-Arcane', 'Mage-Fire', 'Mage-Frost', 'Warlock-Affliction', 'Warlock-Demonology', 'Warlock-Destruction', 'Priest-Shadow',
  'Druid-Balance', 'Shaman-Elemental', 'Evoker-Devastation', 'Evoker-Augmentation', 'DemonHunter-Devourer', 'Hunter-BeastMastery', 'Hunter-Marksmanship']);

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, l = Math.floor(i); return s[l] + (s[Math.min(l + 1, s.length - 1)] - s[l]) * (i - l); };
const stat = a => a.length ? { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), med: +q(a, .5).toFixed(2), p25: +q(a, .25).toFixed(2), p75: +q(a, .75).toFixed(2), min: +Math.min(...a).toFixed(2), max: +Math.max(...a).toFixed(2) } : null;
const r1 = x => Math.round(x * 10) / 10;

const files = fs.readdirSync('raw/kills').filter(f => f.startsWith(`${BOSS}_${DIFF}_`));
const kills = files.map(f => { const k = JSON.parse(fs.readFileSync('raw/kills/' + f)); const af = 'raw/act/' + f; k.act = fs.existsSync(af) ? JSON.parse(fs.readFileSync(af)) : null; return k; });
if (!kills.length) { console.error('no kills'); process.exit(1); }
const out = { boss: +BOSS, name: R[BOSS].name, diff: DIFF, sample: kills.length, generated: new Date().toISOString() };

// ---------- kill length: the whole ranking population (top 1000 guild-best kills, or every kill when fewer) and the sample
const pop = R[BOSS][DIFF].rows.map(r => r.duration / 1000);
out.duration = { population: stat(pop), populationSize: pop.length, populationCapped: pop.length >= 950, p10: +q(pop, .1).toFixed(1), p90: +q(pop, .9).toFixed(1), sample: stat(kills.map(k => k.duration)) };
out.populationLabel = R[BOSS][DIFF].source ? `${DIFF} kills in randomly sampled public logs` : "ranked guild kills (each guild's best)";
out.sampleNote = R[BOSS][DIFF].source ? 'picked evenly across the kill lengths of kills found in randomly sampled public logs' : 'picked evenly across the Warcraft Logs speed ranking, fastest to slowest';
out.kills = kills.map(k => ({ code: k.code, fid: k.fid, guild: k.guild, region: k.region, duration: k.duration, rankPage: k.rankPage }));
out.comp = { melee: stat(kills.map(k => k.players.filter(p => p.role === 'dps' && MELEE.has(p.class + '-' + p.spec)).length)), ranged: stat(kills.map(k => k.players.filter(p => p.role === 'dps' && RANGED.has(p.class + '-' + p.spec)).length)) };

// ---------- segments (WCL phases). A kill's segments: [{phase, start, end}]
// config.phaseMerge: phases that are the same thing for DPS (e.g. whichever explorer is empowered) count as one phase
const CFG = fs.existsSync(`config/${BOSS}.json`) ? JSON.parse(fs.readFileSync(`config/${BOSS}.json`, 'utf8')) : {};
const mergeId = id => (CFG.phaseMerge && CFG.phaseMerge[id]) || id;
const segsOf = k => { const ps = (k.phases.length ? k.phases : [[1, 0]]).map(([id, t]) => [mergeId(id), t]); const s = ps.map(([id, t], i) => ({ phase: id, start: t, end: i + 1 < ps.length ? ps[i + 1][1] : k.duration })); if (s[0].start > 0.5) s.unshift({ phase: 1, start: 0, end: s[0].start }); return s; };
const seqKey = k => segsOf(k).map(s => s.phase).join('>');
const seqCount = {}; for (const k of kills) seqCount[seqKey(k)] = (seqCount[seqKey(k)] || 0) + 1;
const seqs = Object.entries(seqCount).sort((a, b) => b[1] - a[1]);
out.phaseSequences = seqs.map(([s, n]) => ({ seq: s, kills: n }));
// align segments by index along the longest common sequence among kills: use the most common sequence as the template
// the longest phase sequence that at least 20% of kills reach, so later phases of long kills exist
const template = seqs.filter(([, n]) => n >= kills.length * 0.2).map(([sq]) => sq).sort((a, b) => b.split('>').length - a.split('>').length)[0].split('>').map(Number);
out.segments = template.map((ph, i) => {
  const starts = [], lens = [];
  for (const k of kills) { const s = segsOf(k); if (s[i] && s[i].phase === ph) { starts.push(s[i].start); if (i + 1 < s.length) lens.push(s[i].end - s[i].start); } }
  return { index: i, phase: ph, start: stat(starts), length: stat(lens) };
});
const segAt = (k, t) => { const s = segsOf(k); let i = 0; while (i + 1 < s.length && s[i + 1].start <= t) i++; return { i, phase: s[i].phase, off: t - s[i].start, toEnd: s[i].end - t }; };
// a segment whose length varies between kills (a health-triggered transition) is timed from both ends:
// what happens in its first 60% from its start, the rest back from its end. The last segment ends with the kill
// and is timed from its start only.
out.segments.forEach((sg, i) => { sg.variable = i < out.segments.length - 1 && !!sg.length && sg.length.p75 - sg.length.p25 > 4; });
const segStartMed = i => (out.segments[i] && out.segments[i].start ? out.segments[i].start.med : 0);
const place = (i, off, toEnd) => { const sg = out.segments[i]; if (sg && sg.variable && toEnd && off.med > 0.6 * sg.length.med) return +(segStartMed(i) + sg.length.med - toEnd.med).toFixed(2); return +(segStartMed(i) + off.med).toFixed(2); };

// ---------- enemy casts, grouped by (caster game id, ability); begincast if the ability has any, else cast
const gidOf = (k, id) => { const n = k.npcs.find(n => n.id === id); return n ? n.gameID : null; };
const nameOfNpc = {}; for (const k of kills) for (const n of k.npcs) nameOfNpc[n.gameID] = n.name;
const abil = {}; for (const k of kills) Object.assign(abil, k.abilities);
const series = {}; // key -> per kill list of {t, seg, off}
for (const [ki, k] of kills.entries()) {
  const hasBegin = new Set(k.casts.filter(c => c[1] === 'b').map(c => c[2] + ':' + c[4]));
  const per = {};
  for (const [t, ty, src, inst, ab] of k.casts) {
    const g = gidOf(k, src); if (!g) continue;
    if (hasBegin.has(src + ':' + ab) ? ty !== 'b' : ty !== 'c') continue;
    const key = g + ':' + ab; const arr = per[key] || (per[key] = []);
    if (arr.length && t - arr[arr.length - 1] < 1.0) continue; // same cast reported on several targets/instances
    arr.push(t);
  }
  for (const [key, ts] of Object.entries(per)) { (series[key] = series[key] || {})[ki] = ts.map(t => ({ t, ...segAt(k, t) })); }
}
out.casts = [];
for (const [key, byKill] of Object.entries(series)) {
  const [g, ab] = key.split(':').map(Number);
  const present = Object.keys(byKill).length;
  if (present < Math.max(3, kills.length * 0.5)) continue;
  // occurrence slots: (segment index, nth in segment)
  const slots = {};
  for (const [ki, occ] of Object.entries(byKill)) {
    const nth = {};
    for (const o of occ) { const n = nth[o.i] = (nth[o.i] || 0) + 1; const sk = o.i + '#' + n; (slots[sk] = slots[sk] || []).push(o); }
  }
  const occ = Object.entries(slots).map(([sk, os]) => { const [i, n] = sk.split('#').map(Number); const off = stat(os.map(o => o.off)), toEnd = stat(os.map(o => o.toEnd)); return { seg: i, nth: n, kills: os.length, off, toEnd, tm: place(i, off, toEnd), t: stat(os.map(o => o.t)) }; })
    .filter(o => o.kills >= Math.max(3, kills.length * 0.3)).sort((a, b) => a.seg - b.seg || a.nth - b.nth);
  const counts = Object.values(byKill).map(o => o.length);
  out.casts.push({ caster: nameOfNpc[g], casterId: g, ability: abil[ab] || String(ab), abilityId: ab, killsWith: present, perKill: stat(counts), occurrences: occ });
}
out.casts.sort((a, b) => (a.occurrences[0] ? a.occurrences[0].t.med : 1e9) - (b.occurrences[0] ? b.occurrences[0].t.med : 1e9));

// ---------- adds: instances by game id, clustered into waves
const addAgg = {};
let bossDamage = 0, addDamage = 0;
for (const [ki, k] of kills.entries()) {
  // boss damage from the smoothed graph (dps * step)
  for (const arr of Object.values(k.bossGraph)) for (let i = 1; i < arr.length; i++) bossDamage += arr[i][1] * (arr[i][0] - arr[i - 1][0]) / kills.length;
  const byG = {};
  for (const [key, x] of Object.entries(k.addInst)) {
    const id = +key.split('.')[0]; if (k.bossIds.includes(id)) continue; const g = gidOf(k, id); if (!g) continue;
    (byG[g] = byG[g] || []).push(x); addDamage += x.total / kills.length;
  }
  for (const [g, xs] of Object.entries(byG)) {
    xs.sort((a, b) => a.first - b.first);
    const waves = []; for (const x of xs) { const w = waves[waves.length - 1]; if (w && x.first - w.lastSpawn < 10) { w.inst.push(x); w.lastSpawn = x.first; } else waves.push({ inst: [x], lastSpawn: x.first }); }
    const a = addAgg[g] || (addAgg[g] = { total: 0, kills: {} });
    a.total += xs.reduce((s, x) => s + x.total, 0) / kills.length;
    a.kills[ki] = waves.map(w => ({ spawn: w.inst[0].first, ...segAt(k, w.inst[0].first), count: w.inst.length, life: q(w.inst.map(x => x.last - x.first), .5), end: q(w.inst.map(x => x.last), .5) }));
  }
}
out.damageSplit = { bossShare: +(bossDamage / (bossDamage + addDamage)).toFixed(3) };
out.adds = Object.entries(addAgg).map(([g, a]) => {
  const ks = Object.values(a.kills);
  const slots = {};
  for (const waves of ks) { const nth = {}; for (const w of waves) { const n = nth[w.i] = (nth[w.i] || 0) + 1; (slots[w.i + '#' + n] = slots[w.i + '#' + n] || []).push(w); } }
  const waves = Object.entries(slots).map(([sk, ws]) => { const [i, n] = sk.split('#').map(Number); const off = stat(ws.map(w => w.off)), toEnd = stat(ws.map(w => w.toEnd)); return { seg: i, nth: n, kills: ws.length, spawn: stat(ws.map(w => w.spawn)), off, toEnd, tm: place(i, off, toEnd), count: stat(ws.map(w => w.count)), life: stat(ws.map(w => w.life)) }; })
    .filter(w => w.kills >= Math.max(3, kills.length * 0.3)).sort((x, y) => x.spawn.med - y.spawn.med);
  return { name: nameOfNpc[g], gameId: +g, killsWith: ks.length, damageShare: +(a.total / (bossDamage + addDamage)).toFixed(4), waves };
}).sort((a, b) => b.damageShare - a.damageShare);

// ---------- boss presence, from the smoothed damage-taken graph: present = taking at least 35% of its
// median damage (DoTs keep ticking on a boss that is away, so "zero" never happens)
const bossNames = {}; const pres = {};
for (const [ki, k] of kills.entries()) for (const [id, arr] of Object.entries(k.bossGraph)) {
  const g = gidOf(k, +id); bossNames[g] = nameOfNpc[g];
  const vals = arr.map(x => x[1]).filter(v => v > 0); const ref = q(vals, .5) || 1;
  const n = Math.ceil(k.duration) + 1; const p = new Array(n).fill(null); const dv = new Array(n).fill(null);
  for (const [t, v] of arr) { const sec = Math.min(n - 1, Math.max(0, Math.floor(t))); p[sec] = v >= ref * 0.35 ? 1 : 0; dv[sec] = v / ref; }
  for (let i = 1; i < n; i++) { if (p[i] === null) { p[i] = p[i - 1]; dv[i] = dv[i - 1]; } }
  (pres[g] = pres[g] || []).push({ ki, k, p, dv });
}
out.bossAway = Object.entries(pres).map(([g, list]) => {
  // share of each template segment the boss is present for, averaged over the kills
  const segPresence = template.map((ph, i) => { const fr = []; for (const { k, p } of list) { const s = segsOf(k)[i]; if (!s || s.phase !== ph) continue; const a = Math.floor(s.start), b = Math.min(p.length, Math.floor(s.end)); if (b - a < 2) continue; let on = 0; for (let x = a; x < b; x++) on += p[x] || 0; fr.push(on / (b - a)); } return fr.length ? +(fr.reduce((x, y) => x + y, 0) / fr.length).toFixed(2) : null; });
  // windows of 5 s or more inside segments where it is present; one that runs to the end of the kill is death
  const slots = {};
  for (const { k, p, dv } of list) {
    const segs = segsOf(k); const nth = {};
    // gaps are split at phase boundaries: each phase judges its own part (a boss absent for a whole phase is
    // segPresence's job; the gap at the start or end of a phase it is present for is a window)
    let st = null;
    const close = x => {
      const sg = segAt(k, st);
      const inside = (segPresence[sg.i] || 0) >= 0.6 && x < k.duration - 3;
      if (x - st >= 5 && inside) { const n = nth[sg.i] = (nth[sg.i] || 0) + 1; (slots[sg.i + '#' + n] = slots[sg.i + '#' + n] || []).push({ start: st, end: x, depth: Math.min(...dv.slice(st, x)), off: sg.off, toEnd: sg.toEnd }); }
      st = null;
    };
    for (let x = 0; x <= p.length; x++) {
      const off = x < p.length ? p[x] === 0 : false;
      if (st !== null && x < p.length && segAt(k, x).i !== segAt(k, st).i) { close(x); }
      if (off && st === null) st = x;
      if (!off && st !== null) close(x);
    }
  }
  const windows = Object.entries(slots).map(([sk, xs]) => { const [i] = sk.split('#').map(Number); const off = stat(xs.map(x => x.off)), toEnd = stat(xs.map(x => x.toEnd)); return { seg: i, slot: sk, kills: xs.length, start: stat(xs.map(x => x.start)), off, toEnd, tm: place(i, off, toEnd), length: stat(xs.map(x => x.end - x.start)), depth: stat(xs.map(x => x.depth)) }; })
    .filter(x => x.kills >= Math.max(3, kills.length * 0.3)).sort((a, b) => a.tm - b.tm);
  // the opposite: runs of 3 s or more where it IS taking damage, for boss-tagged units that come and go like adds
  const pslots = {};
  for (const { k, p } of list) {
    const nth = {}; let st = null;
    for (let x = 0; x <= p.length; x++) {
      const on = x < p.length && p[x] === 1;
      if (on && st === null) st = x;
      if (!on && st !== null) { if (x - st >= 3) { const sg = segAt(k, st); const n = nth[sg.i] = (nth[sg.i] || 0) + 1; (pslots[sg.i + '#' + n] = pslots[sg.i + '#' + n] || []).push({ start: st, len: x - st, off: sg.off, toEnd: sg.toEnd }); } st = null; }
    }
  }
  const present = Object.entries(pslots).map(([sk, xs]) => { const [i] = sk.split('#').map(Number); const off = stat(xs.map(x => x.off)), toEnd = stat(xs.map(x => x.toEnd)); return { seg: i, kills: xs.length, start: stat(xs.map(x => x.start)), off, toEnd, tm: place(i, off, toEnd), length: stat(xs.map(x => x.len)) }; })
    .filter(x => x.kills >= Math.max(3, kills.length * 0.3)).sort((a, b) => a.tm - b.tm);
  return { boss: bossNames[g], gameId: +g, segPresence, windows, present };
});

// ---------- auras on the bosses (apply..remove windows), aligned like casts
const auraSlots = {};
for (const [ki, k] of kills.entries()) {
  const open = {}; const nth = {};
  for (const [t, ty, src, tgt, inst, ab] of k.buffs) {
    if (!k.bossIds.includes(tgt)) continue;
    const g = gidOf(k, tgt); const key = g + ':' + ab; const ok = key + '.' + inst;
    if (ty === 'applybuff') open[ok] = { t, key };
    else if (ty === 'removebuff' && open[ok] !== undefined) {
      const st = open[ok].t; delete open[ok]; const sg = segAt(k, st);
      const n = (nth[key + '#' + sg.i] = (nth[key + '#' + sg.i] || 0) + 1);
      const a = auraSlots[key] || (auraSlots[key] = { kills: new Set(), slots: {} }); a.kills.add(ki);
      // a window cut by the kill (removed in the last second) has no real length
      (a.slots[sg.i + '#' + n] = a.slots[sg.i + '#' + n] || []).push({ start: st, off: sg.off, toEnd: sg.toEnd, len: k.duration - t < 1 ? null : t - st });
    }
  }
  for (const { t: st, key } of Object.values(open)) { // still up when the kill ended
    const sg = segAt(k, st); const n = (nth[key + '#' + sg.i] = (nth[key + '#' + sg.i] || 0) + 1);
    const a = auraSlots[key] || (auraSlots[key] = { kills: new Set(), slots: {} }); a.kills.add(ki);
    (a.slots[sg.i + '#' + n] = a.slots[sg.i + '#' + n] || []).push({ start: st, off: sg.off, toEnd: sg.toEnd, len: null });
  }
}
out.auras = Object.entries(auraSlots).filter(([, a]) => a.kills.size >= kills.length * 0.5).map(([key, a]) => {
  const [g, ab] = key.split(':').map(Number);
  const allLens = Object.values(a.slots).flat().map(w => w.len).filter(x => x !== null);
  return { target: nameOfNpc[g], aura: abil[ab] || String(ab), auraId: ab, killsWith: a.kills.size,
    windows: Object.entries(a.slots).map(([sk, ws]) => { const [i, n] = sk.split('#').map(Number); const off = stat(ws.map(w => w.off)), toEnd = stat(ws.map(w => w.toEnd)); return { seg: i, nth: n, kills: ws.length, start: stat(ws.map(w => w.start)), off, toEnd, tm: place(i, off, toEnd), length: stat(ws.map(w => w.len).filter(x => x !== null).length >= 3 ? ws.map(w => w.len).filter(x => x !== null) : allLens), cutByKill: ws.filter(w => w.len === null).length }; })
      .filter(w => w.kills >= Math.max(3, kills.length * 0.3)).sort((x, y) => x.start.med - y.start.med) };
});

// ---------- role downtime curves (0.25 s bins), aligned by segment start
const BIN = 0.25;
function roleCurves(k) {
  const a = k.act; if (!a) return null;
  const nb = Math.ceil(k.duration / BIN) + 1;
  const mk = () => ({ off: new Float32Array(nb), n: new Float32Array(nb) });
  const melee = mk(), ranged = mk();
  for (const p of k.players) {
    if (p.role !== 'dps') continue; const sp = p.class + '-' + p.spec;
    if (MELEE.has(sp)) {
      const sw = (a.swings[p.id] || []).slice().sort((x, y) => x - y); if (sw.length < 20) continue;
      const g0 = q(sw.slice(1).map((t, i) => t - sw[i]), .5);
      for (let i = 0; i + 1 < sw.length; i++) {
        const G = sw[i + 1] - sw[i]; const b0 = Math.ceil(sw[i] / BIN), b1 = Math.floor(sw[i + 1] / BIN);
        if (G > 25) continue; // dead or not measurable
        const cut = G > Math.max(2.2, 2.5 * g0) ? sw[i] + g0 : Infinity;
        for (let b = b0; b <= b1 && b < nb; b++) { melee.n[b]++; if (b * BIN > cut) melee.off[b]++; }
      }
    } else if (RANGED.has(sp)) {
      // casters only: "off" = not hard-casting (a begincast..cast span); a forced move shows as hard-casting stopping
      const cs = (a.casts[p.id] || []).slice().sort((x, y) => x[0] - y[0]); if (cs.length < 30) continue;
      const hard = []; let open = null;
      for (const [t, ty, ab] of cs) { if (ty === 'b') open = [t, ab]; else { if (open && open[1] === ab && t - open[0] < 6 && t - open[0] > 0.3) hard.push([open[0], t]); open = null; } }
      const span = cs[cs.length - 1][0] - cs[0][0];
      if (hard.reduce((s, [x, y]) => s + y - x, 0) < 0.3 * span) continue;
      const inHard = new Uint8Array(nb); for (const [x, y] of hard) for (let b = Math.ceil(x / BIN); b * BIN <= y && b < nb; b++) inHard[b] = 1;
      for (let i = 0; i + 1 < cs.length; i++) {
        const s0 = cs[i][0], s1 = cs[i + 1][0]; if (s1 - s0 > 25) continue;
        for (let b = Math.ceil(s0 / BIN); b * BIN < s1 && b < nb; b++) { ranged.n[b]++; if (!inHard[b]) ranged.off[b]++; }
      }
    }
  }
  return { melee, ranged, nb };
}
const curveSegs = template.map(() => ({ melee: [], ranged: [] }));
let actKills = 0;
for (const k of kills) {
  const c = roleCurves(k); if (!c) continue; actKills++;
  const s = segsOf(k);
  template.forEach((ph, i) => {
    if (!s[i] || s[i].phase !== ph) return;
    for (const role of ['melee', 'ranged']) {
      const arr = []; const b0 = Math.round(s[i].start / BIN), b1 = Math.round(s[i].end / BIN);
      const val = b => (b >= 0 && b < c.nb && c[role].n[b] > 0 ? c[role].off[b] / c[role].n[b] : NaN);
      if (out.segments[i].variable) {
        const Lm = Math.round(out.segments[i].length.med / BIN), split = Math.round(0.6 * Lm);
        for (let b = 0; b < Lm; b++) arr.push(b < split ? (b0 + b < b1 ? val(b0 + b) : NaN) : (b1 - (Lm - b) >= b0 ? val(b1 - (Lm - b)) : NaN));
      } else for (let b = b0; b < b1 && b < c.nb; b++) arr.push(val(b));
      curveSegs[i][role].push(arr);
    }
  });
}
out.activityKills = actKills;
out.downtime = curveSegs.map((cs, i) => {
  const res = {};
  for (const role of ['melee', 'ranged']) {
    const L = Math.max(0, ...cs[role].map(a => a.length)); const mean = [], cnt = [];
    for (let b = 0; b < L; b++) { let s = 0, n = 0; for (const a of cs[role]) if (b < a.length && !isNaN(a[b])) { s += a[b]; n++; } mean.push(n >= Math.max(3, cs[role].length * 0.4) ? s / n : NaN); cnt.push(n); }
    const valid = mean.filter(v => !isNaN(v)); const base = q(valid, .4) || 0;
    // dips: excess over baseline as a share of the players who were attacking/hard-casting at baseline
    // (i.e. the fraction of the role forced off the boss), smoothed over 1 s
    const ex = mean.map((v, b) => { if (i === 0 && b * BIN < 4) return 0; let s = 0, n = 0; for (let j = b - 2; j <= b + 2; j++) if (j >= 0 && j < mean.length && !isNaN(mean[j])) { s += mean[j]; n++; } return n ? Math.max(0, s / n - base) / (1 - base) : 0; });
    const dips = []; let st = null;
    for (let b = 0; b <= ex.length; b++) {
      const v = b < ex.length ? ex[b] : 0;
      if (v > 0.06) { if (st === null) st = b; } else if (st !== null) {
        let a = st, z = b; while (a > 0 && ex[a - 1] > 0.02) a--; while (z < ex.length && ex[z] > 0.02) z++;
        const area = ex.slice(a, z).reduce((s, x) => s + x, 0) * BIN; const peak = Math.max(...ex.slice(a, z));
        const w = ex.slice(a, z); const center = (a + w.reduce((s, x, j) => s + x * j, 0) / w.reduce((s, x) => s + x, 0)) * BIN;
        if (area >= 0.4 && peak > 0.12) dips.push({ start: r1(a * BIN), end: r1(z * BIN), center: r1(center), lost: +area.toFixed(2), peak: +peak.toFixed(2) });
        st = null; b = z;
      }
    }
    // merge dips closer than 1 s
    const m = []; for (const d of dips) { const p = m[m.length - 1]; if (p && d.start - p.end < 1) { p.center = r1((p.center * p.lost + d.center * d.lost) / (p.lost + d.lost)); p.end = d.end; p.lost = +(p.lost + d.lost).toFixed(2); p.peak = Math.max(p.peak, d.peak); } else m.push({ ...d }); }
    // bootstrap the kills (500 resamples) for a 90% range on each dip's lost seconds, over the same window
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const K = cs[role].length;
    for (const d of m) {
      const b0 = Math.round(d.start / BIN), b1 = Math.round(d.end / BIN); const lost = [];
      for (let r = 0; r < 500; r++) {
        const pick = Array.from({ length: K }, () => cs[role][Math.floor(rnd() * K)]);
        let area = 0;
        for (let b = b0; b < b1; b++) { let s = 0, n = 0; for (const a of pick) if (b < a.length && !isNaN(a[b])) { s += a[b]; n++; } if (n) area += Math.max(0, s / n - base) / (1 - base); }
        lost.push(area * BIN);
      }
      d.lostCI = [+q(lost, .05).toFixed(2), +q(lost, .95).toFixed(2)];
    }
    res[role] = { kills: cs[role].length, baseline: +base.toFixed(3), dips: m, curve: mean.filter((_, b) => b % 2 === 0).map(v => isNaN(v) ? null : +v.toFixed(3)) };
  }
  return { seg: i, phase: template[i], ...res };
});

// ---------- real share of each player's damage that went into adds (non-boss enemies), per spec
const shareBy = {};
for (const f of files) { const sf = 'raw/share/' + f; if (!fs.existsSync(sf)) continue; const k = kills.find(x => f.includes(x.code + '_' + x.fid));
  for (const p of JSON.parse(fs.readFileSync(sf)).players) { const pl = k && k.players.find(x => x.id === p.id); if (!pl || pl.role !== 'dps' || !p.total) continue; (shareBy[p.icon] = shareBy[p.icon] || []).push(p.adds / p.total); } }
out.addShare = { kills: files.filter(f => fs.existsSync('raw/share/' + f)).length, all: stat(Object.values(shareBy).flat()), bySpec: Object.fromEntries(Object.entries(shareBy).map(([k, v]) => [k, stat(v)])) };

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(`data/${BOSS}_${DIFF}.json`, JSON.stringify(out));

// ---------- text summary
const L = [];
L.push(`${out.name} ${DIFF}: sample ${kills.length} kills (${actKills} with activity); population ${pop.length}${out.duration.populationCapped ? ' (capped top 1000)' : ''}`);
L.push(`kill length population med ${out.duration.population.med}s IQR ${out.duration.population.p25}-${out.duration.population.p75} p10 ${out.duration.p10} p90 ${out.duration.p90}; sample med ${out.duration.sample.med}`);
L.push(`comp melee ${out.comp.melee.med} ranged ${out.comp.ranged.med}; boss damage share ${out.damageSplit.bossShare}`);
L.push(`phase sequences: ${out.phaseSequences.map(s => s.seq + ' x' + s.kills).join(' | ')}`);
for (const s of out.segments) L.push(`  seg ${s.index} phase ${s.phase}: start ${s.start && s.start.med} [${s.start && s.start.p25}-${s.start && s.start.p75}] len ${s.length ? s.length.med : '-'}${s.variable ? ' (variable)' : ''}`);
L.push('casts:');
for (const c of out.casts) L.push(`  ${c.caster} | ${c.ability} (${c.abilityId}) kills ${c.killsWith} perKill ${c.perKill.med} :: ` + c.occurrences.map(o => `${o.seg}/${o.nth}@${o.t.med}${o.seg ? '(+' + o.off.med + ')' : ''}±${r1((o.t.p75 - o.t.p25) / 2)}${o.kills < kills.length * 0.8 ? '[' + o.kills + ']' : ''}`).join(' '));
L.push('adds:');
for (const a of out.adds) if (a.damageShare > 0.002) L.push(`  ${a.name} (${a.gameId}) share ${a.damageShare} kills ${a.killsWith} :: ` + a.waves.map(w => `@${w.spawn.med}x${w.count.med} life ${w.life.med}[${w.kills}]`).join(' '));
L.push('boss presence per segment / away windows:');
for (const b of out.bossAway) L.push(`  ${b.boss}: [${b.segPresence.join(' ')}] ` + b.windows.map(w => `${w.tm}+${w.length.med} (dmg ${w.depth.med})[${w.kills}]`).join(' '));
L.push('downtime dips (per segment):');
for (const d of out.downtime) for (const role of ['melee', 'ranged']) L.push(`  seg ${d.seg} ${role} (k=${d[role].kills}, base ${d[role].baseline}): ` + d[role].dips.map(x => `${x.start}-${x.end} c${x.center} lost ${x.lost}s [${x.lostCI}] pk ${x.peak}`).join(' | '));
console.log(L.join('\n'));
