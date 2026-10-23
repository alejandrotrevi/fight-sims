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
const cap = s => s[0].toUpperCase() + s.slice(1);

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

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23111213'/%3E%3Crect x='7' y='9' width='18' height='3' rx='1' fill='%23e4e4e1'/%3E%3Crect x='7' y='15' width='11' height='3' rx='1' fill='%23cf9f55'/%3E%3Crect x='7' y='21' width='15' height='3' rx='1' fill='%237c9fe0'/%3E%3C/svg%3E";
const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap';

// fragment: the page without its document skeleton, for the claude.ai preview, which wraps the main page itself
function layout(title, body, { rel = '', desc = '', fragment = false, current = null } = {}) {
  const head = `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${rel}assets/style.css">
<link rel="icon" href="${FAVICON}">`;
  const nav = (key, href, label) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `${fragment ? head : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>`}
<header class="site"><div class="wrap">
  <a class="brand" href="${rel}index.html">Fight Sims</a>
  <nav>${nav('bosses', `${rel}index.html#bosses`, 'Bosses')}${nav('how', `${rel}index.html#how`, 'How to use')}${nav('method', `${rel}methodology.html`, 'Methodology')}${nav('github', RAID.repo, 'GitHub')}</nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="site"><div class="wrap"><p>${esc(RAID.raid)}, patch ${esc(RAID.patch)}. Data pulled ${esc(RAID.pulled)}, site built ${built}. Timings are measured from public <a href="https://www.warcraftlogs.com">Warcraft Logs</a> reports, and every report used is listed on its boss page. Not affiliated with Blizzard, Raidbots, SimulationCraft or Warcraft Logs.</p></div></footer>
<script>
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    var pre = document.getElementById(b.getAttribute('data-copy'));
    var done = function (msg) { b.textContent = msg; setTimeout(function () { b.textContent = 'Copy'; }, 1800); };
    var select = function () { var r = document.createRange(); r.selectNodeContents(pre); var s = getSelection(); s.removeAllRanges(); s.addRange(r); done('Press Ctrl+C'); };
    try { navigator.clipboard.writeText(pre.textContent).then(function () { done('Copied'); }, select); } catch (e) { select(); }
  });
});
</script>
${fragment ? '' : '</body>\n</html>\n'}`;
}

const HOWTO = `<ol class="read">
  <li>On <a href="https://www.raidbots.com">Raidbots</a>, open Top Gear, Droptimizer or Quick Sim and paste your <code>/simc</code> string as usual.</li>
  <li>In Simulation Options, set Fight Style to <b>Casting Patchwerk</b>. Plain Patchwerk deletes every raid event, so the fight would quietly turn back into a target dummy.</li>
  <li>Set Number of Bosses to 1. The profile creates the bosses itself and sets the fight length.</li>
  <li>Under Custom APL and SimC Options, tick <b>SimC Expert Mode</b> and paste the profile into the <b>Script Footer</b> box. The normal custom options box does not accept raid events.</li>
  <li>Run the sim. In the report, Raid Events should list the boss's adds and movement.</li>
