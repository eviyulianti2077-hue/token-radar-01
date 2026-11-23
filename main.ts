import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DAY_MS = 86_400_000;
const MODEL = {
  base_multiple: 0.22,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.62,
  maturity_range: 0.38,
  maturity_days: 1460,
  unknown_age_days: 540,
};
const MODEL_VERSION = 'radar-2';
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MAX_IMAGE_BYTES = 524_288;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSnapshot(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`snapshot JSON error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value) || typeof value.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.as_of) ||
      typeof value.source !== 'string' || typeof value.floor_usd !== 'number' ||
      !Number.isSafeInteger(value.floor_usd) || value.floor_usd <= 0 ||
      !Array.isArray(value.protocols) || !Array.isArray(value.watchlist)) {
    throw new Error('snapshot header or arrays are invalid');
  }

  const protocols = value.protocols.map((protocol, index) => {
    if (!isRecord(protocol) || typeof protocol.slug !== 'string' || !protocol.slug ||
        /\s/.test(protocol.slug) || typeof protocol.name !== 'string' || !protocol.name.trim() ||
        typeof protocol.tvl_usd !== 'number' || !Number.isFinite(protocol.tvl_usd) || protocol.tvl_usd < 0) {
      throw new Error(`invalid protocol at index ${index}`);
    }
    if (protocol.category !== null && typeof protocol.category !== 'string') throw new Error(`invalid category for ${protocol.slug}`);
    if (!Array.isArray(protocol.chains) || protocol.chains.some((chain) => typeof chain !== 'string')) {
      throw new Error(`invalid chains for ${protocol.slug}`);
    }
    for (const field of ['change_7d', 'mcap_usd'] as const) {
      if (protocol[field] !== null && (typeof protocol[field] !== 'number' || !Number.isFinite(protocol[field]))) {
        throw new Error(`invalid ${field} for ${protocol.slug}`);
      }
    }
    for (const field of ['listed_at', 'gecko_id', 'symbol'] as const) {
      if (protocol[field] !== null && typeof protocol[field] !== 'string') throw new Error(`invalid ${field} for ${protocol.slug}`);
    }
    return {
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      change_7d: protocol.change_7d,
      mcap_usd: protocol.mcap_usd,
      listed_at: protocol.listed_at,
      gecko_id: protocol.gecko_id,
      symbol: protocol.symbol,
    };
  });
  const bySlug = new Map(protocols.map((protocol) => [protocol.slug, protocol]));
  if (bySlug.size !== protocols.length) throw new Error('snapshot contains duplicate protocol slugs');
  if (value.watchlist.some((slug) => typeof slug !== 'string' || !bySlug.has(slug))) {
    throw new Error('watchlist contains an invalid or unknown slug');
  }
  return {
    as_of: value.as_of,
    source: value.source,
    floor_usd: value.floor_usd,
    protocols,
    watchlist: value.watchlist as string[],
  };
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    if (index + 1 >= process.argv.length || process.argv[index + 1]!.startsWith('--')) throw new Error(`${name} requires a value`);
    return process.argv[index + 1]!;
  }
  const equalsForm = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return equalsForm === undefined ? fallback : equalsForm.slice(name.length + 1);
}

function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null || !/^\d{4}-\d{2}-\d{2}$/.test(listedAt)) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedAtMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedAtMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedAtMs) / DAY_MS));
}

const VERSIONED = /\s(v\d+(?:\.\d+)?|\d+\.\d+)$/i;
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const EXCLUDED_CATEGORIES = new Set(['bridge', 'canonical bridge', 'liquid staking', 'liquid restaking', 'restaked btc', 'cex']);

function isPreToken(protocol: ReturnType<typeof parseSnapshot>['protocols'][number]): boolean {
  return protocol.gecko_id === null && protocol.symbol === null && protocol.mcap_usd === null;
}

function isRankable(protocol: ReturnType<typeof parseSnapshot>['protocols'][number]): boolean {
  return isPreToken(protocol) &&
    !EXCLUDED_CATEGORIES.has((protocol.category ?? '').toLowerCase()) &&
    !VERSIONED.test(protocol.name) &&
    !WRAPPED_OR_STAKED.test(protocol.name) &&
    !EXCHANGE_PREFIX.test(protocol.name);
}

function farmPlan(protocol: ReturnType<typeof parseSnapshot>['protocols'][number]): string[] {
  const chain = protocol.chains[0] ?? 'the protocol\'s supported network';
  const category = (protocol.category ?? '').toLowerCase();
  let action = 'make one small, non-leveraged deposit or swap described in the official docs';
  if (category.includes('lend') || category.includes('cdp')) {
    action = 'supply a small amount of an asset supported by the official lending markets';
  } else if (category.includes('dex') || category.includes('yield')) {
    action = 'make a small swap or provide liquidity only after reviewing pool and impermanent-loss risks';
  } else if (category.includes('perpetual') || category.includes('derivative')) {
    action = 'test the interface without opening leverage, then use a small spot deposit only if documented';
  } else if (category.includes('vault') || category.includes('curator')) {
    action = 'inspect the vault strategy and, if appropriate, deposit a small amount';
  }
  return [
    `Read ${protocol.name}'s official docs and risk disclosures before connecting a wallet. Cost: $0. Time: 10 minutes.`,
    `Verify the official app URL from the protocol's own documentation and confirm ${chain} is supported. Cost: $0. Time: 5 minutes.`,
    `If the risks suit you, ${action} on ${chain}. Keep capital small and assume it can be lost. Cost: gas and at-risk capital. Time: 10-20 minutes.`,
    `Save the transaction ID, amount, date, and any points terms; never sign an unclear message. Cost: $0. Time: 3 minutes.`,
    `After 7 days, check official announcements and repeat only if a real product need justifies it; no token or reward is promised. Cost: variable gas. Time: 5 minutes weekly.`,
  ];
}

