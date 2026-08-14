import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const canonicalPath = path.join(dataDir, 'championship-data.json');
const sourcePath = path.join(dataDir, 'podium-source.json');
const medalForPlace = place => ['Gold', 'Silver', 'Bronze'][place - 1] ?? null;
const medalIdNumber = value => Number(String(value ?? '').replace(/\D+/g, '')) || 0;
const round1 = value => Math.round(value * 10) / 10;
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

async function writePayloads(data) {
  const pretty = `${JSON.stringify(data, null, 2)}\n`;
  const compact = JSON.stringify(data);
  const compressed = zlib.gzipSync(Buffer.from(compact), { level: 9, mtime: 0 }).toString('base64');
  const partLength = Math.ceil(compressed.length / 5);
  const parts = Array.from({ length: 5 }, (_, index) => compressed.slice(index * partLength, (index + 1) * partLength));

  await fs.writeFile(canonicalPath, pretty);
  await fs.writeFile(path.join(dataDir, 'championship-data.js'), `window.OCR_DATA=${compact};\n`);
  await fs.writeFile(path.join(dataDir, 'championship-data-compressed.js'), `window.OCR_DATA_GZIP_B64=${JSON.stringify(compressed)};\n`);
  await Promise.all(parts.map((part, index) => fs.writeFile(
    path.join(dataDir, `data-part-${index + 1}.js`),
    `${index === 0 ? 'window.OCR_DATA_PARTS=[];\n' : ''}window.OCR_DATA_PARTS.push(${JSON.stringify(part)});\n`,
  )));
}

const data = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const eventId = 'standard';
const category = 'M40-44';
const targetAthleteId = 'a991';
const targetResult = data.results.find(result => (
  result.eventId === eventId
  && result.category === category
  && result.athleteId === targetAthleteId
));

if (!targetResult || targetResult.name !== 'Vitalij Voitechovic') {
  throw new Error('Vitalij Voitechovic Standard Course M40-44 result was not found.');
}

Object.assign(targetResult, {
  status: 'DNC',
  place: null,
  medal: null,
  note: 'Finished without bands; unranked.',
});

const rankedResults = data.results
  .filter(result => result.eventId === eventId && result.category === category && result.status === 'Ranked')
  .sort((left, right) => left.timeSeconds - right.timeSeconds || left.name.localeCompare(right.name));

for (const [index, result] of rankedResults.entries()) {
  result.place = index + 1;
  result.medal = medalForPlace(result.place);
}

const categoryMedals = data.medals
  .filter(medal => medal.eventId === eventId && medal.category === category)
  .sort((left, right) => left.place - right.place);

if (categoryMedals.length !== 3) throw new Error(`Expected 3 ${category} medal records, found ${categoryMedals.length}.`);

for (const [index, medal] of categoryMedals.entries()) {
  const result = rankedResults[index];
  Object.assign(medal, {
    place: index + 1,
    medal: medalForPlace(index + 1),
    country: result.country,
    countryIso: result.countryIso,
    flag: result.flag,
    name: result.name,
    time: result.time,
    timeSeconds: result.timeSeconds,
    athleteId: result.athleteId,
  });
  delete medal.teamId;
}

const sourceRows = new Map([
  ['Gavin Hogarth', 798],
  ['Pablo Llusía', 807],
  ['Magnus Marklund', 812],
]);
const sourceCategoryMedals = source.medals
  .filter(medal => medal.eventId === eventId && medal.category === category)
  .sort((left, right) => left.place - right.place);

if (sourceCategoryMedals.length !== 3) throw new Error(`Expected 3 sourced ${category} medal records, found ${sourceCategoryMedals.length}.`);

for (const [index, sourcedMedal] of sourceCategoryMedals.entries()) {
  const result = rankedResults[index];
  Object.assign(sourcedMedal, {
    place: index + 1,
    medal: medalForPlace(index + 1),
    name: result.name,
    time: result.time,
    timeSeconds: result.timeSeconds,
    sourceFile: 'Short_Standard.xlsx',
    sourceRow: sourceRows.get(result.name),
  });
}
source.generated = '2026-08-14';

for (const event of data.events) {
  data.medalTables[event.id] = buildMedalTable(data.medals.filter(medal => medal.eventId === event.id));
}
data.medalTables.combined = buildMedalTable(data.medals);

const medalById = new Map(data.medals.map(medal => [medal.id, medal]));
const athleteMedals = new Map(data.athletes.map(athlete => [athlete.id, new Set()]));
for (const medal of data.medals) {
  if (medal.athleteId) athleteMedals.get(medal.athleteId)?.add(medal.id);
  if (medal.teamId) {
    const team = data.teams.find(item => item.id === medal.teamId);
    for (const athleteId of team?.memberIds ?? []) athleteMedals.get(athleteId)?.add(medal.id);
  }
}

