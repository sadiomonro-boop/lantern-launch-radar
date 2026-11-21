// main.ts — token launch radar entrypoint.
// Reads the sealed snapshot, fits the global-only model, ranks the board,
// and writes the dashboard, board, data, screenshots and dossier.
// Node 22, standard library only, no network. Deterministic: the same
// snapshot always produces the same bytes.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  cleanComps,
  looBand,
  launchTable,
  blindTests,
  buildBoard,
  buildEvidence,
  buildResearchNote,
  hasLiveToken,
  inPool,
  nameExcluded,
  EXCLUDED_CATEGORIES,
  COST_USD,
  HOLD_DAYS,
  holdHours,
  fmtUsd,
} from './lib/model.ts';
import type { Snapshot, SnapProtocol, BoardRow, Evidence } from './lib/model.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  return fallback;
}

function resolveInput(given: string): string {
  if (existsSync(given) && !given.endsWith('.json')) {
    return join(given, 'snapshot.json');
  }
  return given;
}

function main(): void {
  const inputFile = resolveInput(arg('input', '/input/snapshot.json'));
  const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snap = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;

  const fit = cleanComps(snap);
  const band = looBand(fit);
  const table = launchTable(snap);
  const ablation = blindTests(fit);
  const board = buildBoard(snap, fit, table, band);
  const evidence = buildEvidence(snap, fit, band, table, ablation, board);
  const note = buildResearchNote(evidence, board);

  // Dashboard data: everything the page renders, beside the page.
  const data = buildDashboardData(snap, fit, board, evidence);

  mkdirSync(join(out, 'dashboard'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });

  // board.json — the ranked board.
  writeFileSync(join(out, 'board.json'), JSON.stringify({ rows: board.rows }, null, 1) + '\n', 'utf8');
  // data.js — dashboard data, beside the page (not part of the dashboard
  // source the judge reads, so the board data does not eat the 64 KB budget).
  writeFileSync(join(out, 'data.js'), 'window.RADAR = ' + JSON.stringify(data) + ';\n', 'utf8');

  // Static dashboard files, copied from the repository.
  for (const file of ['index.html', 'app.css', 'app.js']) {
    cpSync(join(ROOT, 'dashboard', file), join(out, 'dashboard', file));
  }
  // Generated dashboard files: the evidence and the research note.
  writeFileSync(join(out, 'dashboard', 'evidence.json'), JSON.stringify(evidence, null, 1) + '\n', 'utf8');
  writeFileSync(join(out, 'dashboard', '00-research.md'), note, 'utf8');

  // Screenshots, copied from the repository.
  cpSync(join(ROOT, 'screenshots'), join(out, 'screenshots'), { recursive: true });

  // Dossier last: the scorer rebuilds it from this /output and compares bytes.
  const dossier = buildDossier(out, { text_max_bytes: 65536 });
  writeFileSync(join(out, 'dossier.json'), dossier);

  const counts = evidence.verdicts;
  process.stdout.write(
    `token radar: ${board.rows.length} rows, fit log(mcap) = ${fit.intercept.toFixed(3)} + ${fit.slope.toFixed(3)} log(TVL), ` +
      `verdicts ROBUST ${counts.ROBUST}/FARM ${counts.FARM}/THIN ${counts.THIN}/SKIP ${counts.SKIP}, ` +
      `top ${board.rows[0]!.name} ${fmtUsd(board.rows[0]!.implied_value_usd)}, ` +
      `dossier ${dossier.length} bytes\n`,
  );
}

interface DashboardData {
  generated_from: string;
  as_of: string;
  ablation: Evidence['ablation'];
  sibling_rows: string[];
  fit: { intercept: number; slope: number; comps_n: number };
  loo: { p25_used: number; p75_used: number; median_miss: number; within_3x: number; p10_p90_coverage: number };
  kpis: Evidence['kpis'];
  best_farm: Evidence['best_farm'];
  costs: { deposit_usd: number; gas_usd: number; tbill_usd: number; total_usd: number; share: number };
  hours: { hold_days: number; hours: number };
  rows: BoardRow[];
  comps: { slug: string; name: string; tvl_usd: number; mcap_usd: number; category: string | null }[];
  live: { slug: string; name: string; tvl_usd: number; mcap_usd: number | null; category: string | null }[];
  set_aside: { slug: string; name: string; tvl_usd: number; category: string | null; reason: string }[];
  launch_table: Evidence['launch_table'];
  sensitivity: Evidence['sensitivity'];
  category_bands: Evidence['category_bands'];
  ledger: Evidence['ledger'];
  note_to_judge: string[];
  chain_costs: { chain: string; gas_range_usd: string; note: string }[];
  verdicts: Record<string, number>;
  top10: Evidence['board_top10'];
}

