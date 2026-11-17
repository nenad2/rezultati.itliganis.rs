import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parseLeague } from '../lib/workbook.mjs';
import { parseScore, parsePlaceholder, matchKey } from '../lib/playoff.mjs';

const TEAMS = ['SkySoft', 'Fazi', 'Better Collective', 'Boopro', 'Ascalab', 'HTEC', 'Code', 'OIP Insurtech', 'Logik', 'Diligent', 'DMV', 'Dualsoft'];
const letter = i => String.fromCharCode(65 + i);
/** Rows given as arrays (like a CSV export) → { rowNumber: { column: value } }. */
const grid = (lines, firstRow = 1) => Object.fromEntries(lines.map((cells, i) => [firstRow + i, Object.fromEntries(cells.map((v, c) => [letter(c), v]).filter(([, v]) => v !== '' && v != null))]));

function workbook(tabs) {
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const files = {
    'xl/workbook.xml': `<workbook><sheets>${tabs.map(([name], i) => `<sheet name="${name}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  tabs.forEach(([, rows], i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${Object.entries(rows).map(([n, cells]) => `<row r="${n}">${Object.entries(cells).map(([col, v]) => typeof v === 'number' ? `<c r="${col}${n}"><v>${v}</v></c>` : `<c r="${col}${n}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  });
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

const league = () => ['Ligaški deo', {
  1: { A: 'Ligaški deo 2026/27' },
  ...Object.fromEntries(TEAMS.map((name, i) => [5 + i, { G: i + 1, H: name, I: 11, J: 11 - i, K: 0, L: i, M: 30, N: 10, O: 20, P: 33 - 3 * i }])),
  30: { A: 'SkySoft', B: 'Fazi', C: 2, D: ':', E: 1, F: 'KOLO 1' }, 31: { H: '28.9.2026. - 4.10.2026.' },
}];

/** A play-in / play-out tab laid out like the draft: table in G–P, five rounds of three matches from row 13. */
function group(title, names, results = {}) {
  const pairs = [[1, 0], [3, 4], [2, 5], [1, 4], [2, 3], [5, 0], [1, 2], [0, 4], [5, 3], [4, 2], [3, 0], [5, 1], [0, 2], [4, 5], [3, 1]];
  const rows = { 1: { A: title }, 4: { H: 'Tabela', I: 'GP', P: 'PTS' } };
  names.forEach((name, i) => { rows[5 + i] = { G: `${i + 1}.`, H: name, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0 }; rows[3 + i] = { ...rows[3 + i], A: name }; });
  pairs.forEach(([h, a], i) => {
    const row = 13 + i, cells = { A: names[h], B: names[a], D: ':' };
    if (i % 3 === 0) cells.F = `KOLO ${i / 3 + 1}`;
    if (i % 3 === 1) { cells.H = `${5 + i}.1.2027. - ${11 + i}.1.2027.`; cells.P = 'Rok za nadoknadu do 1.2.2027.'; }
    if (results[i]) Object.assign(cells, results[i]);
    rows[row] = cells;
  });
  return [title.replace(' ', '-'), rows];
}

