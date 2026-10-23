// Build the static GitHub Pages site in docs/ from data/, config/ and sims/.
// usage: node tools/build-site.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const ex = p => fs.existsSync(path.join(ROOT, p));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = x => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const RAID = rd('config/raid.json');
const BOSSES = RAID.bosses; // [{id, name, slug}]
const DIFFS = ['mythic', 'heroic'];
const IMPACT = ex('sims/impact.json') ? rd('sims/impact.json') : {};
const CALIB = ex('sims/calibration.json') ? rd('sims/calibration.json') : {};
const built = new Date().toISOString().slice(0, 10);

function load(b, diff) {
  const base = `data/${b.id}_${diff}`;
  if (!ex(base + '.json') || !ex(base + '.events.json')) return null;
  const A = rd(base + '.json'), E = rd(base + '.events.json');
  const simcPath = `docs/profiles/${b.slug}_${diff}.simc`;
  const C0 = ex(`config/${b.id}.json`) ? rd(`config/${b.id}.json`) : {};
  const C = { ...C0, ...(C0[diff] || {}) }; // config.mythic / config.heroic override the shared settings
  return { A, E, C, phaseNames: b.phases || {}, simc: fs.readFileSync(path.join(ROOT, simcPath), 'utf8'), simcFile: `${b.slug}_${diff}.simc` };
}

// the mark: three boss-mod bars, the way a fight looks on screen
const MARK = `<svg width="26" height="22" viewBox="0 0 26 22" aria-hidden="true"><rect x="0" y="1" width="26" height="5" rx="2" fill="var(--accent)"/><rect x="0" y="8.5" width="17" height="5" rx="2" fill="var(--lane-adds)"/><rect x="0" y="16" width="22" height="5" rx="2" fill="var(--lane-melee)"/></svg>`;
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230d7356'/%3E%3Crect x='6' y='8' width='20' height='4' rx='1.5' fill='white'/%3E%3Crect x='6' y='14' width='13' height='4' rx='1.5' fill='%23f1b360'/%3E%3Crect x='6' y='20' width='17' height='4' rx='1.5' fill='%2393b7f5'/%3E%3C/svg%3E";
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,600..800&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600;700&display=swap';

// fragment: the page without its document skeleton, for the claude.ai preview, which wraps the main page itself
function layout(title, body, { rel = '', desc = '', fragment = false } = {}) {
  const head = `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${rel}assets/style.css">
<link rel="icon" href="${FAVICON}">`;
  return `${fragment ? head : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>`}
<header class="site"><div class="wrap">
  <a class="brand" href="${rel}index.html">${MARK}Fight Sims</a>
  <nav><a href="${rel}index.html#bosses">Bosses</a><a href="${rel}index.html#how">How to use</a><a href="${rel}methodology.html">Methodology</a><a href="${RAID.repo}">GitHub</a></nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="site"><div class="wrap">
  <p>${esc(RAID.raid)} &middot; patch ${esc(RAID.patch)} &middot; data pulled ${esc(RAID.pulled)} &middot; site built ${built}.
  Timings are measured from public <a href="https://www.warcraftlogs.com">Warcraft Logs</a> reports; every report used is listed on its boss page.
  Not affiliated with Blizzard, Raidbots, SimulationCraft or Warcraft Logs.</p>
</div></footer>
<script>
document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
  const pre = document.getElementById(b.dataset.copy);
  try { await navigator.clipboard.writeText(pre.textContent); b.textContent = 'Copied'; }
  catch (e) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Press Ctrl+C'; }
  setTimeout(() => (b.textContent = 'Copy'), 1800);
}));
</script>
${fragment ? '' : '</body>\n</html>\n'}`;
}

const HOWTO = `<ol class="steps">
  <li>On <a href="https://www.raidbots.com">Raidbots</a>, open Top Gear, Droptimizer or Quick Sim and paste your <code>/simc</code> string as usual.</li>
  <li>In <b>Simulation Options</b>, set <b>Fight Style</b> to <b>Casting Patchwerk</b>. Plain Patchwerk deletes every raid event, so the boss's mechanics would silently vanish.</li>
  <li>Set <b>Number of Bosses</b> to <b>1</b>. The profile creates the bosses itself. Leave <b>Fight Length</b> alone: the profile sets it.</li>
  <li>Open <b>Custom APL and SimC Options</b>, tick <b>SimC Expert Mode</b>, and paste the profile into the <b>Script Footer</b> box. The normal custom-options box rejects raid events.</li>
  <li>Run the sim. Then check the report: under <i>Raid Events</i> you should see the boss's adds and movement, and the DPS should differ from your Patchwerk number.</li>
