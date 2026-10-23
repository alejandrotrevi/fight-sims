# Fight Sims

Measured SimulationCraft fight profiles for every boss of **The Venomous Abyss** (patch 12.1.5), built from real
kills on Warcraft Logs. Paste one into Raidbots' **SimC Expert Mode > Script Footer** with Fight Style
**Casting Patchwerk**, and Top Gear, Droptimizer or Quick Sim sims the boss instead of a target dummy.

The site lives in [`docs/`](docs/) and is served by GitHub Pages. [Methodology](docs/methodology.html) explains how
every number is measured and what the profiles cannot do.

## Layout

| Path | What |
|---|---|
| `docs/` | The site: `index.html`, one page per boss and difficulty, `profiles/*.simc`, `data/*.json` |
| `data/` | Measured timings per boss and difficulty (`<encounter>_<difficulty>.json`) and the events each profile was built from (`.events.json`) |
| `config/` | `raid.json` (bosses, phases) and one file per boss for the few judgment calls (simulated targets, damage-taken multipliers from spell data, add scaling) |
| `tools/` | The pipeline |
| `sims/impact.json` | Patchwerk vs profile results for SimulationCraft's sample characters |
| `raw/` | Downloaded kills (git-ignored; about 90 MB) |

## Rebuilding

Needs Node 20+ and a Warcraft Logs API client (https://www.warcraftlogs.com/api/clients/):

```sh
export WCL_CLIENT_ID=... WCL_CLIENT_SECRET=...
node tools/rankings.js                      # speed rankings: kill lengths, mythic sample frame
node tools/population.js 4 12 2026-10-14T00:00:00Z   # heroic: random public reports instead of the ranking
node tools/collect.js mythic 30             # 30 kills per boss: casts, auras, deaths, add damage, boss damage graph
node tools/collect.js heroic 30
node tools/collect2.js                      # player auto-attacks and casts, for the movement measurements
for b in 3470 3445 3455 3497 3420 3421 3429 3492; do for d in mythic heroic; do
  node tools/analyze.js $b $d && node tools/profile.js $b $d
done; done
SIMC=/path/to/simc node tools/impact.js     # check every profile in SimulationCraft
node tools/build-site.js
```

The collectors pause on their own when the hourly API allowance (3,600 points) runs low. A full pull takes about
9,000 points.