function score(protocol: ReturnType<typeof parseSnapshot>['protocols'][number], asOf: string) {
  const age = ageDays(asOf, protocol.listed_at);
  const growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, protocol.change_7d ?? 0));
  const growthMultiplier = 1 + growth / 100 * MODEL.growth_weight;
  const observedAge = age ?? MODEL.unknown_age_days;
  const maturityMultiplier = MODEL.maturity_floor +
    Math.min(Math.max(observedAge, 0), MODEL.maturity_days) / MODEL.maturity_days * MODEL.maturity_range;
  const impliedValue = Math.max(1, Math.min(100_000_000_000_000,
    Math.round(protocol.tvl_usd * MODEL.base_multiple * growthMultiplier * maturityMultiplier)));
  const fieldsPresent = Number(protocol.change_7d !== null) + Number(protocol.listed_at !== null) + Number(protocol.chains.length > 0);
  const evidence = fieldsPresent === 3 ? 'complete' : fieldsPresent === 2 ? 'partial' : 'limited';
  return {
    ...protocol,
    token_status: 'No token recorded (snapshot)',
    age_days: age,
    implied_value_usd: impliedValue,
    growth_multiplier: Math.round(growthMultiplier * 10_000) / 10_000,
    maturity_multiplier: Math.round(maturityMultiplier * 10_000) / 10_000,
    evidence,
    farm_steps: farmPlan(protocol),
  };
}

function buildBoard(snapshot: ReturnType<typeof parseSnapshot>) {
  const index = new Map(snapshot.protocols.map((protocol) => [protocol.slug, protocol]));
  const chosen = new Map<string, (typeof snapshot.protocols)[number]>();
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol && isPreToken(protocol)) chosen.set(slug, protocol);
  }
  const early = snapshot.protocols
    .filter((protocol) => !chosen.has(protocol.slug) && isRankable(protocol) && protocol.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))
    .slice(0, 160);
  for (const protocol of early) chosen.set(protocol.slug, protocol);
  const rows = [...chosen.values()].map((protocol) => score(protocol, snapshot.as_of));
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function copyTree(source: string, destination: string): string[] {
  if (!existsSync(source)) throw new Error(`required directory is missing: ${source}`);
  mkdirSync(destination, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(source).sort()) {
    if (name.startsWith('.')) continue;
    const from = join(source, name);
    const to = join(destination, name);
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error(`refusing symbolic link in ${source}: ${name}`);
    if (stat.isDirectory()) copied.push(...copyTree(from, to));
    else if (stat.isFile()) {
      copyFileSync(from, to);
      copied.push(name);
    } else throw new Error(`unsupported file in ${source}: ${name}`);
  }
  return copied;
}

