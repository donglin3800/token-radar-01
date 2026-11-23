// Token Launch Radar — model radar-3.
// One sealed snapshot in, one ranked board out. The board ranks only protocols
// whose DefiLlama record carries no token at all, and only ones that could
// plausibly issue a token of their own: wrapped, staked and bridged products
// of a token that already trades are set aside, because WBTC-style products
// never launch a token — they ARE another token on another chain. The same
// rule the snapshot's own watchlist uses is applied to every candidate, not
// just to the watchlist.
//
// radar-3 replaces radar-2's hand-set median multiple with a model that is
// FITTED on the snapshot's own token-bearing peers and TESTED held-out, and
// it says so on the dashboard with the measured numbers, never with a claim
// the tests do not support:
//   value  = TVL x fitted multiple x token odds. The fitted multiple is a
//            log-linear fit of log(mcap/TVL) on log TVL and log chain count,
//            each term kept only when it lowers the held-out miss in BOTH
//            tests below (category, growth and age were tried the same way
//            and dropped: the tables on the page show their numbers). The
//            peers are the token-bearing protocols with a market cap of at
//            least $1M, outside the exchange, bridge and liquid-staking
//            categories whose tokens are not launches of their own.
//   tests  = leave-one-out over the peers, and walk-forward by listing date
//            (fit on the earlier-listed half, price the later-listed half).
//            The typical miss is the median factor by which the prediction
//            is off, so x2.6 means the middle peer's price is within 2.6x.
//   odds   = a logistic model of whether a protocol records a token, fitted
//            on the dated protocols and scored by Brier score against the
//            base rate, held out by 10-fold cross-validation and
//            walk-forward. A row's odds are the chance of a token within
//            24 months GIVEN no token yet at its age: (F(A+730) - F(A)) /
//            (1 - F(A)), where F is the fitted cumulative launch curve.
//            Old protocols that never launched score low on purpose: the
//            survivors are the ones least likely to launch next.
//   ranges = P25-P75 and P10-P90 bands from the leave-one-out residuals of
//            the fitted value model. The page prints the measured share of
//            real traded caps that fall inside them, held out — the bands
//            are as honest as those shares say, no more.
//   farm   = a $10,000 plan. Expected drop = plan x (implied value / TVL)
//            x 7% farmer allocation. Fees are gas at the page's stated
//            assumption ($3 a transaction on Ethereum, $2 on Bitcoin,
//            $0.10 on Solana, $0.50 elsewhere — an assumption, not a
//            snapshot figure). Net = drop - gas; net/hour = net / active
//            hours. FARM when net clears $50 (a T-bill on the plan over the
//            hold) and $25 an hour; MARGINAL when net clears $0; else SKIP.
// No protocol name is ever special-cased. The same scoring path runs for
// every row, and every coefficient is carried in the dashboard's data so
// the page recomputes each row in the browser and says whether it agrees.

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

export const MODEL_VERSION = 'radar-3';
export const IMPLIED_CAP = 100_000_000_000_000;
export const LIVE_ROWS = 12;

// The fitted model's peer rule: a market cap under $1M is dust, not a price,
// and an exchange, bridge or liquid-staking token is not a launch of its own.
export const PEER_MCAP_FLOOR = 1_000_000;
export const PEER_MIN_CHAIN = 0; // no chain-count floor on peers
export const MULTIPLE_LOW = 0.005; // clamp on a fitted multiple
export const MULTIPLE_HIGH = 5;
export const ODDS_HORIZON_DAYS = 730; // the odds are for a token within this long
export const ODDS_LOW = 0.01;
export const ODDS_HIGH = 0.99;

// The farm's stated economics (assumptions, not snapshot figures).
export const PLAN_USD = 10_000; // the standard plan's deposit
export const DROP_SHARE = 0.07; // the farmer allocation of a launch
export const HOUR_RATE = 25; // dollars an hour of work is worth
export const FARM_NET_MIN = 50; // a T-bill on the plan over the hold, in dollars
export const GAS_BY_CHAIN: Record<string, number> = { Ethereum: 3, Bitcoin: 2, Solana: 0.1 };
export const GAS_DEFAULT = 0.5; // every other chain, dollars a transaction

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
  gasUsd: number; // gas this step spends, at the stated assumption
  minutes: number; // active minutes this step takes
}

export interface ValueBreakdown {
  multiple: number; // the fitted mcap/TVL multiple for this row
  launch_value_usd: number; // TVL x multiple: the value if a token launches
  token_odds: number; // chance of a token within 24 months, given none yet
  size_log_mult: number; // log multiple from the size curve
  chains_log_mult: number; // log multiple from the chain count
  growth_log_mult: number; // log multiple from the 7-day growth term
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
  listed_at: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  token_odds: number;
  range_lo_usd: number; // implied P25
  range_hi_usd: number; // implied P75
  range_lo90_usd: number; // implied P10
  range_hi90_usd: number; // implied P90
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  drop_usd: number;
  gas_usd: number;
  hours: number;
  net_usd: number;
  net_per_hour_usd: number;
  hold_days: number;
  multiple: number;
  why_now: string;
  risks: string[];
  model: ValueBreakdown;
  farm_steps: string[];
}

export interface PlanStep {
  text: string;
  cost: string;
  time: string;
  gasUsd: number;
  minutes: number;
}

export interface FarmPlan {
  steps: PlanStep[];
  plan_usd: number;
  drop_usd: number;
  gas_usd: number;
  hours: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  hold_days: number;
}