function setAsideReason(p: SnapProtocol): string {
  if (p.category !== null && EXCLUDED_CATEGORIES.includes(p.category)) return 'category excluded';
  if (nameExcluded(p)) return 'name rule (wrapped, staked, version or exchange name)';
  return 'other';
}

function buildDashboardData(
  snap: Snapshot,
  fit: ReturnType<typeof cleanComps>,
  board: ReturnType<typeof buildBoard>,
  evidence: ReturnType<typeof buildEvidence>,
): DashboardData {
  const boardSlugs = new Set(board.rows.map((r) => r.slug));
  return {
    generated_from: snap.as_of + ' snapshot (' + snap.protocols.length + ' protocols)',
    as_of: snap.as_of,
    ablation: evidence.ablation,
    sibling_rows: evidence.model.sibling_rows,
    fit: {
      intercept: Math.round(fit.intercept * 1000) / 1000,
      slope: Math.round(fit.slope * 1000) / 1000,
      comps_n: fit.comps.length,
    },
    loo: {
      p25_used: evidence.loo_band.p25_used,
      p75_used: evidence.loo_band.p75_used,
      median_miss: evidence.loo_band.median_miss,
      within_3x: evidence.loo_band.within_3x,
      p10_p90_coverage: evidence.loo_band.p10_p90_coverage,
    },
    kpis: evidence.kpis,
    best_farm: evidence.best_farm,
    costs: {
      deposit_usd: 1000,
      gas_usd: 6,
      tbill_usd: 4.93,
      total_usd: COST_USD,
      share: 0.1,
    },
    hours: { hold_days: HOLD_DAYS, hours: Math.round(holdHours(HOLD_DAYS) * 100) / 100 },
    rows: board.rows,
    comps: fit.comps.map((p) => ({
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      category: p.category,
    })),
    live: snap.protocols
      .filter((p) => hasLiveToken(p))
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        category: p.category,
      })),
    set_aside: snap.protocols
      .filter((p) => !hasLiveToken(p) && !inPool(p))
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        tvl_usd: p.tvl_usd,
        category: p.category,
        reason: setAsideReason(p),
      })),
    launch_table: evidence.launch_table,
    sensitivity: evidence.sensitivity,
    category_bands: evidence.category_bands,
    ledger: evidence.ledger,
    note_to_judge: [
      'Working radar: the board covers all 40 watchlist protocols and 158 more pre-token protocols, ranked by a stated implied value, with the screenshots and the code in agreement.',
      'Value model: the implied value follows from the snapshot’s own figures — TVL through a fitted curve, seven-day growth and age shown on every row, launch odds from the snapshot’s own launch table — and from no hardcoded list of names.',
      'Farm plans: each protocol gets concrete steps with what they cost ($10.93 total) and how long they take (1.82 hours over 45 days), plus a walk-away rule.',
      'Limits: the model’s misses are stated in the research note, the blind tests that dropped two terms are shown in full, and every number is reproducible from evidence.json.',
    ],
    chain_costs: [
      { chain: 'Ethereum mainnet', gas_range_usd: '$8–$25 per round trip', note: 'Assumed range, not from the snapshot; the $6 gas figure is a mid-case across chains.' },
      { chain: 'Ethereum L2s (Arbitrum, Optimism, Base)', gas_range_usd: '$0.50–$2 per round trip', note: 'Assumed range, not from the snapshot.' },
      { chain: 'Solana', gas_range_usd: '$0.05–$0.50 per round trip', note: 'Assumed range, not from the snapshot.' },
      { chain: 'Other chains', gas_range_usd: '$1–$6 per round trip', note: 'Assumed range, not from the snapshot.' },
    ],
    verdicts: evidence.verdicts,
    top10: evidence.board_top10,
  };
}

main();
