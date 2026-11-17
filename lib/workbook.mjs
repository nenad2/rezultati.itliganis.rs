import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { readBracketSheet, resolveBracket } from './playoff.mjs';

export const SHEET_ID = '1Vm22gtDxlSCC-1ssUDSN5yedsiCY9tC-v0aZeDWc_9E';
export const SOURCE_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
export const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
export const REFRESH_MS = 10 * 60 * 1000;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, trimValues: false });
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'object' ? String(value?.['#text'] ?? '') : String(value ?? '');
const richText = node => node?.t != null ? text(node.t) : array(node?.r).map(r => text(r.t)).join('');
const number = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
export const canonical = value => ({ 'htec nis': 'HTEC', 'boopro tech': 'Boopro', dualsoft: 'Dualsoft' }[String(value).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()] ?? String(value).trim());

/** "ODL", "odloženo", "odlozen", "postponed", "PPD" (any case) mark a postponed match. */
export const isPostponed = value => /^\s*(odl|postpon|ppd)/i.test(String(value ?? ''));

export function readWorkbook(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const read = path => { if (!files[path]) throw new Error(`Workbook entry missing: ${path}`); return xml.parse(strFromU8(files[path])); };
  const strings = files['xl/sharedStrings.xml'] ? array(read('xl/sharedStrings.xml').sst.si).map(richText) : [];
  const relations = Object.fromEntries(array(read('xl/_rels/workbook.xml.rels').Relationships.Relationship).map(r => [r['@Id'], r['@Target']]));
  return array(read('xl/workbook.xml').workbook.sheets.sheet).map(sheet => {
    const target = relations[sheet['@r:id']];
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const rows = {};
    for (const row of array(read(path).worksheet.sheetData?.row)) {
      const cells = {};
      for (const cell of array(row.c)) {
        const column = cell['@r'].replace(/\d/g, '');
        cells[column] = cell['@t'] === 's' ? strings[Number(cell.v)] : cell['@t'] === 'inlineStr' ? richText(cell.is) : text(cell.v);
      }
      rows[Number(row['@r'])] = cells;
    }
    return { name: sheet['@name'], rows };
  });
}

