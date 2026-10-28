# Burn Wars ($BURN)

Four chains. One coin. Every chain's trading fees buy back and burn that chain's own supply. Which chain wins?

- `site/` is the live scoreboard. `site/data.json` is built by `scripts/build.js` from Pangea's public API and never committed.
- `coin.json` holds the coin's Pangea slug, contract address and X link.
- `.github/workflows/pages.yml` rebuilds the data and publishes the site about every 10 minutes.
