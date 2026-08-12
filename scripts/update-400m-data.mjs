import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const canonicalPath = path.join(dataDir, 'championship-data.json');
const roundSourcePath = path.join(dataDir, '400m-rounds-source.json');

const sourceFiles = {
  roundOf12: '400m Elite Round of 12 RESULTS.xlsx',
  roundOf6: '400m Round of 6 RESULTS.xlsx',
  finals: '400m Finals RESULTS.xlsx',
};

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const stripRank = value => String(value ?? '').replace(/\s*\(\d+\)\s*$/, '').trim();
const normalizeName = value => stripRank(value)
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const parseSeconds = value => {
  const match = String(value ?? '').match(/(\d+):(\d{2})\.(\d{3})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000 : null;
};
const displayTime = value => String(value ?? '').match(/\d+:\d{2}\.\d{3}/)?.[0] ?? null;
const medalForPlace = place => ['Gold', 'Silver', 'Bronze'][place - 1] ?? null;
const medalSort = (a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.country.localeCompare(b.country);

async function importRoundSource(rawPath) {
  const raw = await readJson(path.resolve(rawPath));
  const rows = key => raw[key].sheets[0].values.slice(1).filter(row => row.some(value => value != null && value !== ''));
  const compact = {
    sourceFiles,
    roundOf12: rows('round12').map((row, index) => ({
      sourceRow: index + 2,
      rank: String(row[0] ?? '').trim(),
      nationality: String(row[1] ?? '').trim(),
      name: stripRank(row[2]),
      category: String(row[3] ?? '').trim(),
      outcome: String(row[4] ?? '').trim(),
      time: String(row[5] ?? '').trim(),
    })),
    roundOf6: rows('round6').map((row, index) => ({
      sourceRow: index + 2,
      rank: String(row[0] ?? '').trim(),
      nationality: String(row[1] ?? '').trim(),
      name: stripRank(row[2]),
      category: String(row[3] ?? '').trim(),
      outcome: String(row[4] ?? '').trim(),
      time: String(row[5] ?? '').trim(),
    })),
    finals: rows('finals').map((row, index) => ({
      sourceRow: index + 2,
      nationality: String(row[0] ?? '').trim(),
      name: stripRank(row[1]),
      category: String(row[2] ?? '').trim(),
      time: String(row[3] ?? '').trim(),
    })),
  };
  await fs.writeFile(roundSourcePath, `${JSON.stringify(compact, null, 2)}\n`);
}

function buildMedalTable(medals) {
  const rows = new Map();
  for (const medal of medals) {
    if (!rows.has(medal.countryIso)) {
      rows.set(medal.countryIso, {
        country: medal.country,
        countryIso: medal.countryIso,
        flag: medal.flag,
        gold: 0,
        silver: 0,
        bronze: 0,
        total: 0,
      });
    }
    const row = rows.get(medal.countryIso);
    row[medal.medal.toLowerCase()] += 1;
    row.total += 1;
  }
  return [...rows.values()].sort(medalSort).map((row, index) => ({ ...row, rank: index + 1 }));
}

function fastest400m(data) {
  let fastest = null;
  for (const result of data.results.filter(item => item.eventId === '400m')) {
    const candidates = [];
    for (const [key, raw] of Object.entries(result.qualification ?? {})) {
      const seconds = parseSeconds(raw);
      if (seconds != null) candidates.push({ raw: displayTime(raw), seconds, stage: key === 'best' ? 'Qualification' : `Qualification ${key === 'attempt1' ? 'Q1' : 'Q2'}` });
    }
    for (const [stage, run] of Object.entries(result.elimination ?? {})) {
      if (run?.seconds != null) candidates.push({ raw: run.raw, seconds: run.seconds, stage });
    }
    for (const candidate of candidates) {
      if (!fastest || candidate.seconds < fastest.seconds) fastest = { ...candidate, result };
    }
  }
  return fastest;
}

function updateDerivedData(data, roundSource) {
  const results400 = data.results.filter(result => result.eventId === '400m');
  const byAthleteCategory = new Map(results400.map(result => [`${normalizeName(result.name)}|${result.category}`, result]));
  let matched = 0;

  const findResult = row => {
    const key = `${normalizeName(row.name)}|${row.category}`;
    const result = byAthleteCategory.get(key);
    if (!result) throw new Error(`No 400m qualifying result matches ${row.name} / ${row.category} (source row ${row.sourceRow}).`);
    matched += 1;
    return result;
  };

  for (const result of results400) {
    result.place = null;
    result.medal = null;
    result.stage = 'Qualification';
    result.time = result.qualification?.best ?? result.time;
    result.timeSeconds = parseSeconds(result.time);
    delete result.elimination;
    delete result.finalTime;
    delete result.directFinal;
    delete result.note;
    delete result.roundSources;
  }

  const applyRound = (rows, stage, sourceFile) => {
    for (const row of rows) {
      const result = findResult(row);
      const seconds = parseSeconds(row.time);
      if (seconds == null) throw new Error(`Invalid 400m time for ${row.name} at ${stage}: ${row.time}`);
      result.elimination ??= {};
      result.elimination[stage] = {
        raw: displayTime(row.time),
        seconds,
        rank: Number.parseInt(row.rank, 10) || null,
        outcome: row.outcome || null,
      };
      result.roundSources ??= {};
      result.roundSources[stage] = sourceFile;
      result.stage = stage;
      result.time = displayTime(row.time);
      result.timeSeconds = seconds;
    }
  };

  applyRound(roundSource.roundOf12, 'Round of 12', roundSource.sourceFiles.roundOf12);
  applyRound(roundSource.roundOf6, 'Round of 6', roundSource.sourceFiles.roundOf6);

  const finalGroups = new Map();
  for (const row of roundSource.finals) {
    const result = findResult(row);
    const seconds = parseSeconds(row.time);
    const time = displayTime(row.time);
    if (seconds == null || !time) throw new Error(`Invalid 400m final time for ${row.name}: ${row.time}`);
    const directFinal = /^No Final\b/i.test(row.time);
    const entry = { row, result, seconds, time, directFinal };
    if (!finalGroups.has(row.category)) finalGroups.set(row.category, []);
    finalGroups.get(row.category).push(entry);
  }

  const medals400 = [];
  for (const entries of finalGroups.values()) {
    entries.sort((a, b) => a.seconds - b.seconds || a.result.name.localeCompare(b.result.name));
    entries.forEach((entry, index) => {
      const place = index + 1;
      const medal = medalForPlace(place);
      const { result, row, seconds, time, directFinal } = entry;
      result.elimination ??= {};
      result.elimination.Final = {
        raw: time,
        seconds,
        sourceRaw: row.time,
      };
      result.roundSources ??= {};
      result.roundSources.Final = roundSource.sourceFiles.finals;
      result.stage = directFinal ? 'Direct final' : 'Final';
      result.directFinal = directFinal || undefined;
      result.finalTime = time;
      result.time = time;
      result.timeSeconds = seconds;
      result.place = place;
      result.medal = medal;
      if (directFinal) result.note = 'No separate final was run; the podium uses the time supplied in parentheses in the finals workbook.';
      medals400.push({
        eventId: '400m',
        event: '400m',
        category: result.category,
        place,
        medal,
        country: result.country,
        countryIso: result.countryIso,
        flag: result.flag,
        name: result.name,
        time,
        timeSeconds: seconds,
        athleteId: result.athleteId,
      });
    });
  }

  if (matched !== roundSource.roundOf12.length + roundSource.roundOf6.length + roundSource.finals.length) {
    throw new Error('One or more 400m source rows were not uniquely accounted for.');
  }

  data.medals = data.medals.filter(medal => medal.eventId !== '400m');
  const nextMedalId = Math.max(0, ...data.medals.map(medal => Number.parseInt(String(medal.id).replace(/^m/, ''), 10) || 0)) + 1;
  medals400.forEach((medal, index) => { medal.id = `m${nextMedalId + index}`; });
  data.medals.push(...medals400);

  for (const event of data.events) {
    data.medalTables[event.id] = buildMedalTable(data.medals.filter(medal => medal.eventId === event.id));
  }
  data.medalTables.combined = buildMedalTable(data.medals);

  const teamsById = new Map(data.teams.map(team => [team.id, team]));
  const athleteMedals = new Map(data.athletes.map(athlete => [athlete.id, []]));
  for (const medal of data.medals) {
    const athleteIds = medal.athleteId ? [medal.athleteId] : (teamsById.get(medal.teamId)?.memberIds ?? []);
    for (const athleteId of athleteIds) athleteMedals.get(athleteId)?.push(medal);
  }
  for (const athlete of data.athletes) {
    const medals = athleteMedals.get(athlete.id) ?? [];
    athlete.medals = medals.map(medal => medal.id);
    athlete.medalCount = medals.length;
    athlete.goldCount = medals.filter(medal => medal.medal === 'Gold').length;
    athlete.silverCount = medals.filter(medal => medal.medal === 'Silver').length;
    athlete.bronzeCount = medals.filter(medal => medal.medal === 'Bronze').length;
  }

  const countryMedals = new Map(data.medalTables.combined.map(row => [row.countryIso, row]));
  for (const country of data.countries) {
    const totals = countryMedals.get(country.countryIso) ?? { gold: 0, silver: 0, bronze: 0, total: 0 };
    country.gold = totals.gold;
    country.silver = totals.silver;
    country.bronze = totals.bronze;
    country.total = totals.total;
  }

  data.mostMedals = [...data.athletes]
    .filter(athlete => athlete.medalCount > 0)
    .sort((a, b) => b.medalCount - a.medalCount || b.goldCount - a.goldCount || b.silverCount - a.silverCount || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map(athlete => ({
      id: athlete.id,
      name: athlete.name,
      flag: athlete.flag,
      country: athlete.country,
      countryIso: athlete.countryIso,
      gold: athlete.goldCount,
      silver: athlete.silverCount,
      bronze: athlete.bronzeCount,
      total: athlete.medalCount,
    }));
  data.mostEvents = [...data.athletes]
    .sort((a, b) => b.eventCount - a.eventCount || b.medalCount - a.medalCount || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map(athlete => ({
      id: athlete.id,
      name: athlete.name,
      flag: athlete.flag,
      country: athlete.country,
      countryIso: athlete.countryIso,
      eventCount: athlete.eventCount,
      medalCount: athlete.medalCount,
    }));
  data.largestCountries = [...data.countries]
    .sort((a, b) => b.athletes - a.athletes || a.country.localeCompare(b.country))
    .slice(0, 12)
    .map(country => structuredClone(country));

  const event400 = data.events.find(event => event.id === '400m');
  event400.medalData = 'available';
  event400.description = 'Qualification, elimination rounds and finals across elite, adaptive and age-group divisions.';

  const fastest = fastest400m(data);
  const summary = data.summaries['400m'];
  summary.fastest = {
    name: fastest.result.name,
    country: fastest.result.country,
    flag: fastest.result.flag,
    time: fastest.raw,
    category: fastest.result.category,
  };
  summary.medalLeader = data.medalTables['400m'][0] ?? null;
  summary.fastestRecordedRun = {
    name: fastest.result.name,
    country: fastest.result.country,
    time: fastest.raw,
    stage: fastest.stage,
    category: fastest.result.category,
  };
  summary.roundOf12 = roundSource.roundOf12.length;
  summary.roundOf6 = roundSource.roundOf6.length;
  summary.finalists = roundSource.finals.length;

  const gold400 = medals400.filter(medal => medal.medal === 'Gold');
  const maleElite = gold400.find(medal => medal.category === 'Male Elite');
  const femaleElite = gold400.find(medal => medal.category === 'Female Elite');
  data.eventFacts['400m'] = [
    `Male Elite champion: ${maleElite.name} (${maleElite.flag} ${maleElite.country}) in ${maleElite.time}.`,
    `Female Elite champion: ${femaleElite.name} (${femaleElite.flag} ${femaleElite.country}) in ${femaleElite.time}.`,
    `Fastest recorded 400m run: ${fastest.result.name} in ${fastest.raw} during the ${fastest.stage}.`,
    'Elite athletes progressed through a Round of 12 and Round of 6; other divisions used the supplied rounds as applicable.',
    'Categories marked “No Final” use the time supplied in parentheses in the finals workbook as a direct-final result.',
  ];

  data.meta.combinedMedalNote = 'The combined table includes all individual and team medals derived from the supplied timing exports.';
  data.meta.sourceFiles = data.meta.sourceFiles.filter(file => !/^400M Results - Elimination Rounds Results\.xlsx/i.test(file));
  const qualifyingIndex = data.meta.sourceFiles.indexOf('400m Qualifying Results.xlsx');
  const insertionIndex = qualifyingIndex >= 0 ? qualifyingIndex + 1 : data.meta.sourceFiles.length;
  const additions = Object.values(sourceFiles).filter(file => !data.meta.sourceFiles.includes(file));
  data.meta.sourceFiles.splice(insertionIndex, 0, ...additions);

  data.dataNotes = data.dataNotes.filter(note => note.title !== '400m final data issue');
  data.dataNotes.unshift({
    level: 'info',
    title: '400m elimination and final method',
    text: '400m stages are linked to the qualification field by normalized athlete name and exact division. Podiums use the supplied finals times; where the export says “No Final”, the parenthetical time is treated as the direct-final result.',
  });

  const combinedLeader = data.medalTables.combined[0];
  const ratioLeader = [...data.countries]
    .filter(country => country.athletes >= 10)
    .map(country => ({ ...country, ratio: country.total / country.athletes }))
    .sort((a, b) => b.ratio - a.ratio || b.total - a.total || a.country.localeCompare(b.country))[0];
  data.overallFacts = data.overallFacts.filter(fact => !/leads the available combined medal table|highest available medals-per-athlete ratio/.test(fact));
  data.overallFacts.push(
    `${combinedLeader.flag} ${combinedLeader.country} leads the combined medal table with ${combinedLeader.gold} golds and ${combinedLeader.total} total medals.`,
    `Among delegations with at least 10 linked athletes, ${ratioLeader.flag} ${ratioLeader.country} has the highest medals-per-athlete ratio (${ratioLeader.ratio.toFixed(2)}).`,
  );
}

async function writePayloads(data) {
  const pretty = `${JSON.stringify(data, null, 2)}\n`;
  const compact = JSON.stringify(data);
  const directJs = `window.OCR_DATA=${compact};\n`;
  const compressed = zlib.gzipSync(Buffer.from(compact), { level: 9, mtime: 0 }).toString('base64');
  const compressedJs = `window.OCR_DATA_GZIP_B64=${JSON.stringify(compressed)};\n`;
  const partLength = Math.ceil(compressed.length / 5);
  const parts = Array.from({ length: 5 }, (_, index) => compressed.slice(index * partLength, (index + 1) * partLength));

  await fs.writeFile(canonicalPath, pretty);
  await fs.writeFile(path.join(dataDir, 'championship-data.js'), directJs);
  await fs.writeFile(path.join(dataDir, 'championship-data-compressed.js'), compressedJs);
  await Promise.all(parts.map((part, index) => fs.writeFile(
    path.join(dataDir, `data-part-${index + 1}.js`),
    `${index === 0 ? 'window.OCR_DATA_PARTS=[];\n' : ''}window.OCR_DATA_PARTS.push(${JSON.stringify(part)});\n`,
  )));
}

const importIndex = process.argv.indexOf('--import');
if (importIndex >= 0) {
  const rawPath = process.argv[importIndex + 1];
  if (!rawPath) throw new Error('--import requires the extracted workbook JSON path.');
  await importRoundSource(rawPath);
}

const data = await readJson(canonicalPath);
const roundSource = await readJson(roundSourcePath);
updateDerivedData(data, roundSource);
await writePayloads(data);
console.log(`Updated ${roundSource.roundOf12.length} Round of 12, ${roundSource.roundOf6.length} Round of 6, and ${roundSource.finals.length} final 400m records.`);
