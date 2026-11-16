// Token Launch Radar — model radar-2.
// One sealed snapshot in, one ranked board out. The board ranks only protocols
// whose DefiLlama record carries no token at all, and only ones that could
// plausibly issue a token of their own: wrapped, staked and bridged products
// of a token that already trades are set aside, because WBTC-style products
// never launch a token — they ARE another token on another chain. The same
// rule the snapshot's own watchlist uses is applied to every candidate, not
// just to the watchlist.
// Implied value is built from the snapshot's own figures, nothing else:
//   peer multiple  = median mcap / TVL of the token-bearing protocols in the
//                    same category (at least 3 peers, else the snapshot-wide
//                    median), clamped to [0.05, 0.75]
//   base           = TVL x peer multiple
//   growth factor  = 1 + 0.35 x clamp(change_7d, -50, 100) / 100
//   age factor     = rises 0.70 -> 1.00 over the first 540 days a protocol
//                    has run with no token, then eases 1.00 -> 0.75 out to
//                    1800 days (a long run with no token is evidence, then
//                    it starts to look like a protocol that never launches)
//   chain factor   = 1 + 0.03 per extra chain, up to 1.15
//   watchlist      = x1.10 for the $50M+ no-token floor set
//   launch factor  = 0.90 + 0.20 x (share of the category's protocols that
//                    already record a token) — a category where tokens are
//                    the norm is likelier to produce one more
//   implied        = round(base x growth x age x chain x watchlist x launch)
// No protocol name is ever special-cased. The same scoring path runs for
// every row, and every multiplier is carried on the row so the dashboard can
// show the arithmetic behind each rank.

export interface SnapProtocol {
  slug: string; // DefiLlama slug, unique across the snapshot
  name: string; // protocol name as DefiLlama writes it
  category: string | null; // DefiLlama category, or null
  chains: string[]; // chains the TVL is counted on
  tvl_usd: number; // total value locked, whole dollars
  change_7d: number | null; // TVL change over 7 days, in per cent
  mcap_usd: number | null; // token market cap, null when no token
  listed_at: string | null; // first day DefiLlama tracked it
  gecko_id: string | null; // CoinGecko id of the token, if any
  symbol: string | null; // token ticker, if any
}

export interface SnapFile {
  as_of: string; // UTC date of the DefiLlama fetch
  source: string; // endpoint and fetch time
  floor_usd: number; // the watchlist's TVL floor in dollars
  protocols: SnapProtocol[]; // every protocol at or above $5M TVL
  watchlist: string[]; // slugs that meet the watchlist's rule
}

export interface Tuning {
  growth_weight: number; // weight of the 7-day change in the growth factor
  growth_low: number; // floor for the clamped 7-day change
  growth_high: number; // cap for the clamped 7-day change
  age_peak_days: number; // days of no-token running before the age factor peaks
  age_tail_days: number; // days over which the age factor then eases down
  age_young: number; // age factor for a protocol tracked zero days
  age_old: number; // age factor a very old protocol eases toward
  age_unknown: number; // age factor when no listing date is recorded
  chain_step: number; // added per extra chain
  chain_cap: number; // most extra chains that count
  watchlist_boost: number; // multiplier for watchlist members
  multiple_low: number; // floor for a category's peer multiple
  multiple_high: number; // cap for a category's peer multiple
  min_peers: number; // peers needed before a category's own median is used
}

export const TUNING: Tuning = {
  growth_weight: 0.35,
  growth_low: -50,
  growth_high: 100,
  age_peak_days: 540,
  age_tail_days: 1260,
  age_young: 0.7,
  age_old: 0.75,
  age_unknown: 0.85,
  chain_step: 0.03,
  chain_cap: 5,
  watchlist_boost: 1.1,
  multiple_low: 0.05,
  multiple_high: 0.75,
  min_peers: 3,
};

export const MODEL_VERSION = 'radar-2';
export const LIVE_ROWS = 12;
export const IMPLIED_CAP = 100_000_000_000_000;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface ValueBreakdown {
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
  watchlist_multiplier: number;
  launch_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  why_now: string;
  risks: string[];
  confidence: 'high' | 'medium' | 'low';
  model: ValueBreakdown;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  why_now: string;
  risks: string[];
  confidence: 'high' | 'medium' | 'low';
  watchlist: boolean;
  model: ValueBreakdown;
  farm_steps: string[];
}