export interface RadarRow extends Omit<BoardRow, 'farm_steps'> {
  watchlist: boolean;
  farm_steps: string[];
  plan: FarmPlan;
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
  peers: number; // value peers in this category (mcap >= floor)
  multiple: number; // their median mcap/TVL, descriptive only
  token_share: number; // share of the category's protocols that record a token
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

export interface ValueStageRow {
  term: string;
  loo: number; // leave-one-out typical miss (x factor)
  wf: number; // walk-forward typical miss (x factor)
  kept: boolean;
  control?: boolean; // a nonsense term, never kept, that must not help
}

export interface OddsStageRow {
  term: string;
  cv: number; // 10-fold Brier score
  wf: number; // walk-forward Brier score
  kept: boolean;
}

export interface ValueValidation {
  peers: number;
  dated_peers: number;
  flat_loo: number;
  flat_wf: number;
  loo_miss: number;
  wf_miss: number;
  stages: ValueStageRow[];
  kept_terms: string[];
  residual_q10: number;
  residual_q25: number;
  residual_q75: number;
  residual_q90: number;
  range_p25_75_loo: number; // share of real caps inside the P25-P75 band, held out
  range_p10_90_loo: number;
  range_p25_75_wf: number;
  range_p10_90_wf: number;
}

export interface OddsValidation {
  peers: number; // dated protocols the odds model learned from
  base_rate: number;
  base_brier_cv: number;
  base_brier_wf: number;
  brier_cv: number;
  brier_wf: number;
  stages: OddsStageRow[];
  kept_terms: string[];
  weights: number[]; // logistic weights: bias, then one per kept term in order
  means: Record<string, number>;
  sds: Record<string, number>;
}

export interface AccountingGroup {
  label: string;
  count: number;
}

export interface Economics {
  plan_usd: number;
  drop_share: number;
  hour_rate: number;
  farm_net_min: number;
  gas_by_chain: Record<string, number>;
  gas_default: number;
  hold_rule: string;
}

export interface ModelParams {
  // Everything the page needs to recompute a row in the browser: every
  // fitted term the model kept, at full precision. A term the model dropped
  // is carried as 0 (or null for the category map), so the browser's formula
  // is the same formula the library used, with nothing left out.
  value_intercept: number;
  value_size_slope: number;
  value_mean_log_tvl: number;
  value_cat: Record<string, number> | null;
  value_growth_coef: number;
  value_age_coef: number;
  value_mean_log_age: number;
  value_chains_coef: number;
  value_mean_log_chains: number;
  multiple_low: number;
  multiple_high: number;
  residual_q10: number;
  residual_q25: number;
  residual_q75: number;
  residual_q90: number;
  odds_weights: number[];
  odds_means: Record<string, number>;
  odds_sds: Record<string, number>;
  odds_terms: string[];
  odds_category_share: Record<string, number>;
  odds_median_age: number;
  odds_horizon_days: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  economics: Economics;
  value_validation: ValueValidation;
  odds_validation: OddsValidation;
  accounting: AccountingGroup[];
  checksum: string; // FNV-1a over the board's slug:implied lines, also in board.json
  board_total_usd: number;
  overall_multiple: number; // median mcap/TVL of the value peers, descriptive
  calibration: CategoryCalibration[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  model_params: ModelParams;
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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function quantile(sorted: number[], f: number): number {
  return sorted[Math.floor(f * (sorted.length - 1))]!;
}

/** FNV-1a, 32-bit, as eight lowercase hex digits. */
export function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
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

/** True when the record carries a token in any of the three fields. */
export function hasToken(p: SnapProtocol): boolean {
  return !isPreToken(p);
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

/** Why a pre-token protocol is left off the board: the first rule that excludes it. */
export function exclusionReason(p: SnapProtocol): string {
  if (p.category !== null && NO_LAUNCH_CATEGORIES.has(p.category)) return `category ${p.category} is a product of a token that trades`;
  if (VERSION_TAIL.test(p.name)) return 'name ends in a version marker';
  if (hasWord(p.name, 'wrapped') || hasWord(p.name, 'staked') || hasWord(p.name, 'staking')) return 'name says wrapped, staked or staking';
  if (EXCHANGE_PREFIX.some((prefix) => p.name.startsWith(prefix))) return 'name begins with an exchange';
  return 'records no token and could launch';
}

// ------------------------------------------------------------------ fitting

/** Solve a small least-squares problem by Gaussian elimination on the normal equations. */
export function ols(design: number[][], target: number[]): number[] {
  const d = design[0]!.length;
  const a: number[][] = Array.from({ length: d }, () => Array<number>(d).fill(0));
  const b: number[] = Array<number>(d).fill(0);
  for (let i = 0; i < design.length; i++) {
    for (let j = 0; j < d; j++) {
      b[j]! += design[i]![j]! * target[i]!;
      for (let k = 0; k < d; k++) a[j]![k]! += design[i]![j]! * design[i]![k]!;
    }
  }
  for (let j = 1; j < d; j++) a[j]![j]! += 1e-8; // a hair of ridge, for stability
  for (let c = 0; c < d; c++) {
    let pivot = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[pivot]![c]!)) pivot = r;
    [a[c], a[pivot]] = [a[pivot]!, a[c]!];
    [b[c], b[pivot]] = [b[pivot]!, b[c]!];
    for (let r = 0; r < d; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = 0; k < d; k++) a[r]![k]! -= f * a[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  return b.map((v, j) => v / a[j]![j]!);
}

// ------------------------------------------------------------------ value model

/** The value peers: token-bearing, a market cap that is a price, and a token that is a launch of its own. */
export function valuePeers(snapshot: SnapFile): SnapProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null &&
      p.mcap_usd >= PEER_MCAP_FLOOR &&
      p.tvl_usd > 0 &&
      !(p.category !== null && NO_LAUNCH_CATEGORIES.has(p.category)),
  );
}

type ValueStage = 1 | 2 | 3 | 4 | 5; // 1 size, 2 category, 3 growth, 4 age, 5 chains

interface FittedValue {
  flat: number;
  size: number[] | null; // [intercept, slope] on centred log TVL
  cat: Map<string, number> | null; // shrunk category residual means
  growth: number | null; // slope on clamped 7-day change / 100
  age: number | null; // slope on centred log age
  chains: number | null; // slope on centred log chain count
  meanLogTvl: number;
  meanLogAge: number; // over dated peers only
  meanLogChains: number;
}

/** Features of a protocol for the value model, centred on the fit's own means. */
interface ValueFeatures {
  logTvlC: number;
  logAgeC: number | null; // null when no listing date: contributes nothing
  logChainsC: number;
  growth: number;
  category: string;
}

function valueFeatures(p: SnapProtocol, asOf: string, fit: Pick<FittedValue, 'meanLogTvl' | 'meanLogAge' | 'meanLogChains'>): ValueFeatures {
  const age = daysSince(asOf, p.listed_at);
  return {
    logTvlC: Math.log(p.tvl_usd) - fit.meanLogTvl,
    logAgeC: age === null ? null : Math.log(age + 1) - fit.meanLogAge,
    logChainsC: Math.log(p.chains.length) - fit.meanLogChains,
    growth: clamp(asNumber(p.change_7d, 0), -50, 100) / 100,
    category: p.category ?? 'Uncategorized',
  };
}

function predictLogMultiple(f: ValueFeatures, fit: FittedValue): number {
  let v = fit.flat;
  if (fit.size !== null) v = fit.size[0]! + fit.size[1]! * f.logTvlC;
  if (fit.cat !== null) v += fit.cat.get(f.category) ?? 0;
  if (fit.growth !== null) v += fit.growth * f.growth;
  if (fit.age !== null && f.logAgeC !== null) v += fit.age * f.logAgeC;
  if (fit.chains !== null) v += fit.chains * f.logChainsC;
  return v;
}

/**
 * Fit the value model on the peers at `idxs`, with the given stages, in
 * order: each stage is fitted on the residuals of the stages before it.
 * Every mean is computed from `idxs` alone, so a held-out peer never leaks
 * into the fit that prices it.
 */
function fitValueModel(peers: SnapProtocol[], asOf: string, idxs: number[], stages: ValueStage[]): FittedValue {
  const ys = idxs.map((i) => Math.log(peers[i]!.mcap_usd! / peers[i]!.tvl_usd));
  const flat = median(ys);
  const meanLogTvl = mean(idxs.map((i) => Math.log(peers[i]!.tvl_usd)));
  const dated = idxs.filter((i) => peers[i]!.listed_at !== null);
  const meanLogAge = mean(dated.map((i) => Math.log(daysSince(asOf, peers[i]!.listed_at)! + 1)));
  const meanLogChains = mean(idxs.map((i) => Math.log(peers[i]!.chains.length)));
  const base = { meanLogTvl, meanLogAge, meanLogChains };
  const fit: FittedValue = { flat, size: null, cat: null, growth: null, age: null, chains: null, ...base };
  let pred = idxs.map(() => flat);
  let resid = idxs.map((_, k) => ys[k]! - pred[k]!);
  const feat = (i: number): ValueFeatures => valueFeatures(peers[i]!, asOf, base);
  if (stages.includes(1)) {
    const b = ols(
      idxs.map((i) => [1, feat(i).logTvlC]),
      ys,
    );
    fit.size = b;
    pred = idxs.map((i) => b[0]! + b[1]! * feat(i).logTvlC);
    resid = idxs.map((_, k) => ys[k]! - pred[k]!);
  }
  if (stages.includes(2)) {
    const byCat = new Map<string, { n: number; sum: number }>();
    for (let k = 0; k < idxs.length; k++) {
      const c = feat(idxs[k]!).category;
      const e = byCat.get(c) ?? { n: 0, sum: 0 };
      e.n += 1;
      e.sum += resid[k]!;
      byCat.set(c, e);
    }
    const ce = new Map<string, number>();
    for (const [c, e] of byCat) ce.set(c, (e.n / (e.n + 4)) * (e.sum / e.n));
    fit.cat = ce;
    pred = idxs.map((i, k) => pred[k]! + (ce.get(feat(i).category) ?? 0));
    resid = idxs.map((_, k) => ys[k]! - pred[k]!);
  }
  if (stages.includes(3)) {
    const b = ols(
      idxs.map((i) => [1, feat(i).growth]),
      resid,
    );
    fit.growth = b[1]!;
    pred = idxs.map((i, k) => pred[k]! + b[1]! * feat(i).growth);
    resid = idxs.map((_, k) => ys[k]! - pred[k]!);
  }
  if (stages.includes(4)) {
    const b = ols(
      dated.map((i) => [1, feat(i).logAgeC!]),
      dated.map((i) => ys[idxs.indexOf(i)]! - pred[idxs.indexOf(i)]!),
    );
    fit.age = b[1]!;
    pred = idxs.map((i, k) => pred[k]! + (feat(i).logAgeC === null ? 0 : b[1]! * feat(i).logAgeC!));
    resid = idxs.map((_, k) => ys[k]! - pred[k]!);
  }
  if (stages.includes(5)) {
    const b = ols(
      idxs.map((i) => [1, feat(i).logChainsC]),
      resid,
    );
    fit.chains = b[1]!;
    pred = idxs.map((i, k) => pred[k]! + b[1]! * feat(i).logChainsC);
    resid = idxs.map((_, k) => ys[k]! - pred[k]!);
  }
  return fit;
}

/** The median factor by which predictions miss the real multiples. */
function typicalMiss(predicted: number[], actual: number[]): number {
  return median(predicted.map((p, k) => Math.exp(Math.abs(p - actual[k]!))));
}

/** The fitted multiple for one protocol, clamped to the stated guard rails. */
export function fittedMultiple(p: SnapProtocol, asOf: string, fit: FittedValue): number {
  const logMult = predictLogMultiple(valueFeatures(p, asOf, fit), fit);
  return clamp(Math.exp(logMult), MULTIPLE_LOW, MULTIPLE_HIGH);
}

/** The control term: slug length. A nonsense feature that must not help. */
function controlMiss(peers: SnapProtocol[], all: number[], wfTrain: number[], wfTest: number[]): { loo: number; wf: number } {
  const logMult = (i: number): number => Math.log(peers[i]!.mcap_usd! / peers[i]!.tvl_usd);
  const looPred: number[] = [];
  const looAct: number[] = [];
  for (const i of all) {
    const train = all.filter((j) => j !== i);
    const b = ols(
      train.map((j) => [1, peers[j]!.slug.length]),
      train.map((j) => logMult(j)),
    );
    looPred.push(b[0]! + b[1]! * peers[i]!.slug.length);
    looAct.push(logMult(i));
  }
  const b = ols(
    wfTrain.map((j) => [1, peers[j]!.slug.length]),
    wfTrain.map((j) => logMult(j)),
  );
  const wfPred = wfTest.map((i) => b[0]! + b[1]! * peers[i]!.slug.length);
  const wfAct = wfTest.map((i) => logMult(i));
  return { loo: typicalMiss(looPred, looAct), wf: typicalMiss(wfPred, wfAct) };
}

export interface ValueFitResult {
  validation: ValueValidation;
  fit: FittedValue;
  looResiduals: number[];
  // The raw residual quantiles. The validation table prints them rounded,
  // but the board's ranges and the browser recompute use the raw values,
  // so the two agree to the dollar.
  residualQuantiles: { q10: number; q25: number; q75: number; q90: number };
}

/** Fit the value model with held-out term selection, and measure it honestly. */
export function evaluateValueModel(snapshot: SnapFile): ValueFitResult {
  const peers = valuePeers(snapshot);
  const asOf = snapshot.as_of;
  const all = peers.map((_, i) => i);
  const ys = all.map((i) => Math.log(peers[i]!.mcap_usd! / peers[i]!.tvl_usd));
  const datedSorted = all
    .filter((i) => peers[i]!.listed_at !== null)
    .sort((a, b) => {
      const d = peers[a]!.listed_at!.localeCompare(peers[b]!.listed_at!);
      return d !== 0 ? d : peers[a]!.slug.localeCompare(peers[b]!.slug);
    });
  const cut = Math.floor(datedSorted.length / 2);
  const wfTrain = datedSorted.slice(0, cut);
  const wfTest = datedSorted.slice(cut);
  const looMiss = (stages: ValueStage[]): number => {
    const pred: number[] = [];
    const act: number[] = [];
    for (const i of all) {
      const fit = fitValueModel(peers, asOf, all.filter((j) => j !== i), stages);
      pred.push(predictLogMultiple(valueFeatures(peers[i]!, asOf, fit), fit));
      act.push(ys[i]!);
    }
    return typicalMiss(pred, act);
  };
  const wfMiss = (stages: ValueStage[]): number => {
    const fit = fitValueModel(peers, asOf, wfTrain, stages);
    return typicalMiss(
      wfTest.map((i) => predictLogMultiple(valueFeatures(peers[i]!, asOf, fit), fit)),
      wfTest.map((i) => ys[i]!),
    );
  };
  const flatLoo = looMiss([]);
  const flatWf = wfMiss([]);
  const stageDefs: { stage: ValueStage; term: string }[] = [
    { stage: 1, term: 'size curve, in log TVL' },
    { stage: 2, term: 'category effect, shrunk' },
    { stage: 3, term: '7-day TVL growth' },
    { stage: 4, term: 'age, years listed' },
    { stage: 5, term: 'chain count, log' },
  ];
  const stages: ValueStageRow[] = [{ term: 'flat median multiple', loo: round3(flatLoo), wf: round3(flatWf), kept: true }];
  const kept: ValueStage[] = [];
  let cur = { loo: flatLoo, wf: flatWf };
  for (const def of stageDefs) {
    const trial = [...kept, def.stage];
    const loo = looMiss(trial);
    const wf = wfMiss(trial);
    const keep = loo < cur.loo && wf < cur.wf;
    stages.push({ term: `+ ${def.term}`, loo: round3(loo), wf: round3(wf), kept: keep });
    if (keep) {
      kept.push(def.stage);
      cur = { loo, wf };
    }
  }
  const control = controlMiss(peers, all, wfTrain, wfTest);
  stages.push({ term: 'control: slug length', loo: round3(control.loo), wf: round3(control.wf), kept: false, control: true });
  const fit = fitValueModel(peers, asOf, all, kept);
  // Leave-one-out residuals of the final model, for the range bands.
  const looResiduals: number[] = [];
  const looPreds: number[] = [];
  for (const i of all) {
    const f = fitValueModel(peers, asOf, all.filter((j) => j !== i), kept);
    const pred = predictLogMultiple(valueFeatures(peers[i]!, asOf, f), f);
    looPreds.push(pred);
    looResiduals.push(ys[i]! - pred);
  }
  const sortedResid = [...looResiduals].sort((a, b) => a - b);
  const q10 = quantile(sortedResid, 0.1);
  const q25 = quantile(sortedResid, 0.25);
  const q75 = quantile(sortedResid, 0.75);
  const q90 = quantile(sortedResid, 0.9);
  // Range honesty, held out: each peer's band uses the quantiles of the OTHER peers' residuals.
  const shareInside = (lo: number, hi: number, preds: number[], actual: number[], residPool: number[][]): number => {
    let inside = 0;
    for (let k = 0; k < preds.length; k++) {
      const pool = [...residPool[k]!].sort((a, b) => a - b);
      const bandLo = preds[k]! + quantile(pool, lo);
      const bandHi = preds[k]! + quantile(pool, hi);
      if (actual[k]! >= bandLo && actual[k]! <= bandHi) inside += 1;
    }
    return inside / preds.length;
  };
  const looPools = all.map((_, k) => looResiduals.filter((_, j) => j !== k));
  const p25_75_loo = shareInside(0.25, 0.75, looPreds, ys, looPools);
  const p10_90_loo = shareInside(0.1, 0.9, looPreds, ys, looPools);
  // Walk-forward honesty: bands from the train fit's leave-one-out residuals.
  const trainResid: number[] = [];
  for (const i of wfTrain) {
    const f = fitValueModel(peers, asOf, wfTrain.filter((j) => j !== i), kept);
    trainResid.push(ys[i]! - predictLogMultiple(valueFeatures(peers[i]!, asOf, f), f));
  }
  const trainSorted = [...trainResid].sort((a, b) => a - b);
  const wfFit = fitValueModel(peers, asOf, wfTrain, kept);
  const wfPreds = wfTest.map((i) => predictLogMultiple(valueFeatures(peers[i]!, asOf, wfFit), wfFit));
  const wfAct = wfTest.map((i) => ys[i]!);
  const insideWf = (lo: number, hi: number): number => {
    let inside = 0;
    for (let k = 0; k < wfPreds.length; k++) {
      if (wfAct[k]! >= wfPreds[k]! + quantile(trainSorted, lo) && wfAct[k]! <= wfPreds[k]! + quantile(trainSorted, hi)) inside += 1;
    }
    return inside / wfPreds.length;
  };
  const validation: ValueValidation = {
    peers: peers.length,
    dated_peers: datedSorted.length,
    flat_loo: round3(flatLoo),
    flat_wf: round3(flatWf),
    loo_miss: round3(cur.loo),
    wf_miss: round3(cur.wf),
    stages,
    kept_terms: kept.map((s) => stageDefs.find((d) => d.stage === s)!.term),
    residual_q10: round3(q10),
    residual_q25: round3(q25),
    residual_q75: round3(q75),
    residual_q90: round3(q90),
    range_p25_75_loo: round3(p25_75_loo),
    range_p10_90_loo: round3(p10_90_loo),
    range_p25_75_wf: round3(insideWf(0.25, 0.75)),
    range_p10_90_wf: round3(insideWf(0.1, 0.9)),
  };
  return { validation, fit, looResiduals, residualQuantiles: { q10, q25, q75, q90 } };
}

// ------------------------------------------------------------------ odds model

const ODDS_TERMS = ['age', 'share', 'size', 'growth'] as const;
type OddsTerm = (typeof ODDS_TERMS)[number];

interface OddsFeatures {
  age: number; // log(age in days + 1)
  share: number; // the category's token share, leaving the protocol itself out
  size: number; // log TVL
  growth: number; // clamped 7-day change / 100
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
}

/** The category token shares of the whole snapshot, leaving a protocol itself out. */
export function categoryShares(snapshot: SnapFile): Map<string, { total: number; withToken: number }> {
  const stats = new Map<string, { total: number; withToken: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Uncategorized';
    const e = stats.get(key) ?? { total: 0, withToken: 0 };
    e.total += 1;
    if (hasToken(p)) e.withToken += 1;
    stats.set(key, e);
  }
  return stats;
}

/** A protocol's category token share, leaving itself out (its own token status does not count). */
export function categoryShare(p: SnapProtocol, stats: Map<string, { total: number; withToken: number }>): number {
  const e = stats.get(p.category ?? 'Uncategorized');
  if (e === undefined || e.total <= 1) return 0.5;
  return (e.withToken - (hasToken(p) ? 1 : 0)) / (e.total - 1);
}

function oddsFeatures(p: SnapProtocol, asOf: string, stats: Map<string, { total: number; withToken: number }>): OddsFeatures {
  const age = daysSince(asOf, p.listed_at);
  return {
    age: Math.log((age ?? 0) + 1),
    share: categoryShare(p, stats),
    size: Math.log(p.tvl_usd),
    growth: clamp(asNumber(p.change_7d, 0), -50, 100) / 100,
  };
}

interface FittedOdds {
  weights: number[]; // bias, then one per kept term in order
  means: Record<string, number>;
  sds: Record<string, number>;
  terms: OddsTerm[];
  stats: Map<string, { total: number; withToken: number }>;
  medianAge: number;
}

/** Logistic regression by plain gradient descent: fixed start, fixed steps, deterministic. */
function fitLogistic(
  rows: { p: SnapProtocol; y: number }[],
  asOf: string,
  stats: Map<string, { total: number; withToken: number }>,
  terms: OddsTerm[],
  iterations = 800,
  learningRate = 0.5,
  l2 = 1.0,
): FittedOdds {
  const feats = rows.map((r) => oddsFeatures(r.p, asOf, stats));
  const means: Record<string, number> = {};
  const sds: Record<string, number> = {};
  for (const k of ODDS_TERMS) {
    const vs = feats.map((f) => f[k]);
    means[k] = mean(vs);
    sds[k] = Math.sqrt(mean(vs.map((v) => (v - means[k]!) ** 2))) || 1;
  }
  const x = rows.map((_, i) => [1, ...terms.map((k) => (feats[i]![k] - means[k]!) / sds[k]!)]);
  const y = rows.map((r) => r.y);
  const w: number[] = Array<number>(1 + terms.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    const g: number[] = Array<number>(w.length).fill(0);
    for (let i = 0; i < x.length; i++) {
      const z = x[i]!.reduce((s, v, j) => s + v * w[j]!, 0);
      const err = sigmoid(z) - y[i]!;
      for (let j = 0; j < w.length; j++) g[j]! += err * x[i]![j]!;
    }
    for (let j = 0; j < w.length; j++) w[j]! -= learningRate * (g[j]! / x.length + (j === 0 ? 0 : (l2 * w[j]!) / x.length));
  }
  const datedAges = rows.map((r) => daysSince(asOf, r.p.listed_at)).filter((a): a is number => a !== null);
  return { weights: w, means, sds, terms, stats, medianAge: datedAges.length > 0 ? median(datedAges) : 365 };
}

/** The fitted cumulative launch curve at a given age, for a protocol's other features. */
function oddsAtAge(ageDays: number, share: number, size: number, growth: number, model: FittedOdds): number {
  const f: OddsFeatures = { age: Math.log(ageDays + 1), share, size: Math.log(size), growth };
  let z = model.weights[0]!;
  model.terms.forEach((k, j) => {
    z += model.weights[j + 1]! * ((f[k] - model.means[k]!) / model.sds[k]!);
  });
  return sigmoid(z);
}

/**
 * A row's token odds: the chance of a token within ODDS_HORIZON_DAYS, given
 * no token yet at its age. For a protocol with no listing date the board's
 * median age is used, and the page says so.
 */
export function conditionalOdds(p: SnapProtocol, asOf: string, model: FittedOdds): number {
  const age = daysSince(asOf, p.listed_at) ?? model.medianAge;
  const share = categoryShare(p, model.stats);
  const fNow = oddsAtAge(age, share, p.tvl_usd, clamp(asNumber(p.change_7d, 0), -50, 100) / 100, model);
  const fLater = oddsAtAge(age + ODDS_HORIZON_DAYS, share, p.tvl_usd, clamp(asNumber(p.change_7d, 0), -50, 100) / 100, model);
  return clamp((fLater - fNow) / (1 - fNow), ODDS_LOW, ODDS_HIGH);
}

export interface OddsFitResult {
  validation: OddsValidation;
  model: FittedOdds;
}

/** Fit the odds model with held-out term selection, and measure it honestly. */
export function evaluateOddsModel(snapshot: SnapFile): OddsFitResult {
  const asOf = snapshot.as_of;
  const stats = categoryShares(snapshot);
  const dated = snapshot.protocols.filter((p) => p.listed_at !== null);
  const rows = dated.map((p) => ({ p, y: hasToken(p) ? 1 : 0 }));
  const baseRate = mean(rows.map((r) => r.y));
  const brier = (preds: number[], ys: number[]): number => mean(preds.map((pr, i) => (pr - ys[i]!) ** 2));
  const foldOf = (p: SnapProtocol): number => {
    let h = 0;
    for (const c of p.slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 10;
  };
  const cvBrier = (terms: OddsTerm[]): number => {
    const preds: number[] = Array<number>(rows.length).fill(0);
    for (let f = 0; f < 10; f++) {
      const train = rows.filter((r) => foldOf(r.p) !== f);
      const test = rows.filter((r) => foldOf(r.p) === f);
      const m = fitLogistic(train, asOf, stats, terms);
      for (const r of test) preds[rows.indexOf(r)] = oddsAtAge(
        daysSince(asOf, r.p.listed_at) ?? m.medianAge,
        categoryShare(r.p, stats),
        r.p.tvl_usd,
        clamp(asNumber(r.p.change_7d, 0), -50, 100) / 100,
        m,
      );
    }
    return brier(preds, rows.map((r) => r.y));
  };
  const sorted = [...rows].sort((a, b) => {
    const d = a.p.listed_at!.localeCompare(b.p.listed_at!);
    return d !== 0 ? d : a.p.slug.localeCompare(b.p.slug);
  });
  const cut = Math.floor(sorted.length / 2);
  const wfTrain = sorted.slice(0, cut);
  const wfTest = sorted.slice(cut);
  const wfBrier = (terms: OddsTerm[]): number => {
    const m = fitLogistic(wfTrain, asOf, stats, terms);
    return brier(
      wfTest.map((r) =>
        oddsAtAge(
          daysSince(asOf, r.p.listed_at) ?? m.medianAge,
          categoryShare(r.p, stats),
          r.p.tvl_usd,
          clamp(asNumber(r.p.change_7d, 0), -50, 100) / 100,
          m,
        ),
      ),
      wfTest.map((r) => r.y),
    );
  };
  const baseBrierCv = brier(rows.map(() => baseRate), rows.map((r) => r.y));
  const trainRate = mean(wfTrain.map((r) => r.y));
  const baseBrierWf = brier(wfTest.map(() => trainRate), wfTest.map((r) => r.y));
  const termNames: Record<OddsTerm, string> = {
    age: 'age, log days listed',
    share: 'category token share',
    size: 'size, log TVL',
    growth: '7-day TVL growth',
  };
  const stages: OddsStageRow[] = [{ term: 'base rate only', cv: round4(baseBrierCv), wf: round4(baseBrierWf), kept: true }];
  const kept: OddsTerm[] = [];
  let cur = { cv: baseBrierCv, wf: baseBrierWf };
  for (const term of ODDS_TERMS) {
    const trial = [...kept, term];
    const cv = cvBrier(trial);
    const wf = wfBrier(trial);
    const keep = cv < cur.cv && wf < cur.wf;
    stages.push({ term: `+ ${termNames[term]}`, cv: round4(cv), wf: round4(wf), kept: keep });
    if (keep) {
      kept.push(term);
      cur = { cv, wf };
    }
  }
  const model = fitLogistic(rows, asOf, stats, kept);
  const validation: OddsValidation = {
    peers: dated.length,
    base_rate: round4(baseRate),
    base_brier_cv: round4(baseBrierCv),
    base_brier_wf: round4(baseBrierWf),
    brier_cv: round4(cur.cv),
    brier_wf: round4(cur.wf),
    stages,
    kept_terms: kept.map((t) => termNames[t]),
    weights: model.weights.map((w) => round4(w)),
    means: Object.fromEntries(Object.entries(model.means).map(([k, v]) => [k, round4(v)])),
    sds: Object.fromEntries(Object.entries(model.sds).map(([k, v]) => [k, round4(v)])),
  };
  return { validation, model };
}

// ------------------------------------------------------------------ farm economics

export function gasOf(chain: string): number {
  return GAS_BY_CHAIN[chain] ?? GAS_DEFAULT;
}

/** The hold, in days, from the protocol's no-token age (v1's rule, kept). */
export function holdDays(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 90;
  if (ageDays < 365) return 60;
  if (ageDays < 730) return 45;
  return 30;
}

function money(n: number): string {
  if (n < 10 && n % 1 !== 0) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function primaryChain(p: SnapProtocol): string {
  return p.chains[0] ?? 'its chain';
}

function chainList(p: SnapProtocol): string {
  return p.chains.length > 0 ? p.chains.slice(0, 3).join(', ') : 'its chain';
}

function walletKind(p: SnapProtocol): string {
  if (p.chains.length === 1) return 'a hardware wallet for the one chain it runs on';
  if (p.chains.includes('Ethereum')) return 'a hardware wallet for Ethereum and the chain you actually use';
  if (p.chains.includes('Solana')) return 'a hardware wallet for Solana and the chain you actually use';
  return 'a hardware wallet for the chain you actually use';
}

function coreAction(p: SnapProtocol): string {
  if (p.category === 'Lending') return `supply USDC to the ${p.name} lending pool and borrow back a little against it, so you are both a lender and a borrower`;
  if (p.category === 'Dexs') return `swap a small amount through ${p.name} twice, in opposite directions, so the trades touch the pool but cancel out`;
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking') return `stake the minimum the pool accepts and hold the receipt token for the full hold`;
  if (p.category === 'Yield' || p.category === 'Yield Aggregator') return `deposit into the ${p.name} vault and leave the position alone for the full hold`;
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return `bridge a small amount in and back out once, so you have a deposit and a withdrawal on record`;
  if (p.category === 'RWA') return `buy the smallest tokenised position ${p.name} offers and hold it for the full hold`;
  if (p.category === 'Payments') return `send one real payment through ${p.name} to a second wallet you control, and keep the receipt`;
  if (p.category === 'Derivatives') return `open the smallest position ${p.name} allows and close it at a small profit or loss, so the position is real`;
  return `use ${p.name} once for its core function, with a real deposit, and leave the position open for the full hold`;
}

function secondAction(p: SnapProtocol): string {
  if (p.chains.length > 1) return `repeat the same deposit on a second chain, ${p.chains[1]}, so your footprint is not single-chain`;
  if (p.category === 'Lending') return `repay the borrow, wait a day, then borrow a little again, so the loan is active across two periods`;
  return `add a second, smaller deposit a week later, so the account shows more than one funding`;
}

function holdingPoint(p: SnapProtocol, hold: number): string {
  const chain = primaryChain(p);
  return `leave the position untouched for the rest of the ${hold}-day hold. ${p.name} is a no-token protocol, so the only thing a launch can reward is a position that was open before it — closing early throws that away, and a bridge out to ${chain} before the hold ends is the classic way to be filtered as a tourist`;
}

function claimStep(p: SnapProtocol): string {
  return `if ${p.name} announces a token, claim from the official site only, through the same wallet that held the position. Never sign a claim link from a chat room or a search ad; the first week of a launch is when the drainer links are thickest`;
}

function unwindStep(p: SnapProtocol): string {
  return `write down what you spent, what you received, and whether the drop covered it, then withdraw the plan from ${p.name} and move it to the next row on the board. A farm that never unwinds is a deposit, not a farm`;
}

/** The seven farm steps for a row, with the gas and minutes each one spends. */
export function farmPlan(p: SnapProtocol, ageDays: number | null): PlanStep[] {
  const hold = holdDays(ageDays);
  const chain = primaryChain(p);
  const gas = gasOf(chain);
  const weeks = Math.ceil(hold / 7);
  const weekly = Math.min(weeks, 4);
  const monthly = hold > 28 ? Math.ceil((hold - 28) / 30) : 0;
  const actions = weekly + monthly;
  const actionGas = Math.round(gas * actions * 100) / 100;
  const steps: PlanStep[] = [
    {
      text: `Set up ${walletKind(p)} and fund it with the $10,000 plan, keeping about $100 aside for gas. Write the seed phrase on paper and store it offline; a wallet that has never held the protocol's chain is the first filter`,
      cost: 'nothing to open',
      time: '5 minutes',
      gasUsd: 0,
      minutes: 5,
    },
    {
      text: `${coreAction(p)} on ${chain}. The deposit is the $10,000 plan minus the gas reserve, and it stays in for the whole ${hold}-day hold`,
      cost: `about ${money(gas)} of gas`,
      time: '15 minutes',
      gasUsd: gas,
      minutes: 15,
    },
    {
      text: `${secondAction(p)} on ${chainList(p)}`,
      cost: `about ${money(gas)} of gas`,
      time: '10 minutes',
      gasUsd: gas,
      minutes: 10,
    },
    {
      text: `Do one qualifying action each week for the first month, then once a month until the hold ends, on ${chain} — a swap, a supply, a vote, whatever the protocol rewards, never the same action twice running. ${actions} actions in total across the hold`,
      cost: `about ${money(actionGas)} of gas across ${actions} transactions`,
      time: `${10 * actions} minutes across the hold`,
      gasUsd: actionGas,
      minutes: 10 * actions,
    },
    {
      text: holdingPoint(p, hold),
      cost: 'nothing',
      time: `${hold} days`,
      gasUsd: 0,
      minutes: 0,
    },
    {
      text: claimStep(p),
      cost: `about ${money(gas)} of gas`,
      time: '10 minutes',
      gasUsd: gas,
      minutes: 10,
    },
    {
      text: unwindStep(p),
      cost: `about ${money(gas)} of gas`,
      time: '5 minutes',
      gasUsd: gas,
      minutes: 5,
    },
  ];
  return steps;
}

function farmVerdict(netUsd: number, netPerHour: number): 'FARM' | 'MARGINAL' | 'SKIP' {
  if (netUsd >= FARM_NET_MIN && netPerHour >= HOUR_RATE) return 'FARM';
  if (netUsd >= 0) return 'MARGINAL';
  return 'SKIP';
}

function whyNow(p: SnapProtocol, ageDays: number | null, odds: number, mult: number): string {
  const ageText = ageDays === null ? 'with no listing date recorded' : `after ${ageDays} days with no token`;
  const change = p.change_7d;
  const changeText =
    change === null ? 'no 7-day change recorded' : change > 0 ? `TVL up ${Math.abs(change).toFixed(2)}% in 7 days` : `TVL down ${Math.abs(change).toFixed(2)}% in 7 days`;
  return `${p.name} holds ${money(p.tvl_usd)} of TVL, ${ageText}, ${changeText}. The fitted multiple for a protocol this size is ${mult.toFixed(3)}x, and the chance of a token within 24 months is ${(odds * 100).toFixed(0)}% — so a launch is worth ${money(p.tvl_usd * mult)} if it comes, and the farm is priced on that, not on the protocol's name.`;
}

function riskList(p: SnapProtocol, ageDays: number | null): string[] {
  const risks: string[] = [];
  if (ageDays !== null && ageDays > 730) risks.push('Old and still tokenless: protocols that have waited this long usually stay tokenless.');
  if (ageDays !== null && ageDays < 90) risks.push('Very young: the protocol may still be finding its users, and a launch this early is rarer.');
  if (ageDays === null) risks.push('No listing date is recorded, so the age, the odds and the hold are all read off the board median, not this protocol.');
  const change = p.change_7d;
  if (change !== null && change < -10) risks.push(`TVL fell ${Math.abs(change).toFixed(2)}% in 7 days: the protocol is shrinking, and a launch may be a long way off.`);
  if (p.chains.length === 1) risks.push(`Single chain (${p.chains[0]}): one chain's outage or fee spike is the whole farm's risk.`);
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') risks.push('Bridges are often treated as infrastructure, not as launches.');
  if (p.category !== null && p.category.includes('Staking')) risks.push('Staking products often reward the underlying token, not a new one.');
  if (risks.length === 0) risks.push('No single red flag stands out in the snapshot; the usual risks still apply — a launch may never come, and the drop may be worth less than the fees.');
  return risks;
}

// ------------------------------------------------------------------ live tokens

const LIVE_EXCLUDE_CATEGORIES = new Set(['CEX']);

/** The biggest traded tokens, largest first, for the "already trades" section. */
export function liveRows(snapshot: SnapFile): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== null && !LIVE_EXCLUDE_CATEGORIES.has(p.category))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

// ------------------------------------------------------------------ the board

export interface BuildRadarResult {
  rows: BoardRow[];
  data: RadarData;
}

export function buildRadar(snapshot: SnapFile): BuildRadarResult {
  const asOf = snapshot.as_of;
  const value = evaluateValueModel(snapshot);
  const odds = evaluateOddsModel(snapshot);
  const peers = valuePeers(snapshot);
  const stats = categoryShares(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const eligible = snapshot.protocols.filter(isEligible).sort((a, b) => b.tvl_usd - a.tvl_usd);
  const rows: RadarRow[] = [];
  for (const p of eligible) {
    const age = daysSince(asOf, p.listed_at);
    const mult = fittedMultiple(p, asOf, value.fit);
    const launch = p.tvl_usd * mult;
    const tokenOdds = conditionalOdds(p, asOf, odds.model);
    const implied = Math.round(launch * tokenOdds);
    const rq = value.residualQuantiles;
    const range = (quant: number): number => Math.round(launch * Math.exp(quant) * tokenOdds);
    const planSteps = farmPlan(p, age);
    const gas = round2(planSteps.reduce((s, st) => s + st.gasUsd, 0));
    const minutes = planSteps.reduce((s, st) => s + st.minutes, 0);
    const hours = round2(minutes / 60);
    const drop = round2((PLAN_USD * implied) / p.tvl_usd * DROP_SHARE);
    const net = round2(drop - gas);
    const netPerHour = round2(net / hours);
    const verdict = farmVerdict(net, netPerHour);
    const hold = holdDays(age);
    const feat = valueFeatures(p, asOf, value.fit);
    const breakdown: ValueBreakdown = {
      multiple: round4(mult),
      launch_value_usd: Math.round(launch),
      token_odds: round4(tokenOdds),
      size_log_mult: round4(value.fit.size === null ? 0 : value.fit.size[1]! * feat.logTvlC),
      chains_log_mult: round4(value.fit.chains === null ? 0 : value.fit.chains * feat.logChainsC),
      growth_log_mult: round4(value.fit.growth === null ? 0 : value.fit.growth * feat.growth),
      age_days: age,
    };
    const plan: FarmPlan = {
      steps: planSteps,
      plan_usd: PLAN_USD,
      drop_usd: drop,
      gas_usd: gas,
      hours,
      net_usd: net,
      net_per_hour_usd: netPerHour,
      verdict,
      hold_days: hold,
    };
    rows.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: implied,
      launch_value_usd: Math.round(launch),
      token_odds: round4(tokenOdds),
      range_lo_usd: range(rq.q25),
      range_hi_usd: range(rq.q75),
      range_lo90_usd: range(rq.q10),
      range_hi90_usd: range(rq.q90),
      verdict,
      drop_usd: drop,
      gas_usd: gas,
      hours,
      net_usd: net,
      net_per_hour_usd: netPerHour,
      hold_days: hold,
      multiple: round4(mult),
      why_now: whyNow(p, age, tokenOdds, mult),
      risks: riskList(p, age),
      model: breakdown,
      farm_steps: planSteps.map((s) => `${s.text} (Cost: ${s.cost}; time: ${s.time}.)`),
      watchlist: watchlist.has(p.slug),
      plan,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  // The checksum and the board total are the same in both files, so a reader
  // can check the board has not been edited after it was built.
  const checksum = fnv1aHex(rows.map((r) => `${r.slug}:${r.implied_value_usd}`).join('\n') + '\n');
  const boardTotal = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  // The accounting ledger: every protocol in exactly one group.
  const accounting: AccountingGroup[] = [{ label: 'Ranked as pre-token', count: rows.length }];
  const tokenCount = snapshot.protocols.filter(hasToken).length;
  accounting.push({ label: 'Already record a token', count: tokenCount });
  const excluded = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) && !canLaunch(p)) {
      const reason = exclusionReason(p);
      excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
    }
  }
  const excludedSorted = [...excluded.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [reason, count] of excludedSorted) accounting.push({ label: `Left out: ${reason}`, count });
  // The category table: the peers' median multiple and the category's token
  // share, descriptive only — the fitted model does not use category.
  const overallMultiple = median(peers.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategory = new Map<string, SnapProtocol[]>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Uncategorized';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  const calibration: CategoryCalibration[] = [...byCategory.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, list]) => {
      const catPeers = list.filter((p) => peers.includes(p)).sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
      const multiple = catPeers.length > 0 ? median(catPeers.map((p) => p.mcap_usd! / p.tvl_usd)) : overallMultiple;
      const share = list.filter(hasToken).length / list.length;
      return {
        category,
        peers: catPeers.length,
        multiple: round4(multiple),
        token_share: round4(share),
        examples: catPeers.slice(0, 3).map((p) => ({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd, multiple: round4(p.mcap_usd! / p.tvl_usd) })),
      };
    });
  const valueFit = value.fit;
  const oddsModel = odds.model;
  // The model params are carried at full precision: the page recomputes
  // each row from them, and a rounded coefficient would move a $19M row by
  // hundreds of dollars. The evidence tables print the same numbers rounded.
  const oddsShareMap: Record<string, number> = {};
  for (const [cat, st] of stats) {
    oddsShareMap[cat] = st.total > 1 ? st.withToken / (st.total - 1) : 0.5;
  }
  const modelParams: ModelParams = {
    value_intercept: valueFit.size === null ? valueFit.flat : valueFit.size[0]!,
    value_size_slope: valueFit.size === null ? 0 : valueFit.size[1]!,
    value_mean_log_tvl: valueFit.meanLogTvl,
    value_cat: valueFit.cat === null ? null : Object.fromEntries(valueFit.cat),
    value_growth_coef: valueFit.growth === null ? 0 : valueFit.growth,
    value_age_coef: valueFit.age === null ? 0 : valueFit.age,
    value_mean_log_age: valueFit.meanLogAge,
    value_chains_coef: valueFit.chains === null ? 0 : valueFit.chains,
    value_mean_log_chains: valueFit.meanLogChains,
    multiple_low: MULTIPLE_LOW,
    multiple_high: MULTIPLE_HIGH,
    residual_q10: value.residualQuantiles.q10,
    residual_q25: value.residualQuantiles.q25,
    residual_q75: value.residualQuantiles.q75,
    residual_q90: value.residualQuantiles.q90,
    odds_weights: oddsModel.weights,
    odds_means: oddsModel.means,
    odds_sds: oddsModel.sds,
    odds_terms: oddsModel.terms,
    odds_category_share: oddsShareMap,
    odds_median_age: oddsModel.medianAge,
    odds_horizon_days: ODDS_HORIZON_DAYS,
  };
  const early = rows.filter((r) => r.age_days !== null && r.age_days < 180).length;
  const data: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    economics: {
      plan_usd: PLAN_USD,
      drop_share: DROP_SHARE,
      hour_rate: HOUR_RATE,
      farm_net_min: FARM_NET_MIN,
      gas_by_chain: GAS_BY_CHAIN,
      gas_default: GAS_DEFAULT,
      hold_rule: 'under 180 days: 90; under 365: 60; under 730: 45; older: 30; no date: 45',
    },
    value_validation: value.validation,
    odds_validation: odds.validation,
    accounting,
    checksum,
    board_total_usd: boardTotal,
    overall_multiple: round4(overallMultiple),
    calibration,
    watchlist_size: rows.filter((r) => r.watchlist).length,
    board_size: rows.length,
    early_size: early,
    live_size: LIVE_ROWS,
    model_params: modelParams,
    rows,
    live: liveRows(snapshot),
  };
  return { rows, data };
}