export function parseLeague(buffer, fetchedAt = new Date().toISOString()) {
  const sheets = readWorkbook(buffer);
  const main = sheets.find(s => /^Ligaški deo$/i.test(s.name));
  const scorersSheet = sheets.find(s => /Lista strelaca/i.test(s.name));
  const contacts = sheets.find(s => /Kontakt podaci ekipa/i.test(s.name));
  const options = sheets.find(s => s.name === 'Options');
  if (!main || !scorersSheet) throw new Error('Expected league and scorer worksheets were not found.');
  const rows = Object.values(main.rows);
  const teams = rows.filter(r => r.G && r.H && number(r.I) != null && number(r.P) != null).map(r => ({
    rank: Number(r.G), name: canonical(r.H), played: Number(r.I), won: Number(r.J), drawn: Number(r.K), lost: Number(r.L), goalsFor: Number(r.M), goalsAgainst: Number(r.N), goalDifference: Number(r.O), points: Number(r.P),
    form: [], venue: '', kit: '', captain: '', postponed: 0, adjustment: 0,
  })).sort((a, b) => a.rank - b.rank);
  if (teams.length < 2) throw new Error('No valid standings in workbook.');
  const names = new Set(teams.map(t => t.name));
  for (const row of Object.values(contacts?.rows ?? {})) {
    const team = teams.find(t => t.name === canonical(row.A));
    // Only publish sporting information. Email addresses and phone numbers never enter the API or snapshot.
    if (team) Object.assign(team, { venue: row.B?.trim() ?? '', kit: row.C?.trim() ?? '', captain: row.D?.trim() ?? '' });
  }
  for (const row of rows) {
    const team = teams.find(t => t.name === canonical(row.A));
    if (team && !row.B?.trim()) { team.postponed = Number(row.C || 0); team.adjustment = Number(row.B || 0); }
    else if (team && number(row.B) != null && !row.D) team.adjustment = Number(row.B);
  }
  let round = null;
  const rounds = [];
  const matches = [];
  for (const [rowNum, row] of Object.entries(main.rows)) {
    const roundMatch = row.F?.match(/KOLO\s+(\d+)/i);
    if (roundMatch) { round = { number: Number(roundMatch[1]), dateLabel: '', deadline: '', note: '' }; rounds.push(round); }
    if (!round) continue;
    if (row.H && /^(?:\d+\.\d+\.\d{4}|TBD$)/.test(row.H.trim())) round.dateLabel = row.H;
    else if (row.H && /Neradni/.test(row.H)) round.note = row.H;
    if (row.K) round.deadline = row.K;
    if (!names.has(canonical(row.A)) || !names.has(canonical(row.B))) continue;
    const homeScore = number(row.C), awayScore = number(row.E);
    // A match without a result is postponed when a cell in its row says so, e.g. "ODL" instead of ":".
    // Columns A/B hold the teams, H and K the round's dates and rescheduling deadline.
    const marked = Object.entries(row).some(([column, value]) => !['A', 'B', 'H', 'K'].includes(column) && isPostponed(value));
    const status = homeScore != null && awayScore != null ? 'finished' : marked ? 'postponed' : 'scheduled';
    matches.push({ id: `r${round.number}-${rowNum}`, round: round.number, home: canonical(row.A), away: canonical(row.B), homeScore, awayScore, status });
  }
  for (const team of teams) team.form = matches.filter(m => m.status === 'finished' && (m.home === team.name || m.away === team.name)).slice(-5).map(m => {
    const [gf, ga] = m.home === team.name ? [m.homeScore, m.awayScore] : [m.awayScore, m.homeScore];
    return gf > ga ? 'W' : gf === ga ? 'D' : 'L';
  });
  // Goals per round sit between column C and the "Suma" column, so extra rounds (play-in, play-out, play-offs) can be added as new columns.
  const scorerHeader = Object.values(scorersSheet.rows).find(r => Object.values(r).some(v => /^\s*suma\s*$/i.test(v))) ?? {};
  const totalColumn = Object.keys(scorerHeader).find(c => /^\s*suma\s*$/i.test(scorerHeader[c])) ?? 'N';
  const roundColumns = Array.from({ length: Math.max(0, colNumber(totalColumn) - 3) }, (_, i) => colLetter(3 + i));
  const scorerRounds = roundColumns.map((c, i) => String(scorerHeader[c] ?? '').trim().split(/\s+/).pop() || String(i + 1));
  const scorers = Object.values(scorersSheet.rows).filter(r => r.A && names.has(canonical(r.B)) && number(r[totalColumn]) != null).map(r => ({ name: r.A.trim(), team: canonical(r.B), goals: Number(r[totalColumn]), rounds: roundColumns.map(c => Number(r[c] || 0)) })).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  const scoring = Object.fromEntries(Object.values(options?.rows ?? {}).filter(r => r.A && number(r.B) != null).map(r => [r.A.replace('points for a ', ''), Number(r.B)]));
  const groups = parseGroups(sheets, names);
  const bracketSheet = sheets.find(s => /plej-?\s*of/i.test(s.name));
  const playoff = bracketSheet ? resolveBracket(readBracketSheet(bracketSheet, names, canonical), { leagueTeams: teams, groups }) : null;
  return { season: main.rows[1]?.A?.match(/\d{4}\/\d{2}/)?.[0] ?? '2026/27', teams, matches, rounds, scorers, scorerRounds, scoring, groups, playoff, sheets: sheets.map(s => ({ name: s.name, rows: Object.keys(s.rows).length })), fetchedAt, sourceUrl: SOURCE_URL };
}