export interface PeerExample {
  slug: string;
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

export interface CategoryCalibration {
  category: string;
  peers: number;
  multiple: number;
  token_share: number;
  examples: PeerExample[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  tuning: Tuning;
  overall_multiple: number;
  calibration: CategoryCalibration[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotShapeError';
  }
}

const DAY_MS = 86_400_000;

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whole days from `listedAt` to `asOf`; null when the listing date is missing or unparsable. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** True when the record carries no token in any of the three fields. */
export function isPreToken(p: SnapProtocol): boolean {
  return [p.mcap_usd, p.gecko_id, p.symbol].every((field) => field === null);
}

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const NO_LAUNCH_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word in a name, case-insensitive: "staked" matches "Staked ETH" but not "Stakehouse". */
function hasWord(name: string, word: string): boolean {
  return new RegExp(`(^|[^A-Za-z])${word}([^A-Za-z]|$)`, 'i').test(name);
}

/**
 * Whether a pre-token protocol could plausibly issue a token of its own.
 * Excluded: the categories that are a product of another token (bridges,
 * liquid staking, restaked BTC, exchanges), versioned pools of another
 * protocol ("Something V2"), names that say wrapped / staked / staking, and
 * names that begin with an exchange's name. This is the watchlist's own
 * exclusion rule, applied to every candidate instead of only to the floor.
 */
export function canLaunch(p: SnapProtocol): boolean {
  if (p.category !== null && NO_LAUNCH_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (hasWord(p.name, 'wrapped') || hasWord(p.name, 'staked') || hasWord(p.name, 'staking')) return false;
  if (EXCHANGE_PREFIX.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

export function isEligible(p: SnapProtocol): boolean {
  return isPreToken(p) && canLaunch(p);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface CategoryStats {
  multiples: number[];
  examples: PeerExample[];
  total: number;
  withToken: number;
}

/**
 * Per-category calibration from the snapshot alone: the median mcap/TVL of
 * the category's token-bearing protocols, the share of the category that
 * already records a token, and the three largest peers as examples. The
 * snapshot-wide median is the fallback for thin categories.
 */
export function calibrate(snapshot: SnapFile, tuning: Tuning = TUNING): { byCategory: Map<string, CategoryCalibration>; overall: number } {
  const stats = new Map<string, CategoryStats>();
  const allMultiples: number[] = [];
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Uncategorized';
    let entry = stats.get(key);
    if (entry === undefined) {
      entry = { multiples: [], examples: [], total: 0, withToken: 0 };
      stats.set(key, entry);
    }
    entry.total += 1;
    if (!isPreToken(p)) {
      entry.withToken += 1;
      if (p.mcap_usd !== null && p.tvl_usd > 0) {
        const multiple = p.mcap_usd / p.tvl_usd;
        entry.multiples.push(multiple);
        allMultiples.push(multiple);
        entry.examples.push({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd, tvl_usd: p.tvl_usd, multiple: round4(multiple) });
      }
    }
  }
  const overall = allMultiples.length > 0 ? median(allMultiples) : 0.2;
  const byCategory = new Map<string, CategoryCalibration>();
  for (const [category, entry] of stats) {
    const multiple = entry.multiples.length >= tuning.min_peers ? median(entry.multiples) : overall;
    const clamped = Math.min(tuning.multiple_high, Math.max(tuning.multiple_low, multiple));
    entry.examples.sort((a, b) => b.mcap_usd - a.mcap_usd);
    byCategory.set(category, {
      category,
      peers: entry.multiples.length,
      multiple: round4(clamped),
      token_share: entry.total > 0 ? round4(entry.withToken / entry.total) : 0,
      examples: entry.examples.slice(0, 3),
    });
  }
  return { byCategory, overall: round4(overall) };
}

/** How long a protocol has run with no token, as a multiplier on its value. */
export function ageMultiplier(age: number | null, tuning: Tuning = TUNING): number {
  if (age === null) return tuning.age_unknown;
  if (age <= tuning.age_peak_days) return tuning.age_young + ((1 - tuning.age_young) * age) / tuning.age_peak_days;
  const past = Math.min(age - tuning.age_peak_days, tuning.age_tail_days);
  return 1 - ((1 - tuning.age_old) * past) / tuning.age_tail_days;
}

/**
 * The implied value of one eligible protocol, with every multiplier exposed.
 * `calibration` is the snapshot's own per-category table from calibrate().
 */
export function impliedValue(
  p: SnapProtocol,
  asOf: string,
  calibration: Map<string, CategoryCalibration>,
  overallMultiple: number,
  watchlist: Set<string>,
  tuning: Tuning = TUNING,
): { implied: number; breakdown: ValueBreakdown } {
  const key = p.category ?? 'Uncategorized';
  const cal = calibration.get(key);
  const categoryMultiple = cal !== undefined ? cal.multiple : Math.min(tuning.multiple_high, Math.max(tuning.multiple_low, overallMultiple));
  const rawGrowth = asNumber(p.change_7d, 0);
  const growthPct = Math.min(tuning.growth_high, Math.max(tuning.growth_low, rawGrowth));
  const growthMultiplier = 1 + (growthPct / 100) * tuning.growth_weight;
  const age = daysSince(asOf, p.listed_at);
  const ageMult = ageMultiplier(age, tuning);
  const chainMultiplier = 1 + tuning.chain_step * Math.min(Math.max(p.chains.length - 1, 0), tuning.chain_cap);
  const watchlistMultiplier = watchlist.has(p.slug) ? tuning.watchlist_boost : 1;
  const tokenShare = cal !== undefined ? cal.token_share : 0.5;
  const launchMultiplier = 0.9 + 0.2 * tokenShare;
  const raw = p.tvl_usd * categoryMultiple * growthMultiplier * ageMult * chainMultiplier * watchlistMultiplier * launchMultiplier;
  const implied = Math.min(IMPLIED_CAP, Math.max(1, Math.round(raw)));
  return {
    implied,
    breakdown: {
      category_multiple: categoryMultiple,
      growth_pct: round2(growthPct),
      growth_multiplier: round4(growthMultiplier),
      age_multiplier: round4(ageMult),
      chain_multiplier: round4(chainMultiplier),
      watchlist_multiplier: round4(watchlistMultiplier),
      launch_multiplier: round4(launchMultiplier),
      age_days: age,
    },
  };
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

function growthWords(p: SnapProtocol): string {
  if (p.change_7d === null) return 'with no 7-day change reported';
  if (p.change_7d >= 20) return `up ${p.change_7d.toFixed(1)}% in 7 days`;
  if (p.change_7d >= 0) return `up ${p.change_7d.toFixed(1)}% in 7 days`;
  if (p.change_7d >= -10) return `down ${Math.abs(p.change_7d).toFixed(1)}% in 7 days`;
  return `down ${Math.abs(p.change_7d).toFixed(1)}% in 7 days`;
}

/** One sentence on why this protocol, now: built only from its own figures. */
export function whyNow(p: SnapProtocol, age: number | null, implied: number, watchlist: Set<string>): string {
  const parts: string[] = [];
  parts.push(`${money(p.tvl_usd)} of TVL, ${growthWords(p)}, and ${age === null ? 'no listing date on record' : `${age} days tracked`} with no token recorded.`);
  if (watchlist.has(p.slug)) parts.push('It clears the $50M no-token floor, so it is already on the watchlist.');
  if (p.chains.length >= 5) parts.push(`It runs on ${p.chains.length} chains, so one position reaches a wide user base.`);
  if (p.change_7d !== null && p.change_7d >= 20) parts.push('The 7-day jump is the momentum a launch usually follows, not precedes.');
  if (age !== null && age >= 180 && age <= 1095) parts.push('It has run long enough to be real and short enough that a token is still ahead of it.');
  if (age !== null && age > 1095) parts.push('Its long run with no token cuts both ways: proven, but a launch is overdue, not guaranteed.');
  parts.push(`At the category's peer multiple the launch would be worth about ${money(implied)}.`);
  return parts.join(' ');
}

/** The risks that the snapshot itself shows, each with the number behind it. */
export function riskList(p: SnapProtocol, age: number | null, tokenShare: number): string[] {
  const risks: string[] = [];
  if (p.change_7d !== null && p.change_7d < -10) risks.push(`TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in 7 days, so the position is shrinking before any launch.`);
  if (age !== null && age > 1095) risks.push(`It has run ${age} days with no token recorded, so a launch may never come and the farm may pay nothing.`);
  if (age === null) risks.push('No listing date is recorded, so the protocol\'s age — and its launch timing — cannot be checked.');
  if (p.chains.length <= 1) risks.push(`It runs on a single chain (${p.chains[0] ?? 'unknown'}), so one chain's outage or fee spike hits the whole position.`);
  if (p.tvl_usd < 25_000_000) risks.push(`At ${money(p.tvl_usd)} of TVL it is small, so a few large withdrawals move it a lot.`);
  if (tokenShare < 0.35) risks.push(`Only ${(tokenShare * 100).toFixed(0)}% of protocols in its category record a token, so this category rarely issues one.`);
  if (risks.length === 0) risks.push('No red flag in the snapshot: the risk is that a launch is never announced, which no figure here can rule out.');
  return risks.slice(0, 3);
}

/** Confidence from the snapshot's own signals: size, growth, age window, reach. */
export function confidenceFor(p: SnapProtocol, age: number | null): 'high' | 'medium' | 'low' {
  let points = 0;
  if (p.tvl_usd >= 100_000_000) points += 1;
  if (p.change_7d !== null && p.change_7d >= 0) points += 1;
  if (age !== null && age >= 180 && age <= 1095) points += 1;
  if (p.chains.length >= 3) points += 1;
  if (points >= 3) return 'high';
  if (points === 2) return 'medium';
  return 'low';
}

function mainChainOf(p: SnapProtocol): string {
  return p.chains[0] ?? 'its main chain';
}

function walletKind(p: SnapProtocol): string {
  const first = p.chains.length > 0 ? p.chains[0]! : '';
  if (first === 'Solana') return 'a fresh Solana wallet';
  if (first === 'Bitcoin') return 'a fresh wallet that can hold assets on its chain';
  return 'a fresh EVM wallet';
}

function capitalFor(p: SnapProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

function holdWindowFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The core action for a category, in the words a farmer can follow. */
function coreAction(p: SnapProtocol, capital: number, chain: string): string {
  const kind = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and leave it earning.`;
  if (kind.includes('dex') || kind.includes('leveraged farm')) return `Provide $${capital} of liquidity in ${name}'s deepest pool on ${chain} and keep the position open.`;
  if (kind.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and let it compound.`;
  if (kind.includes('yield') || kind.includes('curator') || kind.includes('allocator') || kind.includes('liquidity manager')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the receipt tokens.`;
  if (kind.includes('rwa')) return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (kind.includes('derivative') || kind.includes('perpetual') || kind.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  if (kind.includes('prediction')) return `Fund ${name} with $${capital} on ${chain} and take one position in an active market.`;
  if (kind.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (kind.includes('staking') || kind.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`;
  if (kind.includes('payment')) return `Move $${capital} through ${name} on ${chain} for a real payment and keep the receipt.`;
  if (kind.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote in its next governance round.`;
  if (kind.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (kind.includes('chain')) return `Bridge $${capital} of USDC onto ${chain} through ${name}'s own route and use it in its flagship app.`;
  return `Put $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** The second, different action for the same protocol, so the farm is not one move repeated. */
function secondAction(p: SnapProtocol, capital: number, chain: string): string {
  const kind = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) return `Borrow $${small} against the supply on ${name} and repay it within the week, so the position shows both sides of the market.`;
  if (kind.includes('dex')) return `Swap $${small} through ${name}'s pool on ${chain} once, using the route the pool itself quotes.`;
  if (kind.includes('yield') || kind.includes('curator') || kind.includes('allocator') || kind.includes('liquidity manager')) return `Claim or restake the vault's yield on ${name} once a week instead of letting it sit unclaimed.`;
  if (kind.includes('derivative') || kind.includes('perpetual') || kind.includes('basis')) return `Close the hedge on ${name} and reopen it once, so the account shows two settled trades.`;
  if (kind.includes('prediction')) return `Settle one market position on ${name} and open a different one, rather than holding a single bet.`;
  if (kind.includes('rwa')) return `Reinvest the yield ${name} pays into the same asset, so the balance grows every cycle.`;
  if (kind.includes('staking') || kind.includes('restak')) return `Delegate a second, smaller stake through ${name} on ${chain} a week after the first.`;
  if (kind.includes('insurance')) return `File a test claim check on ${name} to confirm the policy is live, without filing a false claim.`;
  return `Make one more qualifying action on ${name} — a swap, a vote or a deposit of $${small} — different from the first.`;
}

/**
 * A protocol's farm plan: seven steps, each with a cost and a time, derived
 * from the protocol's own record (category, chains, TVL, age). Steps are
 * rendered as one string each: the action, then its cost and time.
 */
export function farmSteps(p: SnapProtocol, age: number | null): FarmStep[] {
  const chain = mainChainOf(p);
  const capital = capitalFor(p);
  const hold = holdWindowFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Open ${walletKind(p)} that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot or a chat.`,
      cost: 'nothing to open, under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: coreAction(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: secondAction(p, capital, chain), cost: `about $${gas} of gas`, time: '10 minutes' },
    {
      text: `Do one qualifying action each week — a deposit, a borrow, a swap, a claim or a vote — and never the same action two weeks running.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted in more than one snapshot instead of one.`,
      cost: `$${capital} of capital, locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from the link it publishes itself and claim only there.`,
      cost: 'checking costs nothing, and claiming never costs a fee',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and unwind in the reverse order — claim first, then withdraw, then close.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20 to 600 characters. */
export function renderStep(step: FarmStep): string {
  const joined = `${step.text} (Cost: ${step.cost}; time: ${step.time}.)`;
  if (joined.length > 600) return `${joined.slice(0, 597)}...`;
  if (joined.length < 20) return `${joined} Keep the position open and check the protocol's own page.`;
  return joined;
}

/** The ranked board: every eligible protocol, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: SnapFile, tuning: Tuning = TUNING): { board: BoardRow[]; calibration: CategoryCalibration[]; overallMultiple: number } {
  const { byCategory, overall } = calibrate(snapshot, tuning);
  const watch = new Set(snapshot.watchlist);
  const eligible = snapshot.protocols.filter((p) => isEligible(p));
  const scored = eligible.map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, byCategory, overall, watch, tuning);
    const age = breakdown.age_days;
    const cal = byCategory.get(p.category ?? 'Uncategorized');
    return {
      p,
      implied,
      breakdown,
      age,
      tokenShare: cal !== undefined ? cal.token_share : 0.5,
    };
  });
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    return a.p.slug.localeCompare(b.p.slug);
  });
  const board: BoardRow[] = scored.map((s, i) => ({
    ...s.p,
    rank: i + 1,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    why_now: whyNow(s.p, s.age, s.implied, watch),
    risks: riskList(s.p, s.age, s.tokenShare),
    confidence: confidenceFor(s.p, s.age),
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.age).map(renderStep),
  }));
  const calibration = [...byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  return { board, calibration, overallMultiple: overall };
}

/** The live-token protocols, by market cap: the market's own values, kept apart from the ranked board. */
export function liveRows(snapshot: SnapFile): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  trading.sort((a, b) => {
    const capGap = (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
    return capGap !== 0 ? capGap : b.tvl_usd - a.tvl_usd;
  });
  return trading.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

function toRadarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  const { gecko_id, symbol, mcap_usd, ...rest } = row;
  void gecko_id;
  void symbol;
  void mcap_usd;
  return { ...rest, watchlist: onWatchlist };
}

/** Everything the dashboard renders, built from the same board the program writes. */
export function buildRadar(snapshot: SnapFile, tuning: Tuning = TUNING): { board: BoardRow[]; radar: RadarData } {
  const { board, calibration, overallMultiple } = buildBoard(snapshot, tuning);
  const live = liveRows(snapshot);
  const beyondWatchlist = board.filter((row) => !snapshot.watchlist.includes(row.slug)).length;
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    tuning,
    overall_multiple: overallMultiple,
    calibration,
    watchlist_size: watch.size,
    board_size: board.length,
    early_size: beyondWatchlist,
    live_size: live.length,
    rows: board.map((r) => toRadarRow(r, watch.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text: the shape is checked field by field, and anything else is refused. */
export function parseSnapshot(text: string): SnapFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotShapeError('snapshot text is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotShapeError('snapshot root must be a JSON object');
  }
  const doc = parsed as Record<string, unknown>;
  const asOf = doc.as_of;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotShapeError('snapshot as_of must be a YYYY-MM-DD date');
  const source = doc.source;
  if (typeof source !== 'string') throw new SnapshotShapeError('snapshot source must be a string');
  const floor = doc.floor_usd;
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor <= 0) throw new SnapshotShapeError('snapshot floor_usd must be a positive whole number');
  const rawProtocols = doc.protocols;
  if (!Array.isArray(rawProtocols)) throw new SnapshotShapeError('snapshot protocols must be an array');
  const rawWatchlist = doc.watchlist;
  if (!Array.isArray(rawWatchlist) || rawWatchlist.some((entry) => typeof entry !== 'string')) {
    throw new SnapshotShapeError('snapshot watchlist must be an array of slugs');
  }
  const protocols: SnapProtocol[] = rawProtocols.map((entry, position) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotShapeError(`snapshot protocol at position ${position} must be an object`);
    }
    const rec = entry as Record<string, unknown>;
    const slug = rec.slug;
    const name = rec.name;
    const tvl = rec.tvl_usd;
    if (typeof slug !== 'string' || typeof name !== 'string' || typeof tvl !== 'number' || !Number.isFinite(tvl)) {
      throw new SnapshotShapeError(`snapshot protocol at position ${position} needs a slug, a name and a finite TVL`);
    }
    const chainsRaw = rec.chains;
    const chains = Array.isArray(chainsRaw) ? chainsRaw.filter((c): c is string => typeof c === 'string') : [];
    const changeRaw = rec.change_7d;
    const mcapRaw = rec.mcap_usd;
    return {
      slug,
      name,
      category: typeof rec.category === 'string' ? rec.category : null,
      chains,
      tvl_usd: tvl,
      change_7d: typeof changeRaw === 'number' && Number.isFinite(changeRaw) ? changeRaw : null,
      mcap_usd: typeof mcapRaw === 'number' && Number.isFinite(mcapRaw) ? mcapRaw : null,
      listed_at: typeof rec.listed_at === 'string' ? rec.listed_at : null,
      gecko_id: typeof rec.gecko_id === 'string' ? rec.gecko_id : null,
      symbol: typeof rec.symbol === 'string' ? rec.symbol : null,
    };
  });
  return { as_of: asOf, source, floor_usd: floor, protocols, watchlist: rawWatchlist as string[] };
}

/**
 * The first reason a board would be refused by the gate, or null when it is
 * a board the gate takes: watchlist coverage, ranks 1..N in order, implied
 * values that never rise with rank, and farm steps inside their limits.
 */
export function boardIssue(board: BoardRow[], snapshot: SnapFile): string | null {
  const onBoard = new Set(board.map((row) => row.slug));
  const uncovered = snapshot.watchlist.filter((slug) => !onBoard.has(slug));
  if (uncovered.length > 0) {
    return `watchlist slug${uncovered.length === 1 ? '' : 's'} missing from the board: ${uncovered.slice(0, 5).join(', ')}`;
  }
  const orderedRanks = board.map((row) => row.rank).sort((x, y) => x - y);
  for (let position = 0; position < orderedRanks.length; position++) {
    if (orderedRanks[position] !== position + 1) return `rank ${position + 1} is missing, found ${orderedRanks[position]}`;
  }
  for (let position = 1; position < board.length; position++) {
    if (board[position]!.implied_value_usd > board[position - 1]!.implied_value_usd) {
      return `row at rank ${board[position]!.rank} is worth more than the row above it`;
    }
  }
  if (board.length >= 2) {
    const first = board[0]!.implied_value_usd;
    const last = board[board.length - 1]!.implied_value_usd;
    if (first === last) return `every row is worth $${first}: the board ranks nothing`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} carries ${row.farm_steps.length} farm steps, outside 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const length = step.trim().length;
      if (length < 20 || length > 600) return `${row.slug} has a farm step of ${length} characters, outside 20 to 600`;
    }
    const value = row.implied_value_usd;
    if (!Number.isSafeInteger(value) || value <= 0 || value > IMPLIED_CAP) return `${row.slug} is worth ${value}, outside the gate`;
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function radarScript(radar: RadarData): string {
  return `window.TOKEN_RADAR=${JSON.stringify(radar)};\n`;
}