</ol>`;

// ---------- timeline svg
function timeline(d) {
  const { A, E } = d;
  const T = Math.max(E.maxTime, ...E.events.map(e => e.t + (e.duration || 0))) * 1.0;
  const W = 1000, L = 120, R = 12, X = t => L + (W - L - R) * Math.min(t, T) / T;
  const lanes = [];
  const segs = A.segments.filter(s => s.start && s.start.med < T);
  if (segs.length > 1) lanes.push({ key: 'phase', label: 'Phases', h: 22 });
  for (const b of E.bosses) lanes.push({ key: 'boss:' + b, label: b, h: 18 });
  if (E.events.some(e => e.kind === 'adds')) lanes.push({ key: 'adds', label: 'Adds', h: 26 });
  lanes.push({ key: 'melee', label: 'Melee moving', h: 34 });
  lanes.push({ key: 'ranged', label: 'Ranged moving', h: 34 });
  let y = 8; for (const l of lanes) { l.y = y; y += l.h + 8; }
  const H = y + 22;
  const o = [];
  o.push(`<svg class="tl" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fight timeline">`);
  for (const l of lanes) o.push(`<text class="lab" x="0" y="${l.y + l.h / 2 + 4}">${esc(l.label.length > 18 ? l.label.slice(0, 17) + '…' : l.label)}</text>`);
  // grid
  const step = T > 400 ? 60 : 30;
  for (let t = 0; t <= T; t += step) o.push(`<line x1="${X(t)}" x2="${X(t)}" y1="4" y2="${H - 18}" stroke="var(--line)" stroke-width="1"/><text x="${X(t)}" y="${H - 4}" text-anchor="middle">${mmss(t)}</text>`);
  o.push(`<line x1="${X(E.maxTime)}" x2="${X(E.maxTime)}" y1="4" y2="${H - 18}" stroke="var(--text)" stroke-dasharray="3 3" stroke-width="1"><title>Simulated kill length ${E.maxTime} s</title></line>`);
  const lane = k => lanes.find(l => l.key === k);
  // phases
  const P = lane('phase');
  if (P) segs.forEach((s, i) => {
    const a = s.start.med, b = segs[i + 1] ? segs[i + 1].start.med : T;
    const name = d.phaseNames[s.phase] || `Phase ${s.phase}`;
    o.push(`<rect x="${X(a)}" y="${P.y}" width="${Math.max(1, X(b) - X(a) - 1)}" height="${P.h}" rx="4" fill="var(--lane-phase)" stroke="var(--line)"><title>${esc(name)}: starts ${f1(a)} s (IQR ${f1(s.start.p25)}-${f1(s.start.p75)})</title></rect>`);
    if (X(b) - X(a) > 50) o.push(`<text x="${X(a) + 5}" y="${P.y + 15}">${esc(name.length > 26 ? name.slice(0, 25) + '…' : name)}</text>`);
  });
  // bosses: bar, away gaps, damage windows
  for (const b of E.bosses) {
    const l = lane('boss:' + b);
    o.push(`<rect x="${X(0)}" y="${l.y + 5}" width="${X(T) - X(0)}" height="${l.h - 10}" rx="3" fill="var(--lane-away)" opacity="0.35"/>`);
    for (const e of E.events.filter(e => e.kind === 'away' && e.name === b)) o.push(`<rect x="${X(e.t)}" y="${l.y}" width="${X(e.t + e.duration) - X(e.t)}" height="${l.h}" rx="3" fill="var(--bg)" stroke="var(--lane-away)" stroke-dasharray="3 2"><title>${esc(b)} away/immune ${f1(e.t)}-${f1(e.t + e.duration)} s</title></rect>`);
    for (const e of E.events.filter(e => e.kind === 'vuln' && e.name === b)) o.push(`<rect x="${X(e.t)}" y="${l.y}" width="${X(e.t + e.duration) - X(e.t)}" height="${l.h}" rx="3" fill="var(--lane-vuln)"><title>${esc(e.aura)}: +${Math.round(e.mult * 100)}% damage taken, ${f1(e.t)}-${f1(e.t + e.duration)} s</title></rect>`);
  }
  // adds
  const AL = lane('adds');
  if (AL) for (const e of E.events.filter(e => e.kind === 'adds')) {
    o.push(`<rect x="${X(e.t)}" y="${AL.y}" width="${Math.max(2, X(e.t + e.duration) - X(e.t))}" height="${AL.h}" rx="3" fill="var(--lane-adds)" opacity="0.85"><title>${esc(e.name)} x${e.count}: ${f1(e.t)} s, alive ${f1(e.duration)} s</title></rect>`);
    if (X(e.t + e.duration) - X(e.t) > 14) o.push(`<text x="${X(e.t) + 3}" y="${AL.y + 17}" style="fill:#fff;font-weight:600">${e.count}</text>`);
  }
  // movement lanes: measured curve (excess share of the role) + the simulated events
  for (const role of ['melee', 'ranged']) {
    const l = lane(role);
    const pts = [];
    A.downtime.forEach(dseg => {
      const s0 = A.segments[dseg.seg] && A.segments[dseg.seg].start ? A.segments[dseg.seg].start.med : null; if (s0 === null) return;
      const c = dseg[role].curve, base = dseg[role].baseline;
      c.forEach((v, i) => { const t = s0 + i * 0.5; if (v === null || t > T) return; pts.push([t, Math.max(0, (v - base) / (1 - base))]); });
    });
    pts.sort((a, b) => a[0] - b[0]);
    if (pts.length) {
      const sm = pts.map((p, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(pts.length - 1, i + 2); j++) { s += pts[j][1]; n++; } return [p[0], s / n]; });
      const d = sm.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${(l.y + l.h - Math.min(1, v) * l.h).toFixed(1)}`).join('');
      o.push(`<path d="${d}L${X(sm[sm.length - 1][0]).toFixed(1)},${l.y + l.h}L${X(sm[0][0]).toFixed(1)},${l.y + l.h}Z" fill="var(--lane-${role})" opacity="0.18"/>`);
      o.push(`<path d="${d}" fill="none" stroke="var(--lane-${role})" stroke-width="1" opacity="0.6"/>`);
    }
    for (const e of E.events.filter(e => e.kind === 'move' && e.role === role)) o.push(`<rect x="${X(e.t)}" y="${l.y + l.h - 9}" width="${Math.max(2, X(e.t + e.duration) - X(e.t))}" height="9" rx="2" fill="var(--lane-${role})"><title>${esc(e.label)}: ${role} move ${f1(e.duration)} s at ${f1(e.t)} s</title></rect>`);
    o.push(`<line x1="${X(0)}" x2="${X(T)}" y1="${l.y + l.h}" y2="${l.y + l.h}" stroke="var(--line)"/>`);
  }
  o.push('</svg>');
  return o.join('\n') + `<div class="legend"><span><i style="background:var(--lane-adds)"></i>adds (alive time)</span><span><i style="background:var(--bg);border:1px dashed var(--lane-away)"></i>boss away or immune</span><span><i style="background:var(--lane-vuln)"></i>boss takes extra damage</span><span><i style="background:var(--lane-melee)"></i>melee movement</span><span><i style="background:var(--lane-ranged)"></i>ranged movement</span><span>shaded curve: share of the role forced off the boss, averaged over the kills</span><span>dashed line: simulated kill length</span></div>`;
}

function eventRows(d) {
  const { A, E } = d;
  const rows = E.events.filter(e => e.t <= E.maxTime * 1.06).map(e => {
    if (e.kind === 'adds') return [e.t, `<span class="tag adds">adds</span>`, `${esc(e.name)} &times;${e.count}`, `alive ${f1(e.duration)} s`,
      `${e.kills}/${A.sample} kills, spawn &plusmn;${e.spread} s, ${e.share == null ? 'timed from its damage graph' : `${(e.share * 100).toFixed(1)}% of raid damage`}` +
      (e.calib ? `; measured &times;${e.uncalibrated.count} for ${f1(e.uncalibrated.duration)} s, calibrated &times;${e.calib}` : '') + (e.mainTarget ? '; the main target while the bosses are gone, so kept at its measured size' : '') +
      (e.scale && e.scale !== 1 ? `; alive ${f1(e.measuredLife)} s measured, counted &times;${e.scale}` : '') + (e.countScale && e.countScale !== 1 ? `; ${f1(e.measuredCount)} spawn, counted &times;${e.countScale}` : '') + (e.why ? ` (${esc(e.why)})` : '')];
    if (e.kind === 'away') return [e.t, `<span class="tag away">away</span>`, `${esc(e.name)} ${e.outside ? 'not a target' : 'out of reach'}`, `${f1(e.duration)} s`,
      e.outside ? 'only a target in its measured windows' : e.presence !== undefined ? `absent this phase${e.partial ? " outside the window it comes back for" : ""} (present ${Math.round(e.presence * 100)}% of it, averaged over the kills)` : `${e.kills}/${A.sample} kills, damage on it falls to ${Math.round(e.depth * 100)}%`];
    if (e.kind === 'vuln') return [e.t, `<span class="tag vuln">+${Math.round(e.mult * 100)}%</span>`, `${esc(e.aura)} on ${esc(e.name)}`, `${f1(e.duration)} s`, `${e.kills}/${A.sample} kills, aura start &plusmn;${e.spread} s${e.measured ? `; multiplier ${esc(e.measured)}` : ''}`];
    return [e.t, `<span class="tag ${e.role}">${e.role}</span>`, `${esc(e.label)}`, `${f1(e.duration)} s`, `window ${f1(e.window[0])}-${f1(e.window[1])} s, up to ${Math.round(e.peak * 100)}% of ${e.role}, 90% range ${e.lostCI ? e.lostCI.map(f1).join('-') + ' s' : 'n/a'}`];
  });
  return `<div class="tablewrap"><table><thead><tr><th class="num">Time</th><th>Type</th><th>What</th><th>Length</th><th>Evidence</th></tr></thead><tbody>
${rows.map(r => `<tr><td class="num">${f1(r[0])} s</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td class="wrap-ok small muted">${r[4]}</td></tr>`).join('\n')}
</tbody></table></div>`;
}

function castRows(d) {
  const { A } = d;
  const bossNames = new Set(d.E.bosses.concat(A.bossAway.map(b => b.boss)));
  const cs = A.casts.filter(c => bossNames.has(c.caster) && c.perKill.med <= 20 && c.occurrences.length);
  return `<div class="tablewrap"><table><thead><tr><th>Ability</th><th>Caster</th><th class="num">Per kill</th><th>Casts (median from pull, &plusmn; half the interquartile range)</th></tr></thead><tbody>
${cs.map(c => `<tr><td>${esc(c.ability)} <span class="muted small">${c.abilityId}</span></td><td>${esc(c.caster)}</td><td class="num">${c.perKill.med}</td><td class="wrap-ok small">${c.occurrences.slice(0, 14).map(o => `${f1(o.t.med)}${o.t.p75 - o.t.p25 > 0.3 ? `<span class="muted">&plusmn;${f1((o.t.p75 - o.t.p25) / 2)}</span>` : ''}`).join(', ')}${c.occurrences.length > 14 ? ', …' : ''}</td></tr>`).join('\n')}
</tbody></table></div>`;
}

function impactTable(b, diff, A) {
  const r = IMPACT[`${b.id}_${diff}`]; if (!r) return '';
  const cal = CALIB[`${b.id}_${diff}`];
  const shares = A.addShare && A.addShare.all && (A.addShare.all.mean > 0.005 || r.some(x => x.simAddShare > 0.005));
  const pct = x => `${Math.round(x * 100)}%`;
  // average gap between sim and real add share over the characters with enough real players
  const comp = r.filter(x => x.realAddShare !== null && x.realPlayers >= 8);
  const gap = comp.length ? Math.abs(comp.reduce((s, x) => s + x.simAddShare - x.realAddShare, 0) / comp.length) : 0;
  const over = comp.reduce((s, x) => s + x.simAddShare - x.realAddShare, 0) > 0;
  const real = x => x.realAddShare !== null && x.realPlayers >= 3 ? `${pct(x.realAddShare)} <span class="muted small">(${x.realPlayers} players)</span>` : '<span class="muted small">too few players</span>';
  return `<h2>What it does to a sim</h2>
<p>Sample characters from SimulationCraft's own MID2 profiles, same kill length, Casting Patchwerk with and without this profile. This shows how much the fight itself moves the numbers; your own gear changes the absolute DPS, not the direction.</p>
<div class="tablewrap impact"><table><thead><tr><th>Character</th><th class="num">1-target Patchwerk</th><th class="num">This fight</th><th class="num">Change</th>${shares ? '<th class="num">Into adds, sim</th><th class="num">Into adds, real players</th>' : ''}</tr></thead><tbody>
${r.map(x => `<tr><td>${esc(x.label)}</td><td class="num">${(x.base / 1000).toFixed(1)}K</td><td class="num">${(x.fight / 1000).toFixed(1)}K</td><td class="num ${x.fight >= x.base ? 'pos' : 'neg'}">${x.fight >= x.base ? '+' : ''}${((x.fight / x.base - 1) * 100).toFixed(1)}%</td>${shares ? `<td class="num">${pct(x.simAddShare)}</td><td class="num">${real(x)}</td>` : ''}</tr>`).join('\n')}
</tbody></table></div>
${shares ? `<p class="small muted" style="margin-top:8px">"Into adds" is the share of damage that went into adds rather than the bosses: in the sim, and for real players of the same spec in the ${A.addShare.kills} kills (average per player: raids put some players on adds and leave others on the boss, so many real players put 0% into adds). All DPS players together averaged ${pct(A.addShare.all.mean)}.
${cal && cal.factor !== 1 ? `SimulationCraft has no positions, so every area spell reaches every add. The adds' exposure (count &times; alive time) is calibrated <b>&times;${cal.factor}</b> so that the sim matches the real players; the measured counts and alive times are listed with each wave above.` : 'No calibration was needed or possible here.'}</p>` : ''}
${shares && gap > 0.08 ? `<div class="callout"><b>Known gap.</b> Even after calibration, the sample characters put on average ${Math.round(gap * 100)} percentage points ${over ? 'more' : 'less'} of their damage into adds than real players of the same specs${cal && cal.factor <= 0.2 ? ' (the calibration is at its lowest allowed factor)' : ''}. Something in this fight that the profile cannot express, such as downtime the movement measurement misses, still differs. Treat results that depend on AoE ${over ? 'with some caution: they will look a little better than they are' : 'as slightly pessimistic'}.</div>` : ''}`;
}

function bossPage(b, diff, d) {
  const { A, E, C } = d;
  const other = DIFFS.map(x => load(b, x) ? `<a class="${x === diff ? 'on' : ''}" href="${b.slug}-${x}.html">${x[0].toUpperCase() + x.slice(1)}</a>` : '').join('');
  const adds = E.events.filter(e => e.kind === 'adds');
  const mv = r => E.events.filter(e => e.kind === 'move' && e.role === r && e.t <= E.maxTime).reduce((s, e) => s + e.duration, 0);
  const chips = [
    `<b>${A.sample}</b> kills measured`,
    `kill <b>${mmss(E.maxTime)}</b> (median of ${A.duration.populationSize})`,
    `<b>${E.bosses.length}</b> target${E.bosses.length > 1 ? 's' : ''}`,
    `<b>${adds.length}</b> add waves`,
    `melee move <b>${f1(mv('melee'))} s</b>`,
    `ranged move <b>${f1(mv('ranged'))} s</b>`,
  ];
  const kills = A.kills.slice().sort((x, y) => x.duration - y.duration);
  const body = `
<p class="eyebrow"><a href="../index.html#bosses">${esc(RAID.raid)}</a> &middot; boss ${BOSSES.indexOf(b) + 1} of ${BOSSES.length}</p>
<h1 style="margin-top:8px">${esc(b.name)}</h1>
<div class="diff-switch">${other}</div>
<div class="chips">${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>
${C.notes ? `<p class="lede" style="margin-top:12px">${C.notes}</p>` : ''}

<h2>The profile</h2>
<p>Paste this into Raidbots' <b>Script Footer</b> (SimC Expert Mode), with Fight Style <b>Casting Patchwerk</b> and 1 boss. <a href="../index.html#how">Step by step</a>.</p>
<div class="codebox"><div class="actions"><button class="btn" data-copy="simc">Copy</button><a class="btn" href="../profiles/${d.simcFile}" download>Download</a><a class="btn" href="../data/${b.id}_${diff}.json">Data</a></div><pre id="simc">${esc(d.simc)}</pre></div>
<p class="small muted">Your guild kills faster or slower? Change <code>max_time=${E.maxTime}</code> to your own kill length in seconds. Events after the end of the fight simply never happen. The 10th to 90th percentile of kill length here is ${Math.round(A.duration.p10)}-${Math.round(A.duration.p90)} s.</p>

<h2>Timeline</h2>
<div class="card">${timeline(d)}</div>

<h2>Every event in the profile</h2>
${eventRows(d)}
${impactTable(b, diff, A)}

<h2>Boss casts, measured</h2>
<p>The raw timeline these events were placed against: every boss ability seen in at least half the kills.</p>
${castRows(d)}

<h2>The kills behind it</h2>
<p>${A.sample} ${diff} kills on patch ${esc(RAID.patch)}, ${A.sampleNote || 'picked evenly across the Warcraft Logs speed ranking'}. Kill length over all ${A.duration.populationSize} ${esc(A.populationLabel || 'ranked guild kills')}: median ${f1(A.duration.population.med)} s, middle half ${f1(A.duration.population.p25)}-${f1(A.duration.population.p75)} s.${diff === 'heroic' ? ' Heroic uses random logs rather than the speed ranking because the ranking\'s top 1,000 heroic kills are mostly mythic guilds farming, which would make the fight look 25-40% shorter than it is for most raids.' : ''}</p>
<details><summary>Show the ${A.sample} reports</summary>
<div class="tablewrap"><table><thead><tr><th>Guild</th><th>Region</th><th class="num">Kill</th><th>Report</th></tr></thead><tbody>
${kills.map(k => `<tr><td>${esc(k.guild || '-')}</td><td>${esc(k.region || '')}</td><td class="num">${mmss(k.duration)}</td><td><a href="https://www.warcraftlogs.com/reports/${k.code}?fight=${k.fid}">${k.code}</a></td></tr>`).join('\n')}
</tbody></table></div></details>
`;
  return layout(`${b.name} (${diff[0].toUpperCase() + diff.slice(1)})`, body, { rel: '../', desc: `Measured SimulationCraft fight profile for ${b.name} on ${diff}, from ${A.sample} Warcraft Logs kills.` });
}

// ---------- compact fight strip: when there is something to hit, damage windows, adds, and who has to move.
// Drawn to the same time scale as the boss page's timeline.
function stripRows(d, X, y) {
  const { E } = d; const T = E.maxTime; const o = [];
  // target available = at least one simulated boss not away
  const gaps = []; const step = 0.5;
  for (let t = 0; t < T; t += step) {
    const allAway = E.bosses.every(b => E.events.some(e => e.kind === 'away' && e.name === b && e.t <= t && t < e.t + e.duration));
    const last = gaps[gaps.length - 1];
    if (allAway) { if (last && last[1] >= t - step / 2) last[1] = t + step; else gaps.push([t, t + step]); }
  }
  o.push(`<rect x="${X(0)}" y="${y + 9}" width="${X(T) - X(0)}" height="8" rx="2" fill="var(--accent)" opacity="0.75"/>`);
  for (const [a, b] of gaps) o.push(`<rect x="${X(a)}" y="${y + 8}" width="${Math.max(1, X(b) - X(a))}" height="10" fill="var(--surface)"/>`);
  for (const e of E.events.filter(e => e.kind === 'vuln' && e.t < T)) o.push(`<rect x="${X(e.t)}" y="${y + 9}" width="${Math.max(2, X(Math.min(T, e.t + e.duration)) - X(e.t))}" height="8" rx="1" fill="var(--lane-vuln)"/>`);
  for (const e of E.events.filter(e => e.kind === 'adds' && e.t < T)) o.push(`<rect x="${X(e.t)}" y="${y}" width="${Math.max(2, X(Math.min(T, e.t + e.duration)) - X(e.t))}" height="6" rx="1" fill="var(--lane-adds)"/>`);
  for (const e of E.events.filter(e => e.kind === 'move' && e.t < T)) o.push(`<rect x="${X(e.t)}" y="${y + (e.role === 'melee' ? 20 : 26)}" width="${Math.max(1.5, X(Math.min(T, e.t + e.duration)) - X(e.t))}" height="4" rx="1" fill="var(--lane-${e.role})"/>`);
  return o.join('');
}
function cardStrip(d) {
  const W = 320, X = t => W * t / d.E.maxTime;
  return `<svg class="strip" viewBox="0 0 ${W} 31" role="img" aria-label="Fight overview: targets, damage windows, adds and movement">${stripRows(d, X, 0)}</svg>`;
}
// the home page's thesis: Patchwerk against one measured fight, same clock
function versus(d, name) {
  const W = 1000, L = 150, T = d.E.maxTime, X = t => L + (W - L - 8) * t / T;
  const o = [`<svg class="strip" viewBox="0 0 ${W} 112" role="img" aria-label="Patchwerk compared with ${esc(name)}">`];
  o.push(`<text x="0" y="18" style="font:600 13px var(--font-body);fill:var(--ink)">Patchwerk</text>`);
  o.push(`<rect x="${X(0)}" y="9" width="${X(T) - X(0)}" height="8" rx="2" fill="var(--accent)" opacity="0.75"/>`);
  o.push(`<text x="0" y="56" style="font:600 13px var(--font-body);fill:var(--ink)">${esc(name)}</text>`);
  o.push(stripRows(d, X, 38));
  for (let t = 0; t <= T; t += 60) o.push(`<text x="${X(t)}" y="106" text-anchor="${t === 0 ? 'start' : 'middle'}" style="font:11px var(--font-mono);fill:var(--muted)">${mmss(t)}</text>`);
  o.push('</svg>');
  return o.join('');
}
const STRIP_KEY = `<div class="legend"><span><i style="background:var(--accent);opacity:.75"></i>a boss to hit</span><span><i style="background:var(--lane-vuln)"></i>boss takes extra damage</span><span><i style="background:var(--lane-adds)"></i>adds alive</span><span><i style="background:var(--lane-melee)"></i>melee moving</span><span><i style="background:var(--lane-ranged)"></i>ranged moving</span></div>`;

function index(all, opts = {}) {
  const cards = BOSSES.map((b, i) => {
    const m = all[b.id + '_mythic'], h = all[b.id + '_heroic'];
    const ref = m || h;
    const facts = ref ? `${ref.E.bosses.length} target${ref.E.bosses.length > 1 ? 's' : ''} &middot; ${ref.E.events.filter(e => e.kind === 'adds').length} add waves &middot; ${mmss(ref.E.maxTime)} mythic kill` : 'coming soon';
    return `<div class="boss-card"><div class="order">BOSS ${i + 1} OF ${BOSSES.length}</div><h3>${esc(b.name)}</h3>${ref ? cardStrip(ref) : ''}<div class="facts">${facts}</div><div class="links">
<a class="btn ${m ? 'primary' : 'off'}" href="bosses/${b.slug}-mythic.html">Mythic</a><a class="btn ${h ? '' : 'off'}" href="bosses/${b.slug}-heroic.html">Heroic</a></div></div>`;
  }).join('\n');
  const tf = all['3421_mythic'];
  const body = `
<div class="hero">
<p class="eyebrow">${esc(RAID.raid)} &middot; patch ${esc(RAID.patch)} &middot; ${Object.keys(all).length} profiles from ${Object.values(all).reduce((s, d) => s + d.A.sample, 0)} kills</p>
<h1>Sim the fight, not a target dummy.</h1>
<p class="lede">Raidbots' default fight is Patchwerk: one boss that never moves and never brings adds. These profiles replay every boss of ${esc(RAID.raid)} as it really goes: adds, intermissions, damage windows and movement, all measured from real kills on Warcraft Logs.</p>
${tf ? `<div class="versus"><div class="cap"><span>Same ${mmss(tf.E.maxTime)}, two fights</span><span>Mythic, median kill</span></div>${versus(tf, 'The Twin Fangs')}${STRIP_KEY}</div>` : ''}
</div>

<h2 id="bosses">Bosses</h2>
<div class="grid">${cards}</div>

<h2 id="how">How to use it on Raidbots</h2>
${HOWTO}
<div class="callout"><b>The one setting people miss:</b> Fight Style must be <b>Casting Patchwerk</b>. With plain Patchwerk, Raidbots strips every <code>raid_events</code> line and you are back to a target dummy without any warning.</div>
<p>It works the same in Top Gear, Droptimizer and Quick Sim, and with SimulationCraft on your own computer (add <code>fight_style=CastingPatchwerk</code> and the profile after your character).</p>

<h2>What a profile contains</h2>
<div class="tablewrap"><table><tbody>
<tr><td><span class="tag adds">adds</span></td><td class="wrap-ok">Each add wave: when it spawns, how many, and how long it actually stays alive (first hit to last hit, median over the kills).</td></tr>
<tr><td><span class="tag away">away</span></td><td class="wrap-ok">Windows where a boss is immune, leaves, or is out of reach: the time its damage taken falls under 35% of normal.</td></tr>
<tr><td><span class="tag vuln">+%</span></td><td class="wrap-ok">Damage-taken windows (for example a boss taking +30% for 25 seconds), timed from the aura in the logs, with the percentage from the spell's own data.</td></tr>
<tr><td><span class="tag melee">melee</span></td><td class="wrap-ok">Seconds melee spend out of range, measured from gaps in real melee players' auto-attacks. These only move melee in the sim.</td></tr>
<tr><td><span class="tag ranged">ranged</span></td><td class="wrap-ok">Seconds casters cannot hard-cast, measured from gaps in real casters' casting. These only move ranged in the sim.</td></tr>
</tbody></table></div>
<p class="small muted" style="margin-top:10px">More on how each number is measured, and what the profiles cannot do, on the <a href="methodology.html">methodology page</a>.</p>
`;
  return layout('Fight Sims', body, { fragment: opts.fragment, desc: `Measured SimulationCraft fight profiles for every boss of ${RAID.raid}, built from Warcraft Logs kills. Paste into Raidbots' SimC Expert Mode.` });
}

function methodology() {
  const body = fs.readFileSync(path.join(ROOT, 'tools', 'methodology.html'), 'utf8');
  return layout('Fight Sims methodology', body, { desc: 'How the fight profiles are measured from Warcraft Logs.' });
}

const all = {};
fs.mkdirSync(path.join(ROOT, 'docs', 'data'), { recursive: true });
for (const b of BOSSES) for (const diff of DIFFS) { const d = load(b, diff); if (d) { all[b.id + '_' + diff] = d; fs.copyFileSync(path.join(ROOT, 'data', `${b.id}_${diff}.json`), path.join(ROOT, 'docs', 'data', `${b.id}_${diff}.json`)); fs.writeFileSync(path.join(ROOT, 'docs', 'bosses', `${b.slug}-${diff}.html`), bossPage(b, diff, d)); } }
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), index(all));
// the claude.ai preview wraps its main page in its own skeleton: the same home page without one, beside docs/
fs.mkdirSync(path.join(ROOT, 'sims', 'preview'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'sims', 'preview', 'index.html'), index(all, { fragment: true }));
if (ex('tools/methodology.html')) fs.writeFileSync(path.join(ROOT, 'docs', 'methodology.html'), methodology());
fs.writeFileSync(path.join(ROOT, 'docs', '.nojekyll'), '');
console.log('built', Object.keys(all).length, 'boss pages');
