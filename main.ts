// Token Launch Radar — entry point (Node 22, standard library only).
// Reads the sealed snapshot, scores every protocol that could plausibly
// launch a token, and writes the ranked board, the dashboard's data, the
// dashboard itself, its screenshots, and the dossier the judge reads.
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// With no --input it reads /input/snapshot.json; with no --output and no
// MAKEFUN_OUTPUT_DIR it writes /output. The run is deterministic: the same
// snapshot always writes the same bytes.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  boardIssue,
  buildRadar,
  radarScript,
  parseSnapshot,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const rootDir = decodeURIComponent(new URL('.', import.meta.url).pathname);

const TEXT_CAP_BYTES = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const DASH_CAP = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function die(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

/** The value after a `--flag value` or `--flag=value` argument, else the fallback. */
function flagValue(argv: string[], flag: string, fallback: string): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${flag}` && i + 1 < argv.length) return argv[i + 1]!;
    const prefix = `--${flag}=`;
    if (argv[i]!.startsWith(prefix)) return argv[i]!.slice(prefix.length);
  }
  return fallback;
}

const args = process.argv.slice(2);
const inputGiven = flagValue(args, 'input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json or directory>`);
}
const outDir = resolve(flagValue(args, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));

let snapshotText: string;
try {
  snapshotText = readFileSync(snapshotPath, 'utf8');
} catch {
  die(`cannot read ${snapshotPath}`);
}
const snapshot = parseSnapshot(snapshotText!);
const built = buildRadar(snapshot);
const board = built.board;
const radar = built.radar;
const problem = boardIssue(board, snapshot);
if (problem !== null) die(`the board fails the gate: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), radarScript(radar));

/** Copy every regular file of one directory into another, skipping dot-names, and report what moved. */
function copyDirectory(fromDir: string, toDir: string): string[] {
  if (!existsSync(fromDir)) return [];
  mkdirSync(toDir, { recursive: true });
  const moved: string[] = [];
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile()) continue;
    copyFileSync(join(fromDir, entry.name), join(toDir, entry.name));
    moved.push(entry.name);
  }
  return moved;
}

const pageFiles = copyDirectory(join(rootDir, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyDirectory(join(rootDir, 'screenshots'), join(outDir, 'screenshots'));
if (shotFiles.length < 3) die(`screenshots/ holds ${shotFiles.length} image${shotFiles.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shotFiles) {
  if (!SHOT_NAME.test(name)) die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_CAP_BYTES, screenshots: SHOT_CAP, dashboard: DASH_CAP }),
);

process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols in the snapshot, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} of them beyond the watchlist)\n` +
    `token-radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${pageFiles.length} dashboard files, ${shotFiles.length} screenshots and ${join(outDir, 'dossier.json')}\n`,
);