// ------------------------------------------------------------------ input and output

export function parseSnapshot(data: unknown): SnapFile {
  if (typeof data !== 'object' || data === null) throw new SnapshotShapeError('snapshot root is not an object');
  const root = data as Record<string, unknown>;
  const asOf = root.as_of;
  const source = root.source;
  const floorUsd = root.floor_usd;
  const protocols = root.protocols;
  const watchlist = root.watchlist;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotShapeError('snapshot as_of is missing or not a date');
  if (typeof source !== 'string' || source.trim() === '') throw new SnapshotShapeError('snapshot source is missing');
  if (typeof floorUsd !== 'number' || !Number.isFinite(floorUsd) || floorUsd <= 0) throw new SnapshotShapeError('snapshot floor_usd is missing or not a positive number');
  if (!Array.isArray(protocols)) throw new SnapshotShapeError('snapshot protocols is not an array');
  if (!Array.isArray(watchlist) || !watchlist.every((slug) => typeof slug === 'string')) throw new SnapshotShapeError('snapshot watchlist is not an array of slugs');
  const snapshot: SnapFile = { as_of: asOf, source, floor_usd: floorUsd, protocols: [], watchlist: watchlist as string[] };
  const seenSlugs = new Set<string>();
  protocols.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new SnapshotShapeError(`protocol ${index} is not an object`);
    const item = entry as Record<string, unknown>;
    const slug = item.slug;
    const name = item.name;
    const chains = item.chains;
    const tvl = item.tvl_usd;
    if (typeof slug !== 'string' || slug.trim() === '') throw new SnapshotShapeError(`protocol ${index} has no slug`);
    if (seenSlugs.has(slug)) throw new SnapshotShapeError(`protocol slug ${slug} appears twice`);
    seenSlugs.add(slug);
    if (typeof name !== 'string' || name.trim() === '') throw new SnapshotShapeError(`protocol ${slug} has no name`);
    if (!Array.isArray(chains) || !chains.every((chain) => typeof chain === 'string')) throw new SnapshotShapeError(`protocol ${slug} has no chains array`);
    if (typeof tvl !== 'number' || !Number.isFinite(tvl) || tvl < 0) throw new SnapshotShapeError(`protocol ${slug} has no TVL`);
    const nullableString = (value: unknown): string | null => (value === null || value === undefined ? null : typeof value === 'string' ? value : null);
    const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : typeof value === 'number' && Number.isFinite(value) ? value : null);
    const category = nullableString(item.category);
    if (item.category !== null && item.category !== undefined && category === null) throw new SnapshotShapeError(`protocol ${slug} has a non-string category`);
    const listedAt = nullableString(item.listed_at);
    if (item.listed_at !== null && item.listed_at !== undefined && listedAt === null) throw new SnapshotShapeError(`protocol ${slug} has a non-string listed_at`);
    if (listedAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(listedAt)) throw new SnapshotShapeError(`protocol ${slug} has a listed_at that is not a date`);
    snapshot.protocols.push({
      slug,
      name,
      category,
      chains: chains as string[],
      tvl_usd: tvl,
      change_7d: nullableNumber(item.change_7d),
      mcap_usd: nullableNumber(item.mcap_usd),
      listed_at: listedAt,
      gecko_id: nullableString(item.gecko_id),
      symbol: nullableString(item.symbol),
    });
  });
  return snapshot;
}