for (const athlete of data.athletes) {
  athlete.medals = [...athleteMedals.get(athlete.id)].sort((left, right) => medalIdNumber(left) - medalIdNumber(right));
  const medals = athlete.medals.map(id => medalById.get(id)).filter(Boolean);
  athlete.medalCount = medals.length;
  athlete.goldCount = medals.filter(medal => medal.medal === 'Gold').length;
  athlete.silverCount = medals.filter(medal => medal.medal === 'Silver').length;
  athlete.bronzeCount = medals.filter(medal => medal.medal === 'Bronze').length;
}

const combinedByCountry = new Map(data.medalTables.combined.map(row => [row.countryIso || row.country, row]));
for (const countryRow of data.countries) {
  const totals = combinedByCountry.get(countryRow.countryIso || countryRow.country);
  countryRow.gold = totals?.gold ?? 0;
  countryRow.silver = totals?.silver ?? 0;
  countryRow.bronze = totals?.bronze ?? 0;
  countryRow.total = totals?.total ?? 0;
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
  .map(countryRow => ({ ...countryRow }));

const standardResults = data.results.filter(result => result.eventId === eventId);
const timedStandardResults = standardResults.filter(result => Number.isFinite(result.timeSeconds));
const standardSummary = data.summaries.standard;
standardSummary.ranked = standardResults.filter(result => result.status === 'Ranked').length;
standardSummary.dnc = standardResults.filter(result => result.status === 'DNC').length;
standardSummary.dns = standardResults.filter(result => result.status === 'DNS').length;
standardSummary.dnf = standardResults.filter(result => result.status === 'DNF').length;
standardSummary.timedFinishes = timedStandardResults.length;
standardSummary.dncRate = round1(100 * standardSummary.dnc / standardSummary.timedFinishes);
standardSummary.medalLeader = data.medalTables.standard[0];

for (const gender of ['Male', 'Female']) {
  const timedGenderResults = timedStandardResults.filter(result => result.gender === gender);
  const dncGenderResults = timedGenderResults.filter(result => result.status === 'DNC');
  data.dncGender.standard[gender] = round1(100 * dncGenderResults.length / timedGenderResults.length);
}

data.eventFacts.standard = data.eventFacts.standard.map(fact => {
  if (/of timed finishers were DNC/.test(fact)) {
    return `${standardSummary.dncRate.toFixed(1)}% of timed finishers were DNC (${standardSummary.dnc} athletes).`;
  }
  if (/Female Standard DNC rate/.test(fact)) {
    return `Female Standard DNC rate was ${data.dncGender.standard.Female.toFixed(1)}% versus ${data.dncGender.standard.Male.toFixed(1)}% for men.`;
  }
  return fact;
});

const standardDncInsight = data.insights.find(insight => insight.title === 'Standard Course DNC rate');
if (standardDncInsight) standardDncInsight.value = `${standardSummary.dncRate.toFixed(1)}%`;
const femaleDncInsight = data.insights.find(insight => insight.title === 'Female Standard DNC rate');
if (femaleDncInsight) femaleDncInsight.text = `Male Standard DNC rate: ${data.dncGender.standard.Male.toFixed(1)}%.`;

const correctionNote = {
  level: 'info',
  title: 'Standard Course M40–44 unranked correction',
  text: 'Vitalij Voitechovic finished without bands and is classified DNC/unranked. The M40–44 standings and medals were recalculated: Gavin Hogarth won Gold, Pablo Llusía won Silver and Magnus Marklund won Bronze.',
};
const existingNote = data.dataNotes.find(note => note.title === correctionNote.title);
if (existingNote) Object.assign(existingNote, correctionNote);
else data.dataNotes.push(correctionNote);

const combinedLeader = data.medalTables.combined[0];
const ratioLeader = data.countries
  .filter(countryRow => countryRow.athletes >= 10)
  .sort((left, right) => (right.total / right.athletes) - (left.total / left.athletes))[0];
data.overallFacts = data.overallFacts.filter(fact => (
  !fact.includes('leads the combined medal table')
  && !fact.includes('highest medals-per-athlete ratio')
));
data.overallFacts.push(
  `${combinedLeader.flag} ${combinedLeader.country} leads the combined medal table with ${combinedLeader.gold} golds and ${combinedLeader.total} total medals.`,
  `Among delegations with at least 10 linked athletes, ${ratioLeader.flag} ${ratioLeader.country} has the highest medals-per-athlete ratio (${(ratioLeader.total / ratioLeader.athletes).toFixed(2)}).`,
);

await fs.writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
await writePayloads(data);

console.log(JSON.stringify({
  correctedAthlete: {
    id: targetResult.athleteId,
    name: targetResult.name,
    status: targetResult.status,
    time: targetResult.time,
    place: targetResult.place,
    medal: targetResult.medal,
  },
  recalculatedPodium: rankedResults.slice(0, 3).map(result => ({
    place: result.place,
    medal: result.medal,
    name: result.name,
    time: result.time,
  })),
  standardSummary: {
    ranked: standardSummary.ranked,
    dnc: standardSummary.dnc,
    dncRate: standardSummary.dncRate,
  },
}, null, 2));