const colNumber = letters => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetter = index => { let s = ''; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const resultFor = (match, name) => { const [gf, ga] = match.home === name ? [match.homeScore, match.awayScore] : [match.awayScore, match.homeScore]; return gf > ga ? 'W' : gf === ga ? 'D' : 'L'; };

/**
 * One play-in or play-out worksheet. Same layout as "Ligaški deo": the table in G (rank) / H (team) / I–P,
 * fixtures in A (home), B (away), C : E (score), "KOLO n" in F, the round's dates in H and the
 * "Rok za nadoknadu…" note in any column of the round.
 */
export function parseGroupSheet(sheet, group, leagueNames) {
  const rows = Object.values(sheet.rows);
  const table = rows.filter(r => r.H && leagueNames.has(canonical(r.H)) && number(r.I) != null && number(r.P) != null).map(r => ({
    rank: parseInt(r.G, 10), name: canonical(r.H), played: Number(r.I), won: Number(r.J), drawn: Number(r.K), lost: Number(r.L), goalsFor: Number(r.M), goalsAgainst: Number(r.N), goalDifference: Number(r.O), points: Number(r.P), form: [],
  })).filter(t => Number.isFinite(t.rank)).sort((a, b) => a.rank - b.rank);
  const names = new Set(table.map(t => t.name));
  let round = null;
  const rounds = [], matches = [];
  for (const [rowNum, row] of Object.entries(sheet.rows)) {
    const roundMatch = row.F?.match(/KOLO\s+(\d+)/i);
    if (roundMatch) { round = { number: Number(roundMatch[1]), dateLabel: '', deadline: '', note: '' }; rounds.push(round); }
    if (!round) continue;
    if (row.H && /^(?:\d+\.\d+\.\d{4}|TBD$)/.test(row.H.trim())) round.dateLabel = row.H;
    const deadline = Object.values(row).find(v => /^\s*rok\b/i.test(v));
    if (deadline) round.deadline = deadline.trim();
    if (!names.has(canonical(row.A)) || !names.has(canonical(row.B))) continue;
    const homeScore = number(row.C), awayScore = number(row.E);
    const marked = Object.entries(row).some(([column, value]) => !['A', 'B', 'H'].includes(column) && isPostponed(value));
    matches.push({ id: `${group}-r${round.number}-${rowNum}`, group, round: round.number, home: canonical(row.A), away: canonical(row.B), homeScore, awayScore, status: homeScore != null && awayScore != null ? 'finished' : marked ? 'postponed' : 'scheduled' });
  }
  for (const team of table) team.form = matches.filter(m => m.status === 'finished' && (m.home === team.name || m.away === team.name)).slice(-5).map(m => resultFor(m, team.name));
  return { table, rounds, matches };
}

/** Play-in ("PLEJ-IN") and play-out ("PLEJ-OUT") worksheets, played in parallel rounds. Null until the tabs exist. */
export function parseGroups(sheets, leagueNames) {
  const playinSheet = sheets.find(s => /^plej[\s-]*in$/i.test(s.name.trim()));
  const playoutSheet = sheets.find(s => /^plej[\s-]*out$/i.test(s.name.trim()));
  if (!playinSheet && !playoutSheet) return null;
  const playin = playinSheet ? parseGroupSheet(playinSheet, 'playin', leagueNames) : { table: [], rounds: [], matches: [] };
  const playout = playoutSheet ? parseGroupSheet(playoutSheet, 'playout', leagueNames) : { table: [], rounds: [], matches: [] };
  const rounds = [];
  for (const r of [...playin.rounds, ...playout.rounds]) {
    const known = rounds.find(x => x.number === r.number);
    if (!known) rounds.push({ ...r });
    else for (const field of ['dateLabel', 'deadline', 'note']) known[field] ||= r[field];
  }
  rounds.sort((a, b) => a.number - b.number);
  // A tab that still holds placeholder teams (team1, team2…) has no fixtures yet: treat it as absent.
  if (!playin.matches.length && !playout.matches.length) return null;
  return { rounds, matches: [...playin.matches, ...playout.matches], tables: { playin: playin.table, playout: playout.table } };
}
