# IT Liga Niš

A professional football league website built with React, Next.js and Node.js. Ready for Vercel.

## Run on Node.js

Requires Node.js 22.13+.

```sh
npm ci
npm run build
npm start
```

Open http://localhost:3000. For development, use `npm run dev`.



## Vercel + logoi

Push na GitHub, na Vercel-u: Add New > Project > importuj repo (framework Next.js se prepozna sam, bez env varijabli). Svaki sledeći push na `main` pravi novi deploy automatski.

Logo lige i logoi timova: ubaci slike u `public/logos/` i upiši putanje u `lib/branding.ts`.

## Plej-in, plej-out i plejof

Sajt sam prepoznaje nove tabove u glavnom dokumentu. Dok ih nema, sve radi kao ranije.

- **PLEJ-IN** i **PLEJ-OUT**: isti raspored kao *Ligaški deo*. Tabela je u kolonama G (mesto), H (ekipa) i I–P, utakmice u A (domaćin), B (gost) i C : E (rezultat), "KOLO n" u F, datumi kola u H, a "Rok za nadoknadu…" u bilo kojoj koloni kola. Ekipe moraju da se zovu kao u ligaškoj tabeli. Odložen meč se označava sa **ODL**, kao u ligi.
- **Plejof brackets**: mečevi se prepoznaju po oznakama **QF1–QF4**, **P1/P2**, **FINALE** i **Treće mesto**, ne po fiksnim ćelijama. U dva reda ispod oznake su ekipe: oznaka nosioca (IN1, OUT2…), ime ekipe, a odmah desno od imena rezultat. Rezultat se piše kao `2` ili `1(p 3)` kad se ide na penale. Datum (ili TBD) ide iznad oznake meča.
- Dok plej-in i plej-out nisu završeni, sajt prikazuje **projektovani bracket** po trenutnim tabelama (pre njih po ligaškoj tabeli: 1–6 su IN, 7–12 su OUT). Polufinale, finale i meč za 3. mesto popunjavaju se sami iz rezultata.
- **Strelci** ostaju u jednom tabu. Kolone sa kolima idu od C do kolone **Suma**, pa se nova kola mogu dodati kao nove kolone ispred nje.

## League data

The source is the [2026/27 IT Liga workbook](https://docs.google.com/spreadsheets/d/1Vm22gtDxlSCC-1ssUDSN5yedsiCY9tC-v0aZeDWc_9E/edit). The server downloads the entire workbook as XLSX and reads **all five worksheets**, including cached formula values. No Google API key is needed while the workbook remains readable through its shared link.

- Standings and official ranking: **Ligaški deo**, including any bonus/penalty points.
- All 66 fixtures over 11 matchdays: the same worksheet.
- Top scorers and per-matchday goals: **Lista strelaca - Ligaški deo**.
- Venues, kit colours and captains: **Kontakt podaci ekipa i gde imaj**. Personal emails and phone numbers are excluded from every API response and bundled snapshot.
- Organizer tab is inspected and identified in source information; private contact fields are excluded.
- Points for wins, draws and losses: **Options**.

Club-name variants (`HTEC Niš`, `Boopro tech`, `DualSoft`) are matched to the official table. Blank scores stay unplayed; a zero is a real score. The site preserves workbook dates, including source typos and TBD dates. Scorer totals are imported separately, because the scorer tab may be updated after results. Club crests are generated monograms, not official logos.

The current matchday is the highest-numbered round with at least one complete result, including 0–0; before any results, it is matchday 1. Overview and Fixtures & results automatically focus on that round when fresh data arrives, including the Results and Upcoming filters. Manual matchday browsing is preserved while the current round stays the same. The Next up card prioritizes unplayed matches in the current round, then the earliest later round; postponed matches from earlier rounds do not pull the focus back.

## Ten-minute synchronization

On **Node.js**, `instrumentation.ts` starts a server-side check immediately and every **600,000 ms**, even when no visitor has the site open. A shared process cache prevents overlapping fetches and shares results between the background timer and API requests. Keep the Node process running with your usual process manager/container service.

The page is rendered on the server for each visit using the shared league cache. If a source check is due or already running, the page immediately streams a loading shell with the hero photograph and animated placeholders while waiting. Once the data is ready, the shell is replaced with the current matchday instead of briefly displaying the bundled snapshot. Loading animations respect reduced-motion preferences. The browser then reads `/api/league` at the displayed countdown deadline. It also checks when a sleeping tab becomes visible again. In **Sites/serverless hosting**, source checks occur on page/API requests, at most once every ten minutes per warm instance; no unattended cloud cron is configured. An open page automatically requests new data at that interval.

On failure, the last successful in-memory data remains available; cold starts fall back to the bundled sanitized snapshot. The UI shows a stale-data notice and the last successful import time. No database or credentials are required.

## Verification

```sh
npm test
npx tsc --noEmit
npm run build
```

Tests cover workbook parsing, absent vs zero scores, club aliases, official point adjustments, privacy, fixture consistency, concurrent refresh coalescing, ten-minute caching, and stale-data fallback. Desktop/mobile Chrome checks additionally verify navigation, filtering, search, dialogs and timer-triggered requests.

Hero photograph: [Unsplash football image](https://images.unsplash.com/photo-1574629810360-7efbbe195018). Barlow Condensed and DM Sans are self-hosted; their OFL licenses are in `public/fonts/`.
