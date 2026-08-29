import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const canonicalPath = path.join(dataDir, 'championship-data.json');
const podiumSourcePath = path.join(dataDir, 'podium-source.json');
const data = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
const podiumSource = JSON.parse(await fs.readFile(podiumSourcePath, 'utf8'));

const athleteId = 'a269';
const resultId = 'r614';
const correctedName = 'Ronnie Kilman';
const incorrectSpelling = 'Ronnie Kihlman';
const eventId = '400m';
const category = 'M50-54';
const correctionSource = 'Swedish federation correction email (Christopher Holmstrom)';
const syntheticTime = '5:10.476';
const syntheticTimeSeconds = 310.476;
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

async function writePayloads(payload) {
  const pretty = `${JSON.stringify(payload, null, 2)}\n`;
  const compact = JSON.stringify(payload);
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

const athlete = data.athletes.find(item => item.id === athleteId);
const result = data.results.find(item => item.id === resultId && item.athleteId === athleteId);
if (!athlete || !result || result.eventId !== eventId || result.category !== category) {
  throw new Error('Ronnie Kilman\'s 400m M50-54 result could not be resolved.');
}

athlete.name = correctedName;
athlete.aliases = [...new Set([
  ...(athlete.aliases ?? []).filter(alias => alias !== correctedName),
  incorrectSpelling,
])];

for (const athleteResult of data.results.filter(item => item.athleteId === athleteId)) {
  athleteResult.name = correctedName;
}
for (const team of data.teams) {
  for (const [index, memberId] of (team.memberIds ?? []).entries()) {
    if (memberId === athleteId) team.members[index] = correctedName;
  }
}
for (const medal of data.medals.filter(item => item.athleteId === athleteId)) {
  medal.name = correctedName;
}

Object.assign(result, {
  name: correctedName,
  status: 'Ranked',
  time: syntheticTime,
  timeSeconds: syntheticTimeSeconds,
  place: 3,
  medal: 'Bronze',
  stage: 'Final',
  finalTime: syntheticTime,
  timeIsSynthetic: true,
  correctionSource,
  note: 'Bronze medal confirmed by the Swedish federation. A synthetic placement time was assigned because the athlete missed the final.',
});
result.elimination ??= {};
result.elimination.Final = {
  raw: syntheticTime,
  seconds: syntheticTimeSeconds,
  sourceRaw: syntheticTime,
  synthetic: true,
  note: 'Synthetic placement time for the confirmed bronze-medal correction.',
};
result.roundSources ??= {};
result.roundSources.Final = correctionSource;

const categoryFinalists = data.results
  .filter(item => item.eventId === eventId && item.category === category && item.finalTime != null)
  .sort((left, right) => left.timeSeconds - right.timeSeconds || left.name.localeCompare(right.name));
for (const [index, finalist] of categoryFinalists.entries()) {
  finalist.place = index + 1;
  finalist.medal = medalForPlace(finalist.place);
}

let bronzeMedal = data.medals.find(item => item.eventId === eventId && item.category === category && item.place === 3);
if (!bronzeMedal) {
  const nextMedalId = Math.max(...data.medals.map(item => medalIdNumber(item.id))) + 1;
  bronzeMedal = { id: `m${nextMedalId}` };
  const silverIndex = data.medals.findIndex(item => item.eventId === eventId && item.category === category && item.place === 2);
  data.medals.splice(silverIndex + 1, 0, bronzeMedal);
}
Object.assign(bronzeMedal, {
  eventId,
  event: result.event,
  category,
  place: 3,
  medal: 'Bronze',
  country: result.country,
  countryIso: result.countryIso,
  flag: result.flag,
  name: correctedName,
  time: syntheticTime,
  timeSeconds: syntheticTimeSeconds,
  athleteId,
  timeIsSynthetic: true,
  correctionSource,
});
delete bronzeMedal.teamId;

let sourcedBronze = podiumSource.medals.find(item => item.eventId === eventId && item.category === category && item.place === 3);
if (!sourcedBronze) {
  sourcedBronze = {};
  const silverIndex = podiumSource.medals.findIndex(item => item.eventId === eventId && item.category === category && item.place === 2);
  podiumSource.medals.splice(silverIndex + 1, 0, sourcedBronze);
}
Object.assign(sourcedBronze, {
  eventId,
  category,
  place: 3,
  medal: 'Bronze',
  name: correctedName,
  time: syntheticTime,
  timeSeconds: syntheticTimeSeconds,
  sourceFile: correctionSource,
  sourceRow: null,
  timeIsSynthetic: true,
  note: 'Ceremony-awarded bronze; synthetic placement time added at the app owner\'s request because no final was run.',
});
podiumSource.counts[eventId] = podiumSource.medals.filter(item => item.eventId === eventId).length;
podiumSource.generated = '2026-08-29';

for (const event of data.events) {
  data.medalTables[event.id] = buildMedalTable(data.medals.filter(medal => medal.eventId === event.id));
}
data.medalTables.combined = buildMedalTable(data.medals);

const medalsById = new Map(data.medals.map(medal => [medal.id, medal]));
const athleteMedals = new Map(data.athletes.map(item => [item.id, new Set()]));
for (const medal of data.medals) {
  if (medal.athleteId) athleteMedals.get(medal.athleteId)?.add(medal.id);
  if (medal.teamId) {
    const team = data.teams.find(item => item.id === medal.teamId);
    for (const memberId of team?.memberIds ?? []) athleteMedals.get(memberId)?.add(medal.id);
  }
}
for (const currentAthlete of data.athletes) {
  currentAthlete.medals = [...athleteMedals.get(currentAthlete.id)].sort((left, right) => medalIdNumber(left) - medalIdNumber(right));
  const medals = currentAthlete.medals.map(id => medalsById.get(id)).filter(Boolean);
  currentAthlete.medalCount = medals.length;
  currentAthlete.goldCount = medals.filter(medal => medal.medal === 'Gold').length;
  currentAthlete.silverCount = medals.filter(medal => medal.medal === 'Silver').length;
  currentAthlete.bronzeCount = medals.filter(medal => medal.medal === 'Bronze').length;
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
  .filter(item => item.medalCount > 0)
  .sort((left, right) => (
    right.medalCount - left.medalCount
    || right.goldCount - left.goldCount
    || right.silverCount - left.silverCount
    || right.bronzeCount - left.bronzeCount
    || left.name.localeCompare(right.name)
  ))
  .slice(0, 12)
  .map(item => ({
    id: item.id,
    name: item.name,
    flag: item.flag,
    country: item.country,
    countryIso: item.countryIso,
    gold: item.goldCount,
    silver: item.silverCount,
    bronze: item.bronzeCount,
    total: item.medalCount,
  }));

data.mostEvents = data.athletes
  .slice()
  .sort((left, right) => (
    right.eventCount - left.eventCount
    || right.medalCount - left.medalCount
    || left.name.localeCompare(right.name)
  ))
  .slice(0, 12)
  .map(item => ({
    id: item.id,
    name: item.name,
    flag: item.flag,
    country: item.country,
    countryIso: item.countryIso,
    eventCount: item.eventCount,
    medalCount: item.medalCount,
  }));

data.largestCountries = data.countries
  .slice()
  .sort((left, right) => right.athletes - left.athletes || left.country.localeCompare(right.country))
  .slice(0, 12)
  .map(country => ({ ...country }));

data.summaries[eventId].finalists = data.results.filter(item => item.eventId === eventId && item.finalTime != null).length;
data.summaries[eventId].medalLeader = data.medalTables[eventId][0];

const correctionNote = {
  level: 'info',
  title: '400m M50–54 bronze ceremony correction',
  text: 'Sweden confirmed that Ronnie Kilman was awarded bronze after missing the final because of a schedule misunderstanding. A follow-up clarified that Kilman is the correct surname spelling; “Ronnie Kihlman” is retained only as a searchable alias. A clearly marked synthetic placement time of 5:10.476 was added—one second behind silver—to represent the confirmed third place.',
};
const existingNote = data.dataNotes.find(note => note.title === correctionNote.title);
if (existingNote) Object.assign(existingNote, correctionNote);
else data.dataNotes.push(correctionNote);

const combinedLeader = data.medalTables.combined[0];
const ratioLeader = data.countries
  .filter(country => country.athletes >= 10)
  .sort((left, right) => (right.total / right.athletes) - (left.total / left.athletes))[0];
data.overallFacts = data.overallFacts.filter(fact => (
  !fact.includes('leads the combined medal table')
  && !fact.includes('highest medals-per-athlete ratio')
));
data.overallFacts.push(
  `${combinedLeader.flag} ${combinedLeader.country} leads the combined medal table with ${combinedLeader.gold} golds and ${combinedLeader.total} total medals.`,
  `Among delegations with at least 10 linked athletes, ${ratioLeader.flag} ${ratioLeader.country} has the highest medals-per-athlete ratio (${(ratioLeader.total / ratioLeader.athletes).toFixed(2)}).`,
);

await fs.writeFile(podiumSourcePath, `${JSON.stringify(podiumSource, null, 2)}\n`);
await writePayloads(data);

console.log(JSON.stringify({
  athlete: {
    id: athlete.id,
    name: athlete.name,
    aliases: athlete.aliases,
    medals: athlete.medals,
    medalCount: athlete.medalCount,
    bronzeCount: athlete.bronzeCount,
  },
  correctedResult: {
    id: result.id,
    event: result.event,
    category: result.category,
    place: result.place,
    medal: result.medal,
    time: result.time,
    timeIsSynthetic: result.timeIsSynthetic,
  },
  podium: categoryFinalists.map(item => ({ place: item.place, name: item.name, time: item.time })),
  sweden400m: data.medalTables[eventId].find(row => row.countryIso === 'SE'),
  swedenCombined: data.medalTables.combined.find(row => row.countryIso === 'SE'),
}, null, 2));
