// Warcraft Logs v2 GraphQL client. Credentials never live in the repository:
//   WCL_CLIENT_ID + WCL_CLIENT_SECRET (an API client from https://www.warcraftlogs.com/api/clients/), or
//   WCL_TOKEN (a bearer token), or tools/token.txt (git-ignored).
const fs = require('fs');
const path = require('path');
let TOKEN = process.env.WCL_TOKEN || (fs.existsSync(path.join(__dirname, 'token.txt')) ? fs.readFileSync(path.join(__dirname, 'token.txt'), 'utf8').trim() : null);
async function token() {
  if (TOKEN) return TOKEN;
  const { WCL_CLIENT_ID: id, WCL_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('Set WCL_CLIENT_ID and WCL_CLIENT_SECRET (or WCL_TOKEN)');
  const r = await fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`token request failed: ${r.status}`);
  TOKEN = (await r.json()).access_token;
  return TOKEN;
}
async function q(query, variables = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch('https://www.warcraftlogs.com/api/v2/client', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 5000 * (attempt + 1))); continue; }
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
  }
  throw new Error('Warcraft Logs request failed after retries');
}
async function rate() { return (await q('{ rateLimitData { pointsSpentThisHour pointsResetIn } }')).rateLimitData; }
// Call before each request in a long run: sleeps until the hourly allowance resets when it runs low.
let calls = 0;
async function guard(limit = 3000) {
  if (++calls % 15) return;
  const r = await rate();
  if (r.pointsSpentThisHour > limit) { console.log(`rate: ${r.pointsSpentThisHour} spent, sleeping ${r.pointsResetIn}s`); await new Promise(s => setTimeout(s, (r.pointsResetIn + 10) * 1000)); }
}
module.exports = { q, rate, guard };
