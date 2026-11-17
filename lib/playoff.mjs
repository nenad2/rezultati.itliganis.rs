// Play-off bracket: read from the "Plejof brackets" worksheet and resolved into teams and winners.
//
// The worksheet is read by its labels, not by fixed cells, so moving the bracket a few rows or columns
// does not break the site:
//   QF1–QF4 (quarter-finals), P1/P2 or SF1/SF2 (semi-finals), FINALE, "Treće mesto" (third place).
// Under each label, the next two rows that hold a seed (IN1, OUT2…), a team name, a placeholder
// ("WINNER QF1", "LOSER P2") or #REF! are the two sides. The cell after the team holds the score,
// written as "2" or "1(p 3)" when the match went to penalties. A date (or TBD) is looked up just above the label.

const STAGES = { QF: 'qf', SF: 'sf', F: 'final', '3RD': 'third' };
// The draft bracket's pairings. Used when the worksheet doesn't say which winners meet.
const DEFAULT_SIDES = {
  SF1: ['WINNER QF1', 'WINNER QF2'], SF2: ['WINNER QF3', 'WINNER QF4'],
  F: ['WINNER SF1', 'WINNER SF2'], '3RD': ['LOSER SF1', 'LOSER SF2'],
};
export const PLAYOFF_ORDER = ['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'F', '3RD'];

const plain = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const colIndex = letters => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = index => { let s = ''; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };

/** "QF1" → "QF1", "P2"/"SF2" → "SF2", "FINALE" → "F", "Treće mesto" → "3RD"; anything else → null. */
export function matchKey(value) {
  const text = plain(value);
  let m;
  if ((m = /^QF\s*([1-4])$/.exec(text))) return `QF${m[1]}`;
  if ((m = /^(?:P|SF)\s*([12])$/.exec(text))) return `SF${m[1]}`;
  if (/^FINALE?$/.test(text)) return 'F';
  if (/^(?:TRECE|3\.?) ?MESTO$/.test(text)) return '3RD';
  return null;
}

/** "WINNER QF1" / "Pobednik P2" / "LOSER P1" → { result: 'winner' | 'loser', key: 'QF1' | 'SF2' | … }. */
export function parsePlaceholder(value) {
  const m = /^(WINNER|POBEDNIK|LOSER|PORAZEN\w*)\s+(QF|P|SF)\s*([1-4])$/.exec(plain(value));
  if (!m) return null;
  return { result: /^(WINNER|POBEDNIK)$/.test(m[1]) ? 'winner' : 'loser', key: m[2] === 'QF' ? `QF${m[3]}` : `SF${m[3]}` };
}

/** "3" → { goals: 3, pens: null }; "1(p 3)" / "1 (p. 3)" → { goals: 1, pens: 3 }; anything else → null. */
export function parseScore(value) {
  const m = /^\s*(\d+)\s*(?:\(\s*p\.?\s*(\d+)\s*\))?\s*$/i.exec(String(value ?? ''));
  return m ? { goals: Number(m[1]), pens: m[2] == null ? null : Number(m[2]) } : null;
}

const isSeed = value => /^(IN|OUT) ?\d+$/.test(plain(value));
const isBroken = value => /^#(REF|N\/A|VALUE|NAME|ERROR)/i.test(String(value ?? '').trim());
const isDate = value => /^(TBD|\d{1,2}\.\s*\d{1,2}\.)/i.test(String(value ?? '').trim());

/** Reads the bracket worksheet ({ rows: { [rowNumber]: { [column]: text } } }) into raw matches. */
export function readBracketSheet(sheet, teamNames, canonical = v => String(v).trim()) {
  const rows = sheet?.rows ?? {};
  const cell = (r, c) => rows[r]?.[colName(c)];
  const isTeam = value => value != null && teamNames.has(canonical(value));
  const found = {};
  for (const [rowNumber, row] of Object.entries(rows)) {
    for (const [column, value] of Object.entries(row)) {
      const key = matchKey(value);
      if (!key || found[key]) continue;
      const r = Number(rowNumber), c = colIndex(column);
      const sides = [];
      for (let rr = r; rr <= r + 4 && sides.length < 2; rr++) {
        const side = { seed: null, team: null, placeholder: null, score: null };
        let last = 0;
        for (let cc = Math.max(1, c - 1); cc <= c + 4; cc++) {
          if (rr === r && cc === c) continue;
          const value = cell(rr, cc);
          if (value == null || value === '') continue;
          if (!side.seed && isSeed(value)) { side.seed = plain(value).replace(' ', ''); last = cc; }
          else if (!side.team && isTeam(value)) { side.team = canonical(value); last = cc; }
          else if (!side.placeholder && parsePlaceholder(value)) { side.placeholder = plain(value); last = cc; }
          else if (isBroken(value)) last = cc;
        }
        if (!last) continue;
        for (let cc = last + 1; cc <= last + 2 && !side.score; cc++) side.score = parseScore(cell(rr, cc));
        sides.push(side);
      }
      let date = '';
      for (let rr = r - 1; rr >= r - 3 && !date; rr--) {
        for (let cc = Math.max(1, c - 1); cc <= c + 5 && !date; cc++) if (isDate(cell(rr, cc))) date = String(cell(rr, cc)).trim();
      }
      found[key] = { key, sides, date };
    }
  }
  return PLAYOFF_ORDER.filter(key => found[key]).map(key => found[key]);
}

/**
 * Resolves seeds and placeholders into teams and works out winners.
 * IN n / OUT n come from the play-in / play-out tables; before those exist, from the league table
 * (play-in = places 1–6, play-out = places 7–12). Until every play-in / play-out match is played,
 * quarter-final pairings are marked as projected.
 */
export function resolveBracket(raw, { leagueTeams = [], groups = null } = {}) {
  if (!raw?.length) return null;
  const groupsDone = !!groups?.matches?.length && groups.matches.every(m => m.status === 'finished');
  const byRank = (table, rank) => table?.find(t => t.rank === rank)?.name ?? null;
  const fromSeed = seed => {
    const m = /^(IN|OUT)(\d+)$/.exec(seed || '');
    if (!m) return null;
    const n = Number(m[2]);
    if (groups?.tables) return byRank(m[1] === 'IN' ? groups.tables.playin : groups.tables.playout, n);
    return byRank(leagueTeams, m[1] === 'IN' ? n : 6 + n);
  };
  const results = {};
  const out = [];
  for (const key of PLAYOFF_ORDER) {
    const entry = raw.find(r => r.key === key);
    if (!entry && key.startsWith('QF')) continue;
    const sides = [0, 1].map(i => {
      const side = entry?.sides[i] ?? { seed: null, team: null, placeholder: null, score: null };
      const ref = parsePlaceholder(side.placeholder ?? DEFAULT_SIDES[key]?.[i]);
      let name = side.team, projected = false;
      if (!name && ref) name = results[ref.key]?.[ref.result] ?? null;
      if (!name && side.seed) name = fromSeed(side.seed);
      if (key.startsWith('QF') && name && !groupsDone) projected = true;
      const label = side.seed ?? (ref ? `${ref.result === 'winner' ? 'Winner' : 'Loser'} ${ref.key}` : null);
      return { name, seed: side.seed, label, projected, goals: side.score?.goals ?? null, pens: side.score?.pens ?? null };
    });
    const [home, away] = sides;
    let winner = null, loser = null;
    if (home.name && away.name && home.goals != null && away.goals != null) {
      const diff = home.goals - away.goals || (home.pens ?? 0) - (away.pens ?? 0);
      if (diff) [winner, loser] = diff > 0 ? [home.name, away.name] : [away.name, home.name];
    }
    results[key] = { winner, loser };
    out.push({ key, stage: STAGES[key.replace(/\d$/, '')] ?? STAGES[key], date: entry?.date ?? '', home, away, winner, status: winner ? 'finished' : 'scheduled' });
  }
  return { matches: out, champion: results.F?.winner ?? null, projected: out.some(m => m.home.projected || m.away.projected) };
}