</ol>`;

// ---------- timeline: lanes in the boss-mod colours, to one time scale
function timeline(d) {
  const { A, E } = d;
  const T = Math.max(E.maxTime, ...E.events.map(e => e.t + (e.duration || 0)));
  const W = 1000, L = 128, R = 8, X = t => L + (W - L - R) * Math.min(t, T) / T;
  const lanes = [];
  const segs = A.segments.filter(s => s.start && s.start.med < T);
  if (segs.length > 1) lanes.push({ key: 'phase', label: 'Phases', h: 20 });
  for (const b of E.bosses) lanes.push({ key: 'boss:' + b, label: b, h: 14 });
  if (E.events.some(e => e.kind === 'adds')) lanes.push({ key: 'adds', label: 'Adds', h: 14 });
  lanes.push({ key: 'melee', label: 'Melee moving', h: 26 });
  lanes.push({ key: 'ranged', label: 'Ranged moving', h: 26 });
  let y = 6; for (const l of lanes) { l.y = y; y += l.h + 10; }
  const H = y + 18;
  const o = [`<svg class="tl" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fight timeline">`];
  for (const l of lanes) o.push(`<text class="lab" x="0" y="${l.y + l.h / 2 + 4}">${esc(l.label.length > 19 ? l.label.slice(0, 18) + '…' : l.label)}</text>`);
  const step = T > 400 ? 60 : 30;
  for (let t = 0; t <= T; t += step) o.push(`<line x1="${X(t)}" x2="${X(t)}" y1="2" y2="${H - 16}" stroke="var(--line)"/><text x="${X(t)}" y="${H - 3}" text-anchor="${t === 0 ? 'start' : 'middle'}">${mmss(t)}</text>`);
  o.push(`<line x1="${X(E.maxTime)}" x2="${X(E.maxTime)}" y1="2" y2="${H - 16}" stroke="var(--muted)" stroke-dasharray="3 3"><title>Simulated kill length ${E.maxTime} s</title></line>`);
  const lane = k => lanes.find(l => l.key === k);
  const P = lane('phase');
  if (P) segs.forEach((s, i) => {
    const a = s.start.med, b = segs[i + 1] ? segs[i + 1].start.med : T;
    const name = d.phaseNames[s.phase] || `Phase ${s.phase}`;
    o.push(`<rect x="${X(a)}" y="${P.y}" width="${Math.max(1, X(b) - X(a) - 2)}" height="${P.h}" rx="2" fill="var(--phase)"><title>${esc(name)}: starts ${f1(a)} s (middle half of kills ${f1(s.start.p25)}-${f1(s.start.p75)} s)</title></rect>`);
    if (X(b) - X(a) > 70) o.push(`<text x="${X(a) + 6}" y="${P.y + 14}">${esc(name.length > 30 ? name.slice(0, 29) + '…' : name)}</text>`);
  });
  for (const b of E.bosses) {
    const l = lane('boss:' + b);
    o.push(`<rect x="${X(0)}" y="${l.y + 3}" width="${X(T) - X(0)}" height="${l.h - 6}" rx="2" fill="var(--target)" opacity="0.55"/>`);
    for (const e of E.events.filter(e => e.kind === 'away' && e.name === b)) o.push(`<rect x="${X(e.t)}" y="${l.y + 1}" width="${Math.max(1, X(e.t + e.duration) - X(e.t))}" height="${l.h - 2}" fill="var(--bg)"><title>${esc(b)} out of reach ${f1(e.t)}-${f1(e.t + e.duration)} s</title></rect>`);
    for (const e of E.events.filter(e => e.kind === 'vuln' && e.name === b)) o.push(`<rect x="${X(e.t)}" y="${l.y + 3}" width="${Math.max(2, X(e.t + e.duration) - X(e.t))}" height="${l.h - 6}" rx="1" fill="var(--vuln)"><title>${esc(e.aura)}: +${Math.round(e.mult * 100)}% damage taken, ${f1(e.t)}-${f1(e.t + e.duration)} s</title></rect>`);
  }
  const AL = lane('adds');
  if (AL) for (const e of E.events.filter(e => e.kind === 'adds')) o.push(`<rect x="${X(e.t)}" y="${AL.y + 3}" width="${Math.max(2, X(e.t + e.duration) - X(e.t))}" height="${AL.h - 6}" rx="1" fill="var(--adds)"><title>${esc(e.name)} x${e.count}: ${f1(e.t)} s, alive ${f1(e.duration)} s</title></rect>`);
  // movement: the measured share of the role forced off the boss (averaged over the kills), and the simulated events
  for (const role of ['melee', 'ranged']) {
    const l = lane(role); const pts = [];
    A.downtime.forEach(dseg => {
      const s0 = A.segments[dseg.seg] && A.segments[dseg.seg].start ? A.segments[dseg.seg].start.med : null; if (s0 === null) return;
      const c = dseg[role].curve, base = dseg[role].baseline;
      c.forEach((v, i) => { const t = s0 + i * 0.5; if (v === null || t > T) return; pts.push([t, Math.max(0, (v - base) / (1 - base))]); });
    });
    pts.sort((a, b) => a[0] - b[0]);
    if (pts.length) {
      const sm = pts.map((p, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(pts.length - 1, i + 2); j++) { s += pts[j][1]; n++; } return [p[0], s / n]; });
      const dd = sm.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${(l.y + l.h - Math.min(1, v) * l.h).toFixed(1)}`).join('');
      o.push(`<path d="${dd}L${X(sm[sm.length - 1][0]).toFixed(1)},${l.y + l.h}L${X(sm[0][0]).toFixed(1)},${l.y + l.h}Z" fill="var(--${role})" opacity="0.16"/>`);
    }
    for (const e of E.events.filter(e => e.kind === 'move' && e.role === role)) o.push(`<rect x="${X(e.t)}" y="${l.y + l.h - 6}" width="${Math.max(2, X(e.t + e.duration) - X(e.t))}" height="6" rx="1" fill="var(--${role})"><title>${esc(e.label)}: ${role} move ${f1(e.duration)} s at ${f1(e.t)} s</title></rect>`);
    o.push(`<line x1="${X(0)}" x2="${X(T)}" y1="${l.y + l.h}" y2="${l.y + l.h}" stroke="var(--line)"/>`);
  }
  o.push('</svg>');
  return `<div class="chart">${o.join('')}</div>`;
}
const KEY = `<div class="key"><span><i style="background:var(--target);opacity:.55"></i>boss to hit</span><span><i style="background:var(--vuln)"></i>boss takes extra damage</span><span><i style="background:var(--adds)"></i>adds alive</span><span><i style="background:var(--melee)"></i>melee moving</span><span><i style="background:var(--ranged)"></i>ranged moving</span></div>`;

// ---------- compact strip for the boss list: when there is a boss to hit, damage windows, adds, and who moves
function strip(d) {
  const { E } = d; const T = E.maxTime, W = 300, X = t => W * Math.min(t, T) / T; const o = [];
  const gaps = []; const step = 0.5;
  for (let t = 0; t < T; t += step) {
    const allAway = E.bosses.every(b => E.events.some(e => e.kind === 'away' && e.name === b && e.t <= t && t < e.t + e.duration));
    const last = gaps[gaps.length - 1];
    if (allAway) { if (last && last[1] >= t - step / 2) last[1] = t + step; else gaps.push([t, t + step]); }
  }
  o.push(`<rect x="0" y="8" width="${W}" height="6" rx="1" fill="var(--target)" opacity="0.55"/>`);
  for (const [a, b] of gaps) o.push(`<rect x="${X(a)}" y="7" width="${Math.max(1, X(b) - X(a))}" height="8" fill="var(--bg)"/>`);
  for (const e of E.events.filter(e => e.kind === 'vuln' && e.t < T)) o.push(`<rect x="${X(e.t)}" y="8" width="${Math.max(2, X(e.t + e.duration) - X(e.t))}" height="6" fill="var(--vuln)"/>`);
  for (const e of E.events.filter(e => e.kind === 'adds' && e.t < T)) o.push(`<rect x="${X(e.t)}" y="1" width="${Math.max(2, X(e.t + e.duration) - X(e.t))}" height="4" rx="1" fill="var(--adds)"/>`);
  for (const e of E.events.filter(e => e.kind === 'move' && e.t < T)) o.push(`<rect x="${X(e.t)}" y="${e.role === 'melee' ? 17 : 22}" width="${Math.max(1.5, X(e.t + e.duration) - X(e.t))}" height="3" fill="var(--${e.role})"/>`);
  return `<svg class="strip" viewBox="0 0 ${W} 25" role="img" aria-label="Fight overview">${o.join('')}</svg>`;
}

// ---------- tables
function eventRows(d) {
  const { A, E } = d;
  const rows = E.events.filter(e => e.t <= E.maxTime * 1.06).map(e => {
    if (e.kind === 'adds') return [e.t, 'adds', 'Adds', `${esc(e.name)} &times;${e.count}`, `alive ${f1(e.duration)} s`,
      `${e.kills} of ${A.sample} kills, spawn &plusmn;${e.spread} s, ${e.share == null ? 'timed from its damage graph' : `${(e.share * 100).toFixed(1)}% of raid damage`}` +
      (e.calib ? `. Measured &times;${e.uncalibrated.count} for ${f1(e.uncalibrated.duration)} s, calibrated &times;${e.calib}` : '') + (e.mainTarget ? '. The only target while the bosses are gone, so kept at its measured size' : '') +
      (e.scale && e.scale !== 1 ? `. Alive ${f1(e.measuredLife)} s measured, counted &times;${e.scale}` : '') + (e.countScale && e.countScale !== 1 ? `. ${f1(e.measuredCount)} spawn, counted &times;${e.countScale}` : '') + (e.why ? ` (${esc(e.why)})` : '')];
    if (e.kind === 'away') return [e.t, 'away', 'Away', `${esc(e.name)} ${e.outside ? 'not a target' : 'out of reach'}`, `${f1(e.duration)} s`,
      e.outside ? 'Only a target in its measured windows' : e.presence !== undefined ? `Absent this phase${e.partial ? ' outside the window it comes back for' : ''} (present ${Math.round(e.presence * 100)}% of it on average)` : `${e.kills} of ${A.sample} kills, damage on it falls to ${Math.round(e.depth * 100)}%`];
    if (e.kind === 'vuln') return [e.t, 'vuln', `+${Math.round(e.mult * 100)}%`, `${esc(e.aura)} on ${esc(e.name)}`, `${f1(e.duration)} s`, `${e.kills} of ${A.sample} kills, aura start &plusmn;${e.spread} s${e.measured ? `. Multiplier ${esc(e.measured)}` : ''}`];
    return [e.t, e.role, cap(e.role), esc(e.label), `${f1(e.duration)} s`, `Window ${f1(e.window[0])}-${f1(e.window[1])} s, up to ${Math.round(e.peak * 100)}% of ${e.role}, 90% range ${e.lostCI ? e.lostCI.map(f1).join('-') + ' s' : 'n/a'}`];
  });
  return `<div class="tablewrap"><table><thead><tr><th class="num">Time</th><th>Type</th><th>What</th><th>Length</th><th>Evidence</th></tr></thead><tbody>
${rows.map(r => `<tr><td class="num">${f1(r[0])} s</td><td><span class="kind ${r[1]}">${r[2]}</span></td><td class="first">${r[3]}</td><td class="num">${r[4]}</td><td class="why">${r[5]}</td></tr>`).join('\n')}
</tbody></table></div>`;
}

function castRows(d) {
  const { A } = d;
  const bossNames = new Set(d.E.bosses.concat(A.bossAway.map(b => b.boss)));
  const cs = A.casts.filter(c => bossNames.has(c.caster) && c.perKill.med <= 20 && c.occurrences.length);
  return `<div class="tablewrap"><table><thead><tr><th>Ability</th><th>Caster</th><th class="num">Per kill</th><th>Casts, median seconds from the pull (&plusmn; half the middle 50%)</th></tr></thead><tbody>
${cs.map(c => `<tr><td class="first">${esc(c.ability)} <span class="muted">${c.abilityId}</span></td><td>${esc(c.caster)}</td><td class="num">${c.perKill.med}</td><td class="why">${c.occurrences.slice(0, 14).map(o => `${f1(o.t.med)}${o.t.p75 - o.t.p25 > 0.3 ? ` &plusmn;${f1((o.t.p75 - o.t.p25) / 2)}` : ''}`).join(', ')}${c.occurrences.length > 14 ? ', …' : ''}</td></tr>`).join('\n')}
</tbody></table></div>`;
}

function impactTable(b, diff, A) {
  const r = IMPACT[`${b.id}_${diff}`]; if (!r) return '';
  const cal = CALIB[`${b.id}_${diff}`];
  const shares = A.addShare && A.addShare.all && (A.addShare.all.mean > 0.005 || r.some(x => x.simAddShare > 0.005));
  const pct = x => `${Math.round(x * 100)}%`;
  // average gap between sim and real add share over the characters with enough real players
  const comp = r.filter(x => x.realAddShare !== null && x.realPlayers >= 8);
  const sum = comp.reduce((s, x) => s + x.simAddShare - x.realAddShare, 0);
  const gap = comp.length ? Math.abs(sum / comp.length) : 0;
  const real = x => x.realAddShare !== null && x.realPlayers >= 3 ? `${pct(x.realAddShare)} <span class="muted">(${x.realPlayers})</span>` : '<span class="muted">too few</span>';
  return `<h2>What it does to a sim</h2>
<p class="read">SimulationCraft's own sample characters, on Casting Patchwerk at the same kill length, with and without this profile. Your gear changes the absolute numbers, not the direction.</p>
<div class="tablewrap"><table><thead><tr><th>Character</th><th class="num">Patchwerk</th><th class="num">This fight</th><th class="num">Change</th>${shares ? '<th class="num">Into adds, sim</th><th class="num">Into adds, real players</th>' : ''}</tr></thead><tbody>
${r.map(x => `<tr><td class="first">${esc(x.label)}</td><td class="num">${(x.base / 1000).toFixed(1)}K</td><td class="num">${(x.fight / 1000).toFixed(1)}K</td><td class="num ${x.fight >= x.base ? 'up' : 'down'}">${x.fight >= x.base ? '+' : '−'}${Math.abs((x.fight / x.base - 1) * 100).toFixed(1)}%</td>${shares ? `<td class="num">${pct(x.simAddShare)}</td><td class="num">${real(x)}</td>` : ''}</tr>`).join('\n')}
</tbody></table></div>
${shares ? `<p class="small muted read" style="margin-top:10px">Into adds: the share of damage that went into adds rather than the bosses, in the sim and for the average real player of the same spec in these ${A.addShare.kills} kills (the number of players in brackets). ${cal && cal.factor !== 1 ? `SimulationCraft has no positions, so every area spell reaches every add; the adds' exposure is calibrated &times;${cal.factor} so the sim matches real players.` : ''}</p>` : ''}
${shares && gap > 0.08 ? `<p class="note"><b>Known gap.</b> After calibration the sample characters still put ${Math.round(gap * 100)} percentage points ${sum > 0 ? 'more' : 'less'} of their damage into adds than real players of the same specs. Something in this fight the profile cannot express, such as downtime the movement measurement misses, still differs, so AoE-heavy results ${sum > 0 ? 'will look a little better than they are' : 'are slightly pessimistic'}.</p>` : ''}`;
}

function bossPage(b, diff, d) {
  const { A, E, C } = d;
  const other = DIFFS.filter(x => load(b, x)).map(x => `<a href="${b.slug}-${x}.html"${x === diff ? ' aria-current="page"' : ''}>${cap(x)}</a>`).join('');
  const adds = E.events.filter(e => e.kind === 'adds');
  const mv = r => E.events.filter(e => e.kind === 'move' && e.role === r && e.t <= E.maxTime).reduce((s, e) => s + e.duration, 0);
  const kills = A.kills.slice().sort((x, y) => x.duration - y.duration);
  const nEvents = E.events.filter(e => e.t <= E.maxTime * 1.06).length;
  const body = `
<p class="crumb"><a href="../index.html#bosses">${esc(RAID.raid)}</a> / boss ${BOSSES.indexOf(b) + 1} of ${BOSSES.length}</p>
<h1>${esc(b.name)}</h1>
<nav class="diff" aria-label="Difficulty">${other}</nav>
${C.notes ? `<p class="intro">${C.notes}</p>` : ''}
<ul class="facts">
  <li>Kill length <b>${mmss(E.maxTime)}</b></li>
  <li><b>${E.bosses.length}</b> target${E.bosses.length > 1 ? 's' : ''}</li>
  <li><b>${adds.length}</b> add waves</li>
  <li>Melee move <b>${f1(mv('melee'))} s</b></li>
  <li>Ranged move <b>${f1(mv('ranged'))} s</b></li>
  <li>From <b>${A.sample}</b> kills</li>
</ul>

<h2>Profile</h2>
<p class="read">Paste it into Raidbots' Script Footer (SimC Expert Mode) with Fight Style Casting Patchwerk and 1 boss. <a href="../index.html#how">Step by step</a>.</p>
<div class="tools"><button class="link" type="button" data-copy="simc">Copy</button><a href="../profiles/${d.simcFile}" download>Download .simc</a><a href="../data/${b.id}_${diff}.json">Measured data (JSON)</a><span class="hint">To match your kill, change <code>max_time=${E.maxTime}</code></span></div>
<pre class="profile" id="simc">${esc(d.simc)}</pre>
<p class="small muted read" style="margin-top:10px">Kill length is the median of ${A.duration.populationSize} ${esc(A.populationLabel || 'ranked guild kills')}; 10th to 90th percentile ${Math.round(A.duration.p10)}-${Math.round(A.duration.p90)} s. Events after the end of your fight never happen.</p>

<h2>Timeline</h2>
${timeline(d)}
${KEY}
<p class="small muted read" style="margin-top:12px">The profile works for any character. Melee movement only moves melee characters and ranged movement only ranged ones, so a Havoc sim feels the melee lane and a mage the ranged one. The shaded area is the share of real players of that role who were forced off the boss, averaged over the kills; the bars are what the sim does with it. The dashed line is the kill length.</p>
${impactTable(b, diff, A)}

<h2>Evidence</h2>
<details><summary>Every event in the profile (${nEvents})</summary>${eventRows(d)}</details>
<details><summary>Boss casts, measured</summary><p class="small muted read">Every boss ability seen in at least half the kills. These place and label the events; they are not simulated themselves.</p>${castRows(d)}</details>
<details><summary>The ${A.sample} kills behind it</summary>
<p class="small muted read">${A.sample} ${diff} kills on patch ${esc(RAID.patch)}, ${A.sampleNote || 'picked evenly across the Warcraft Logs speed ranking'}. Kill length over all ${A.duration.populationSize} ${esc(A.populationLabel || 'ranked guild kills')}: median ${f1(A.duration.population.med)} s, middle half ${f1(A.duration.population.p25)}-${f1(A.duration.population.p75)} s.${diff === 'heroic' ? ' Heroic uses random logs rather than the speed ranking, because the ranking\'s top 1,000 heroic kills are mostly mythic guilds and would make the fight look 25-40% shorter than it is for most raids.' : ''}</p>
<div class="tablewrap"><table><thead><tr><th>Guild</th><th>Region</th><th class="num">Kill</th><th>Report</th></tr></thead><tbody>
${kills.map(k => `<tr><td class="first">${esc(k.guild || 'No guild')}</td><td>${esc(k.region || '')}</td><td class="num">${mmss(k.duration)}</td><td><a href="https://www.warcraftlogs.com/reports/${k.code}?fight=${k.fid}">${k.code}</a></td></tr>`).join('\n')}
</tbody></table></div></details>
`;
  return layout(`${b.name} (${cap(diff)})`, body, { rel: '../', current: 'bosses', desc: `Measured SimulationCraft fight profile for ${b.name} on ${diff}, from ${A.sample} Warcraft Logs kills.` });
}

function index(all, opts = {}) {
  const rows = BOSSES.map((b, i) => {
    const m = all[b.id + '_mythic'], h = all[b.id + '_heroic'];
    const ref = m || h;
    const meta = ref ? `${ref.E.bosses.length} target${ref.E.bosses.length > 1 ? 's' : ''}, ${ref.E.events.filter(e => e.kind === 'adds').length} add waves, ${mmss(ref.E.maxTime)} mythic kill` : 'coming soon';
    return `<li><span class="n">${i + 1}</span><span><span class="name">${esc(b.name)}</span><span class="meta">${meta}</span></span><span class="strip-cell">${ref ? strip(ref) : ''}</span><span class="go">${m ? `<a href="bosses/${b.slug}-mythic.html">Mythic</a>` : ''}${h ? `<a href="bosses/${b.slug}-heroic.html">Heroic</a>` : ''}</span></li>`;
  }).join('\n');
  const nKills = Object.values(all).reduce((s, d) => s + d.A.sample, 0);
  const body = `
<h1>Fight profiles for Raidbots</h1>
<p class="intro">Raidbots sims a target dummy by default: one boss that never moves and never brings adds. These profiles replay each boss of ${esc(RAID.raid)} the way it really goes, with its adds, intermissions, damage windows and movement. Every timing is measured from real kills on Warcraft Logs: ${Object.keys(all).length} profiles from ${nKills} kills on patch ${esc(RAID.patch)}.</p>

<h2 id="bosses">Bosses</h2>
<ol class="bosses">
${rows}
</ol>
${KEY}

<h2 id="how">How to use it on Raidbots</h2>
${HOWTO}
<p class="note"><b>Fight Style must be Casting Patchwerk.</b> With plain Patchwerk, Raidbots removes every raid event without a warning and you are back to a target dummy.</p>
<p class="read">It works the same in Top Gear, Droptimizer and Quick Sim. With SimulationCraft on your own computer, add <code>fight_style=CastingPatchwerk</code> and put the profile after your character.</p>

<h2>What a profile contains</h2>
<div class="tablewrap"><table><tbody>
<tr><td><span class="kind adds">Adds</span></td><td>Each wave: when it spawns, how many, and how long it stays alive in real kills.</td></tr>
<tr><td><span class="kind away">Away</span></td><td>Time a boss is immune, gone or out of reach.</td></tr>
<tr><td><span class="kind vuln">+%</span></td><td>Windows where a boss takes extra damage, timed from the logs and checked against real hits.</td></tr>
<tr><td><span class="kind melee">Melee</span></td><td>Time melee spend out of range, from gaps in real melee players' auto-attacks. Only moves melee characters.</td></tr>
<tr><td><span class="kind ranged">Ranged</span></td><td>Time casters cannot hard-cast, from gaps in real casters' casting. Only moves ranged characters.</td></tr>
</tbody></table></div>
<p class="read" style="margin-top:14px">How each number is measured, how it was checked, and what the profiles cannot do: <a href="methodology.html">methodology</a>.</p>
`;
  return layout('Fight Sims', body, { fragment: opts.fragment, desc: `Measured SimulationCraft fight profiles for every boss of ${RAID.raid}, built from Warcraft Logs kills. Paste into Raidbots' SimC Expert Mode.` });
}

function methodology() {
  const body = `<article class="read">${fs.readFileSync(path.join(ROOT, 'tools', 'methodology.html'), 'utf8')}</article>`;
  return layout('Fight Sims methodology', body, { current: 'method', desc: 'How the fight profiles are measured from Warcraft Logs.' });
}

const all = {};
fs.mkdirSync(path.join(ROOT, 'docs', 'data'), { recursive: true });
for (const b of BOSSES) for (const diff of DIFFS) {
  const d = load(b, diff); if (!d) continue;
  all[b.id + '_' + diff] = d;
  fs.copyFileSync(path.join(ROOT, 'data', `${b.id}_${diff}.json`), path.join(ROOT, 'docs', 'data', `${b.id}_${diff}.json`));
  fs.writeFileSync(path.join(ROOT, 'docs', 'bosses', `${b.slug}-${diff}.html`), bossPage(b, diff, d));
}
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), index(all));
// the claude.ai preview wraps its main page in its own skeleton: the same home page without one
fs.mkdirSync(path.join(ROOT, 'sims', 'preview'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'sims', 'preview', 'index.html'), index(all, { fragment: true }));
if (ex('tools/methodology.html')) fs.writeFileSync(path.join(ROOT, 'docs', 'methodology.html'), methodology());
fs.writeFileSync(path.join(ROOT, 'docs', '.nojekyll'), '');
console.log('built', Object.keys(all).length, 'boss pages');