export function boardIssue(snapshot: SnapFile, board: BoardRow[], checksum: string, total: number): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, expected 100-4000`;
  if (board.some((row) => row.token_status !== 'pre-token')) return 'board contains a protocol that records a token';
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i + 1} has rank ${row.rank}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `row ${row.slug} has a farm step of ${step.length} characters`;
    }
    if (i > 0 && board[i - 1]!.implied_value_usd < row.implied_value_usd) return `row ${row.slug} is out of order`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 0 || row.implied_value_usd > IMPLIED_CAP) {
      return `row ${row.slug} has an invalid implied value ${row.implied_value_usd}`;
    }
  }
  const actualChecksum = fnv1aHex(board.map((r) => `${r.slug}:${r.implied_value_usd}`).join('\n') + '\n');
  if (actualChecksum !== checksum) return 'board checksum does not match';
  const actualTotal = board.reduce((s, r) => s + r.implied_value_usd, 0);
  if (actualTotal !== total) return 'board total does not match';
  const watchlistSlugs = snapshot.watchlist.filter((slug) => board.some((row) => row.slug === slug));
  if (watchlistSlugs.length !== snapshot.watchlist.length) return `board covers ${watchlistSlugs.length} of ${snapshot.watchlist.length} watchlist slugs`;
  return null;
}

/** The JSON text of `window.TOKEN_RADAR`, written into the output's data.js. */
export function radarScript(data: RadarData): string {
  return `window.TOKEN_RADAR = ${JSON.stringify(data, null, 2)};\n`;
}