/** The draft's "Plejof brackets" tab, cell for cell (team cells hold #REF! until the formulas are linked). */
const bracketDraft = [
  ['', 'ČETVRFINALA', '', '', '', '', '', '', '', 'POLUFINALA', '', '', '', '', 'FINALE / 3.mesto'],
  ['', '', '', 'TBD'],
  ['', 'QF1', 'IN1', '#REF!', '', '', '', '', '', 'TBD', '', '', '', '', 'TBD'],
  ['', '', 'OUT2', '#REF!'],
  ['', '', '', '', '', '', '', '', 'P1', 'WINNER QF1'],
  ['', '', '', 'TBD', '', '', '', '', '', 'WINNER QF2', '', '', '', '', '', ' FINALE'],
  ['', 'QF2', 'IN3', '#REF!'],
  ['', '', 'IN6', '#REF!', '', '', '', '', '', '', '', '', '', '', 'WINNER P1'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'WINNER P2'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Pobednik Lige++ 26/27'],
  ['', '', '', 'TBD', '', '', '', '', '', '', '', '', '', '', 'Treće mesto                         '],
  ['', 'QF3', 'IN2', '#REF!', '', '', '', '', '', '', '', '', '', '', 'LOSER P1'],
  ['', '', 'OUT1', '#REF!', '', '', '', '', '', '', '', '', '', '', 'LOSER P2'],
  ['', '', '', '', '', '', '', '', 'P2', 'WINNER QF3'],
  ['', '', '', 'TBD', '', '', '', '', '', 'WINNER QF4'],
  ['', 'QF4', 'IN4', '#REF!'],
  ['', '', 'IN5', '#REF!'],
];

test('score and label helpers read the workbook conventions', () => {
  assert.deepEqual(parseScore('1(p 3)'), { goals: 1, pens: 3 });
  assert.deepEqual(parseScore('2 (p. 4)'), { goals: 2, pens: 4 });
  assert.deepEqual(parseScore(3), { goals: 3, pens: null });
  assert.equal(parseScore('#REF!'), null);
  assert.equal(matchKey('P2'), 'SF2');
  assert.equal(matchKey(' FINALE'), 'F');
  assert.equal(matchKey('Treće mesto   '), '3RD');
  assert.equal(matchKey('FINALE / 3.mesto'), null);
  assert.deepEqual(parsePlaceholder('LOSER P1'), { result: 'loser', key: 'SF1' });
});

test('without play-in / play-out tabs the site keeps working and projects the bracket from the league table', () => {
  const d = parseLeague(workbook([league(), ['Lista strelaca - Ligaški deo', {}], ['Plejof brackets', grid(bracketDraft)]]));
  assert.equal(d.groups, null);
  const qf1 = d.playoff.matches.find(m => m.key === 'QF1');
  assert.deepEqual([qf1.home.name, qf1.away.name], ['SkySoft', 'OIP Insurtech']); // league 1st vs 8th (play-out 2nd)
  assert.equal(qf1.home.projected, true);
  assert.equal(d.playoff.projected, true);
  assert.deepEqual(d.playoff.matches.map(m => m.key), ['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'F', '3RD']);
  assert.equal(d.playoff.matches.find(m => m.key === 'F').home.label, 'Winner SF1');
  assert.equal(qf1.date, 'TBD');
});

test('play-in and play-out tabs become parallel rounds with their own tables', () => {
  const inNames = TEAMS.slice(0, 6), outNames = TEAMS.slice(6);
  const d = parseLeague(workbook([league(), ['Lista strelaca - Ligaški deo', {}],
    group('PLEJ IN', inNames, { 0: { C: 3, E: 1 }, 1: { D: 'ODL' } }), group('PLEJ OUT', outNames)]));
  assert.equal(d.groups.rounds.length, 5);
  assert.equal(d.groups.rounds[0].deadline, 'Rok za nadoknadu do 1.2.2027.');
  assert.equal(d.groups.matches.length, 30);
  assert.deepEqual(d.groups.matches.filter(m => m.round === 1).map(m => m.group), ['playin', 'playin', 'playin', 'playout', 'playout', 'playout']);
  assert.equal(d.groups.matches[0].status, 'finished');
  assert.equal(d.groups.matches[1].status, 'postponed');
  assert.deepEqual(d.groups.tables.playout.map(t => t.name), outNames);
  assert.equal(d.groups.tables.playin[0].rank, 1);
  // League matches are untouched.
  assert.equal(d.matches.length, 1);
});

test('play-off results resolve winners, penalties and the champion', () => {
  const inNames = TEAMS.slice(0, 6), outNames = TEAMS.slice(6);
  const done = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i, { C: 1, E: 0 }]));
  const bracket = structuredClone(bracketDraft);
  const put = (row, col, value) => { const line = bracket[row - 1]; while (line.length <= col) line.push(''); line[col] = value; };
  // Formulas now fill the team names; scores go in the column after the team.
  [[3, 'SkySoft', '2'], [4, 'Logik', '1'], [7, 'Better Collective', '1(p 3)'], [8, 'HTEC', '1(p 4)'], [12, 'Fazi', '0'], [13, 'Code', '1'], [16, 'Boopro', '3'], [17, 'Ascalab', '2']]
    .forEach(([row, team, score]) => { put(row, 3, team); put(row, 4, score); });
  put(5, 10, '1'); put(6, 10, '0'); // SF1: SkySoft 1–0 HTEC
  put(14, 10, '2'); put(15, 10, '2 (p 5)'); // SF2: Code 2–2 Boopro, Boopro on penalties
  put(8, 15, '4'); put(9, 15, '1'); // Final
  put(12, 15, '1'); put(13, 15, '2'); // Third place
  const d = parseLeague(workbook([league(), ['Lista strelaca - Ligaški deo', {}], group('PLEJ IN', inNames, done), group('PLEJ OUT', outNames, done), ['Plejof brackets', grid(bracket)]]));
  const m = Object.fromEntries(d.playoff.matches.map(x => [x.key, x]));
  assert.equal(m.QF2.winner, 'HTEC');
  assert.equal(m.QF2.home.pens, 3);
  assert.deepEqual([m.SF1.home.name, m.SF1.away.name], ['SkySoft', 'HTEC']);
  assert.deepEqual([m.SF2.home.name, m.SF2.away.name], ['Code', 'Boopro']);
  assert.equal(m.SF2.winner, 'Boopro');
  assert.deepEqual([m.F.home.name, m.F.away.name], ['SkySoft', 'Boopro']);
  assert.deepEqual([m['3RD'].home.name, m['3RD'].away.name], ['HTEC', 'Code']);
  assert.equal(m['3RD'].winner, 'Code');
  assert.equal(d.playoff.champion, 'SkySoft');
  assert.equal(d.playoff.projected, false); // play-in / play-out fully played
});
