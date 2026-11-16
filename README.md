# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/donglin3800/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/donglin3800/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar: a web dashboard that ranks pre-token crypto protocols by what their launch would be worth, and shows exactly how to farm each one. It reads a sealed snapshot of DefiLlama protocol data (758 protocols, snapshot 2026-11-14), scores every protocol that records no token and could plausibly issue one, and writes a ranked board of 198 protocols with an implied value, a farm plan, risks and a confidence note each.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Node 22.18 or later, standard library only — nothing to install. The program writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data), `out/dashboard/` (the page), `out/screenshots/` (three screenshots of the page) and `out/dossier.json` (the summary the judge reads). Open `out/dashboard/index.html` in a browser to use the radar.

## The model (radar-2)

No protocol name is special-cased. Every row is scored from the snapshot's own figures:

- **Peer multiple** — the median market-cap/TVL of the token-bearing protocols in the same category (snapshot-wide median when a category has fewer than 3 peers), clamped to 0.05–0.75.
- **Growth** — the 7-day TVL change, clamped to −50%…+100%, weighted 0.35.
- **Age with no token** — the multiplier rises 0.70 → 1.00 over the first 540 days tracked with no token, then eases back to 0.75: a long run with no token is evidence, then it starts to look like a protocol that never launches.
- **Reach** — +3% per extra chain, up to +15%.
- **Watchlist** — ×1.10 for the $50M+ no-token floor set.
- **Launch likelihood** — 0.90 + 0.20 × the share of the category's protocols that already record a token.

Wrapped, staked and bridged products of a token that already trades are excluded from the board entirely: they can never launch a token of their own. The dashboard states the model, shows every multiplier behind each rank, and lists the category calibration table with its peer examples. A protocol is always described as one that *records no token* — the snapshot cannot prove it has none.

## Layout

- `main.ts` — the entry point: reads the snapshot, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the scoring model, farm plans, board construction and snapshot parsing.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`): ranked board with sort/filter/search, a detail view for every protocol, a live-tokens section kept apart from the pre-token board, and a methodology note. No network use.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
