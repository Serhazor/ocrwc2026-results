import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const canonicalPath = path.join(dataDir, 'championship-data.json');
const sourcePath = path.join(dataDir, 'podium-source.json');

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const parseSeconds = value => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/\d+(?::\d{1,2}){0,2}\.\d+/)?.[0];
  if (!match) return null;
  const parts = match.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
};
const normalize = value => String(value ?? '')
  .replace(/\s*\(\d+\)\s*$/, '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const personKey = value => normalize(value).split(' ').filter(Boolean).sort().join('|');
const medalForPlace = place => ['Gold', 'Silver', 'Bronze'][place - 1] ?? null;
const medalIdNumber = value => Number(String(value ?? '').replace(/\D+/g, '')) || 0;
const medalTableSort = (left, right) => (
  right.gold - left.gold
  || right.silver - left.silver
  || right.bronze - left.bronze
  || left.country.localeCompare(right.country)
);

function buildMedalTable(medals) {
  const byCountry = new Map();
  for (const medal of medals) {
    const key = medal.countryIso || medal.country;
    if (!byCountry.has(key)) {
      byCountry.set(key, {
        country: medal.country,
        countryIso: medal.countryIso,
        flag: medal.flag,
        gold: 0,
        silver: 0,
        bronze: 0,
        total: 0,
      });
    }
    const row = byCountry.get(key);
    row[medal.medal.toLowerCase()] += 1;
    row.total += 1;
  }
  return [...byCountry.values()]
    .sort(medalTableSort)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function resultMatchesSource(data, result, expectedName) {
  if (personKey(result.name) === personKey(expectedName)) return true;
  const athlete = data.athletes.find(item => item.id === result.athleteId);
  return athlete?.aliases?.some(alias => personKey(alias) === personKey(expectedName)) ?? false;
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

const data = await readJson(canonicalPath);
const source = await readJson(sourcePath);
let finalTimesRepaired = 0;
let sourceNamesRepaired = 0;
let podiumAssignmentsRepaired = 0;

for (const result of data.results.filter(item => item.eventId === '100m' && item.elimination?.Final?.seconds != null)) {
  const finalTime = result.elimination.Final.raw;
  const finalSeconds = parseSeconds(finalTime);
  if (finalSeconds == null || Math.abs(finalSeconds - result.elimination.Final.seconds) > 0.001) {
    throw new Error(`Invalid 100m final linkage for ${result.name} (${result.category}).`);
  }
  if (result.time !== finalTime || Math.abs((result.timeSeconds ?? 0) - finalSeconds) > 0.001) finalTimesRepaired += 1;
  result.finalTime = finalTime;
  result.time = finalTime;
  result.timeSeconds = finalSeconds;
}

const source100mMedals = source.medals.filter(item => item.eventId === '100m');
const canonical100mMedals = data.medals.filter(item => item.eventId === '100m');

for (const result of data.results.filter(item => item.eventId === '100m')) {
  result.place = null;
  result.medal = null;
}

for (const expected of source100mMedals) {
  const medal = data.medals.find(item => item.eventId === expected.eventId && item.category === expected.category && item.place === expected.place);
  if (!medal) throw new Error(`Missing medal record for ${expected.eventId} / ${expected.category} / place ${expected.place}.`);
  const candidates = data.results.filter(item => item.eventId === '100m' && item.category === expected.category);
  const result = candidates.find(item => resultMatchesSource(data, item, expected.name));
  if (!result) throw new Error(`Missing 100m result for ${expected.name} (${expected.category}).`);

  if (medal.athleteId !== result.athleteId || medal.name !== result.name || medal.time !== expected.time) {
    podiumAssignmentsRepaired += 1;
  }

  result.place = expected.place;
  result.medal = medalForPlace(expected.place);
  result.time = expected.time;
  result.timeSeconds = expected.timeSeconds;
  if (expected.sourceFile.includes('Elimination Rounds')) result.finalTime = expected.time;

  Object.assign(medal, {
    athleteId: result.athleteId,
    teamId: undefined,
    name: result.name,
    country: result.country,
    countryIso: result.countryIso,
    flag: result.flag,
    medal: medalForPlace(expected.place),
    time: expected.time,
    timeSeconds: expected.timeSeconds,
  });
  delete medal.teamId;
}

if (canonical100mMedals.length !== source100mMedals.length) {
  throw new Error(`100m medal count mismatch: ${canonical100mMedals.length} canonical vs ${source100mMedals.length} sourced.`);
}

for (const expected of source.medals.filter(item => item.eventId !== '100m')) {
  const medal = data.medals.find(item => item.eventId === expected.eventId && item.category === expected.category && item.place === expected.place);
  if (!medal) throw new Error(`Missing medal record for ${expected.eventId} / ${expected.category} / place ${expected.place}.`);
  const result = data.results.find(item => (
    item.eventId === medal.eventId
    && item.category === medal.category
    && item.place === medal.place
    && (medal.athleteId ? item.athleteId === medal.athleteId : item.teamId === medal.teamId)
  ));
  if (!result) throw new Error(`Missing result linked to medal ${medal.id}.`);

  if (personKey(result.name) !== personKey(expected.name) && medal.athleteId) {
    const athlete = data.athletes.find(item => item.id === medal.athleteId);
    const sourceAlias = athlete?.aliases?.find(alias => personKey(alias) === personKey(expected.name));
    if (sourceAlias) {
      result.name = sourceAlias;
      medal.name = sourceAlias;
      sourceNamesRepaired += 1;
    }
  }

  medal.time = result.time;
  medal.timeSeconds = result.timeSeconds;
}

for (const event of data.events) {
  data.medalTables[event.id] = buildMedalTable(data.medals.filter(item => item.eventId === event.id));
}
data.medalTables.combined = buildMedalTable(data.medals);

const medalById = new Map(data.medals.map(medal => [medal.id, medal]));
const athleteMedals = new Map(data.athletes.map(athlete => [athlete.id, new Set()]));
for (const medal of data.medals) {
  if (medal.athleteId && athleteMedals.has(medal.athleteId)) athleteMedals.get(medal.athleteId).add(medal.id);
  if (medal.teamId) {
    const team = data.teams.find(item => item.id === medal.teamId);
    for (const athleteId of team?.memberIds ?? []) athleteMedals.get(athleteId)?.add(medal.id);
  }
}

for (const athlete of data.athletes) {
  athlete.medals = [...athleteMedals.get(athlete.id)].sort((left, right) => medalIdNumber(left) - medalIdNumber(right));
  const medals = athlete.medals.map(id => medalById.get(id)).filter(Boolean);
  athlete.medalCount = medals.length;
  athlete.goldCount = medals.filter(item => item.medal === 'Gold').length;
  athlete.silverCount = medals.filter(item => item.medal === 'Silver').length;
  athlete.bronzeCount = medals.filter(item => item.medal === 'Bronze').length;
}

const combinedByCountry = new Map(data.medalTables.combined.map(row => [row.countryIso || row.country, row]));
for (const country of data.countries) {
  const totals = combinedByCountry.get(country.countryIso || country.country);
  country.gold = totals?.gold ?? 0;
  country.silver = totals?.silver ?? 0;
  country.bronze = totals?.bronze ?? 0;
  country.total = totals?.total ?? 0;
}

data.mostMedals = data.athletes
  .filter(athlete => athlete.medalCount > 0)
  .sort((left, right) => (
    right.medalCount - left.medalCount
    || right.goldCount - left.goldCount
    || right.silverCount - left.silverCount
    || right.bronzeCount - left.bronzeCount
    || left.name.localeCompare(right.name)
  ))
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

data.mostEvents = data.athletes
  .slice()
  .sort((left, right) => (
    right.eventCount - left.eventCount
    || right.medalCount - left.medalCount
    || left.name.localeCompare(right.name)
  ))
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

data.largestCountries = data.countries
  .slice()
  .sort((left, right) => right.athletes - left.athletes || left.country.localeCompare(right.country))
  .slice(0, 12)
  .map(country => ({ ...country }));

data.summaries['100m'].medalLeader = data.medalTables['100m'][0];
data.eventFacts['100m'] = [
  'Male Elite champion: Caleb Riley (🇺🇸 United States) in 38.202.',
  'Female Elite champion: Elizabeth Polsgrove (🇺🇸 United States) in 30.982.',
  'Fastest recorded 100m run: Luke Beckstrand in 24.542 during the Semi Final.',
  'Knockout podiums follow bracket progression: semifinal winners contest gold and silver, while semifinal losers contest bronze.',
  'The Final column contains both the championship final and the third-place race; their times are not pooled into one ranking.',
  'Adaptive categories and Female Veteran without semifinals are treated as direct finals using the supplied Best Time.',
];
const note100m = data.dataNotes.find(note => note.title === '100m direct finals' || note.title === '100m knockout and direct-final method');
if (note100m) {
  note100m.title = '100m knockout and direct-final method';
  note100m.text = 'For bracket divisions, semifinal winners contest gold and silver while semifinal losers contest bronze. The Final column therefore contains two separate head-to-head races and is not ranked as one pooled list. Divisions without semifinals use the supplied Best Time as a direct final.';
}
const seenDataNotes = new Set();
data.dataNotes = data.dataNotes.filter(note => {
  const key = `${note.level}|${note.title}|${note.text}`;
  if (seenDataNotes.has(key)) return false;
  seenDataNotes.add(key);
  return true;
});

const combinedLeader = data.medalTables.combined[0];
const bestMedalRatio = data.countries
  .filter(country => country.athletes >= 10)
  .sort((left, right) => (right.total / right.athletes) - (left.total / left.athletes))[0];
data.overallFacts = data.overallFacts.filter(fact => (
  !fact.includes('leads the combined medal table')
  && !fact.includes('highest medals-per-athlete ratio')
));
data.overallFacts.push(
  `${combinedLeader.flag} ${combinedLeader.country} leads the combined medal table with ${combinedLeader.gold} golds and ${combinedLeader.total} total medals.`,
  `Among delegations with at least 10 linked athletes, ${bestMedalRatio.flag} ${bestMedalRatio.country} has the highest medals-per-athlete ratio (${(bestMedalRatio.total / bestMedalRatio.athletes).toFixed(2)}).`,
);

await writePayloads(data);
console.log(JSON.stringify({
  finalTimesRepaired,
  podiumAssignmentsRepaired,
  sourceNamesRepaired,
  podiumRecordsSynchronized: source.medals.length,
}, null, 2));
