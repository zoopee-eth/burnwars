// Burn Wars scoreboard data. Runs on GitHub Actions about every 10 minutes (no keys, no wallet).
// Reads Pangea's public API for $BURN: per-chain burns (the coin's vault buys and burns on each chain from
// that chain's own fees), price, 24h volume, holders. Compares with the last published data.json to log
// burn events, keeps a burn history for the chart, and tracks today's burns per chain for the daily winner.
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, '..', 'site');
const PANGEA = 'https://www.pangea.trade';
const CHAINS = ['solana', 'base', 'bsc', 'robinhood'];
const coin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'coin.json'), 'utf8'));

async function getJson(url, ms = 30_000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json', 'user-agent': 'burnwars-scoreboard/1.0' } }); if (!r.ok) throw new Error(`${url.split('?')[0]} HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
const dayKey = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'UTC' });   // the war day runs on UTC

async function main() {
  let prev = null; try { prev = JSON.parse(fs.readFileSync(path.join(OUT, 'data.json'), 'utf8')); } catch {}
  const now = Date.now();
  // the coin can be named by its Pangea slug or by any of its token addresses
  if (!coin.slug && coin.ca) {
    const pl = await getJson(`${PANGEA}/api/pools`).catch(() => null);
    const hit = pl && (pl.launches || []).find(x => (x.pools || []).some(p => String(p.token).toLowerCase() === String(coin.ca).toLowerCase()));
    if (hit) coin.slug = hit.slug;
  }
  if (!coin.slug) { fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({ at: now, prelaunch: true, ca: coin.ca || null, x: coin.x || null })); console.log('no coin yet: pre-launch data'); return; }
  const [pools, hist, holders] = await Promise.all([
    getJson(`${PANGEA}/api/pools`),
    getJson(`${PANGEA}/api/history?hours=24&launch=${encodeURIComponent(coin.slug)}`).catch(() => null),
    getJson(`${PANGEA}/api/holders?token=${encodeURIComponent(coin.slug)}`).catch(() => null),
  ]);
  const l = (pools.launches || []).find(x => x.slug === coin.slug);
  if (!l) throw new Error('coin not found in /api/pools: ' + coin.slug);
  const h = hist && ((hist.launches && hist.launches[0]) || hist);
  const volBy = new Map(((h && h.chains) || []).map(c => [c.chain, c]));
  const holdBy = new Map(((holders && holders.chains) || []).map(c => [c.chain, c]));
  const perChain = (l.supply && l.supply.perChain) || {};
  const prevBy = new Map(((prev && prev.chains) || []).map(c => [c.chain, c]));
  const day = dayKey(now), sameDay = prev && prev.day === day;
  const dayStart = sameDay && prev.dayStart ? prev.dayStart : Object.fromEntries(((prev && prev.chains) || []).map(c => [c.chain, c.burned]));
  const events = (prev && prev.events) || [];

  const chains = CHAINS.filter(c => (l.launchChains || CHAINS).includes(c) || (l.pools || []).some(p => p.chain === c)).map(c => {
    const p = (l.pools || []).find(x => x.chain === c) || {};
    const supply = Number(perChain[c]) || 1e9;
    const burned = Number((l.burntPerChain || {})[c]) || 0;
    const v = volBy.get(c) || {}, hd = holdBy.get(c) || {};
    const before = prevBy.get(c);
    if (before && burned > before.burned + 1) events.push({ at: now, chain: c, amount: Math.round(burned - before.burned), usd: p.priceUsd ? +((burned - before.burned) * p.priceUsd).toFixed(2) : null });
    const today = Math.max(0, burned - (dayStart[c] ?? burned));
    return { chain: c, burned: Math.round(burned), burnedPct: +(burned / supply * 100).toFixed(4), today: Math.round(today), todayPct: +(today / supply * 100).toFixed(4),
      priceUsd: p.priceUsd || null, mcapUsd: p.priceUsd ? Math.round(p.priceUsd * (supply - burned)) : null, liqUsd: p.reservesUsd != null ? Math.round(p.reservesUsd) : null,
      vol24: Math.round(v.volumeUsd || 0), trades24: v.trades || 0, holders: hd.count ?? null, token: p.token || null, error: p.error || null };
  });
  if (!sameDay) for (const c of chains) dayStart[c.chain] = dayStart[c.chain] ?? c.burned;
  chains.sort((a, b) => b.burnedPct - a.burnedPct || b.vol24 - a.vol24);
  chains.forEach((c, i) => { c.rank = i + 1; });
  const leaderToday = chains.slice().sort((a, b) => b.todayPct - a.todayPct)[0];
  // yesterday's winner is kept when the day rolls over
  const winners = (prev && prev.winners) || [];
  if (prev && prev.day && prev.day !== day && prev.leaderToday) winners.unshift({ day: prev.day, chain: prev.leaderToday.chain, todayPct: prev.leaderToday.todayPct });
  const series = ((prev && prev.series) || []).concat([{ at: now, b: Object.fromEntries(chains.map(c => [c.chain, c.burnedPct])) }]).slice(-600);
  const totalBurned = chains.reduce((a, c) => a + c.burned, 0);
  const data = { at: now, ca: coin.ca || null, x: coin.x || null, slug: coin.slug, symbol: l.symbol, name: l.name, day, dayStart, chains, leader: chains[0] ? chains[0].chain : null,
    leaderToday: leaderToday && leaderToday.todayPct > 0 ? { chain: leaderToday.chain, todayPct: leaderToday.todayPct } : null,
    totalBurned, vol24: chains.reduce((a, c) => a + c.vol24, 0), holders: holders && holders.all ? holders.all.count : null,
    events: events.slice(-80), winners: winners.slice(0, 30), series };
  fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(data));
  console.log(`${l.symbol}: ${chains.map(c => `${c.chain} ${c.burnedPct}%`).join(' · ')} · ${events.length} burn events`);
}
main().catch(e => { console.error(e); process.exit(1); });
