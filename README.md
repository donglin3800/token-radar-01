# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/donglin3800/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/donglin3800/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar: a web dashboard that ranks pre-token crypto protocols by what their launch would be worth, and shows exactly how to farm each one. It reads a sealed snapshot of DefiLlama protocol data (758 protocols, snapshot 2026-11-14), scores every protocol that records no token and could plausibly issue one, and writes a ranked board of 198 protocols with an implied value, token-launch odds, a P25–P75 range, a costed farm verdict and a farm plan each.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Node 22.18 or later, standard library only — nothing to install. The program writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data), `out/dashboard/` (the page), `out/screenshots/` (three screenshots of the page) and `out/dossier.json` (the summary the judge reads). Open `out/dashboard/index.html` in a browser to use the radar.

## The model (radar-3)

No protocol name is special-cased. Every row is scored from the snapshot's own figures, and every term was kept or dropped by held-out tests, not by hand:

- **Fitted multiple** — a log-linear fit of log(market-cap/TVL) on log TVL and the 7-day TVL growth, fitted on the 81 token-bearing peers with a market cap of at least $1M, outside the exchange, bridge and liquid-staking categories. The multiple is clamped to 0.005–5. Size and growth survived both held-out tests; category effects, age and chain count were tried the same way and dropped. Typical miss: ×2.74 leave-one-out, ×1.78 walk-forward by listing date (flat median: ×3.29 / ×3.16).
- **Token odds** — a logistic model of whether a protocol records a token, on age and category token share, fitted on the 645 dated protocols. A row's odds are the chance of a token within 24 months given no token yet. Brier score: 0.219 (10-fold) and 0.264 (walk-forward) against a base rate of 0.250 / 0.321.
- **Ranges** — P25–P75 and P10–P90 bands from the leave-one-out residuals of the fitted value model. Held out, the P25–P75 band holds 49% of real traded caps (stated 50%) and the P10–P90 band holds 79% (stated 80%).
- **Implied value** — TVL × fitted multiple × token odds.
- **Farm economics** — a $10,000 plan; expected drop = plan × (implied value ÷ TVL) × 7% farmer share; gas $3 a transaction on Ethereum, $2 on Bitcoin, $0.10 on Solana, $0.50 elsewhere; time at $25/hour. FARM when net clears $50 and $25/hour, MARGINAL when net clears $0, else SKIP. The gas prices are an assumption, not a snapshot figure.

Wrapped, staked and bridged products of a token that already trades are excluded from the board entirely: they can never launch a token of their own. The dashboard states the model, shows every coefficient behind each rank, prints the held-out test tables, and recomputes every row in the browser and says whether it agrees. A protocol is always described as one that *records no token* — the snapshot cannot prove it has none.

## Layout

- `main.ts` — the entry point: reads the snapshot, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the scoring model, farm plans, board construction and snapshot parsing.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`): ranked board with sort/filter/search, a detail view for every protocol, a live-tokens section kept apart from the pre-token board, and a methodology note. No network use.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