function validateSourceAssets() {
  const dashboardPath = join(ROOT, 'dashboard');
  const screenshotPath = join(ROOT, 'screenshots');
  if (!existsSync(dashboardPath)) throw new Error(`dashboard directory is missing: ${dashboardPath}`);
  if (!existsSync(screenshotPath)) throw new Error(`screenshots directory is missing: ${screenshotPath}`);
  const dashboardFiles = readdirSync(dashboardPath).filter((name) => !name.startsWith('.'));
  if (!dashboardFiles.includes('index.html') || !dashboardFiles.some((name) => name.endsWith('.css')) ||
      !dashboardFiles.some((name) => name.endsWith('.js'))) {
    throw new Error('dashboard needs index.html, a CSS file, and a JavaScript file');
  }
  const screenshots = readdirSync(screenshotPath).filter((name) => !name.startsWith('.')).sort();
  if (screenshots.length < 3 || screenshots.length > 4) {
    throw new Error(`screenshots must contain 3 to 4 images; found ${screenshots.length}`);
  }
  for (const name of screenshots) {
    if (!IMAGE_NAME.test(name)) throw new Error(`invalid screenshot name: ${name}`);
    const stat = lstatSync(join(screenshotPath, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`screenshots/${name} must be a regular file`);
    if (stat.size > MAX_IMAGE_BYTES) throw new Error(`screenshots/${name} is ${stat.size} bytes; limit is ${MAX_IMAGE_BYTES}`);
  }
  return screenshots;
}

function run(): void {
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith('--') && !['--input', '--output'].includes(argument) &&
        !argument.startsWith('--input=') && !argument.startsWith('--output=')) {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  const inputArg = option('--input', '/input');
  const inputFile = inputArg.toLowerCase().endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) throw new Error(`no snapshot at ${inputFile}; pass --input <snapshot.json|directory>`);
  const out = resolve(option('--output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));
  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const board = buildBoard(snapshot);
  if (board.length < 100 || board.length > 4_000) throw new Error(`board has ${board.length} rows; the gate requires 100 to 4,000`);
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length) throw new Error(`board missed watchlist protocols: ${missing.slice(0, 5).join(', ')}`);
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) throw new Error(`score order failed at rank ${i + 1}`);
  }
  if (board.length > 1 && board.every((row) => row.implied_value_usd === board[0]!.implied_value_usd)) {
    throw new Error('board scores are all identical');
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12 ||
        row.farm_steps.some((step) => step.trim().length < 20 || step.trim().length > 600)) {
      throw new Error(`farm plan is invalid for ${row.slug}`);
    }
  }
  const sourceScreenshots = validateSourceAssets();
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`, 'utf8');
  const live = snapshot.protocols
    .filter((protocol) => !isPreToken(protocol) && protocol.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 12);
  const radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    model_version: MODEL_VERSION,
    model: MODEL,
    total_ranked_tvl_usd: board.reduce((sum, row) => sum + row.tvl_usd, 0),
    rows: board,
    live: live.map((protocol) => ({
      slug: protocol.slug, name: protocol.name, category: protocol.category, chains: protocol.chains,
      tvl_usd: protocol.tvl_usd, mcap_usd: protocol.mcap_usd, change_7d: protocol.change_7d,
    })),
  };
  writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`, 'utf8');
  const dashboardFiles = copyTree(join(ROOT, 'dashboard'), join(out, 'dashboard'));
  const screenshots = copyTree(join(ROOT, 'screenshots'), join(out, 'screenshots'));
  if (screenshots.length !== sourceScreenshots.length) throw new Error('screenshot copy count changed during the build');
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: MAX_IMAGE_BYTES },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }), 'utf8');
  process.stdout.write(`token radar: ${snapshot.protocols.length} snapshot protocols; ${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist covered; ${board.length} ranked rows.\n`);
  process.stdout.write(`token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard (${dashboardFiles.length} files), screenshots (${screenshots.length}), and dossier.json.\n`);
}

if (process.argv.includes('--help')) {
  process.stdout.write('Usage: node main.ts [--input <snapshot.json|directory>] [--output <directory>]\n');
} else {
  try {
    run();
  } catch (error) {
    process.stderr.write(`token radar: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
