import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const canonicalPath = path.join(dataDir, 'championship-data.json');
const data = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));

const canonicalAthleteId = 'a243';
const duplicateAthleteId = 'a544';
const relayTeamId = 't76';
const sourceAlias = 'Karen Luebcke Wilton';
const correctedName = 'Karen Wiltin';
const medalIdNumber = value => Number(String(value ?? '').replace(/\D+/g, '')) || 0;
const eventOrder = new Map(data.events.map((event, index) => [event.id, index]));

const canonicalAthlete = data.athletes.find(athlete => athlete.id === canonicalAthleteId);
const duplicateAthlete = data.athletes.find(athlete => athlete.id === duplicateAthleteId);
const relayTeam = data.teams.find(team => team.id === relayTeamId);

if (!canonicalAthlete || canonicalAthlete.name !== correctedName) {
  throw new Error('Karen Wiltin canonical athlete profile was not found.');
}
if (!relayTeam || relayTeam.name !== 'USA 400m Mixed 40+ Team NT') {
  throw new Error('Karen Wiltin relay team was not found.');
}

const duplicateMemberIndex = relayTeam.memberIds.indexOf(duplicateAthleteId);
const canonicalMemberIndex = relayTeam.memberIds.indexOf(canonicalAthleteId);
if (duplicateMemberIndex < 0 && canonicalMemberIndex < 0) {
  throw new Error('Neither Karen identity is linked to the relay team.');
}
if (duplicateMemberIndex >= 0) {
  relayTeam.memberIds[duplicateMemberIndex] = canonicalAthleteId;
  relayTeam.members[duplicateMemberIndex] = correctedName;
} else {
  relayTeam.members[canonicalMemberIndex] = correctedName;
}

canonicalAthlete.aliases = [...new Set([...(canonicalAthlete.aliases ?? []), sourceAlias])];
data.athletes = data.athletes.filter(athlete => athlete.id !== duplicateAthleteId);

for (const result of data.results) {
  if (result.athleteId === duplicateAthleteId) {
    result.athleteId = canonicalAthleteId;
    result.name = correctedName;
  }
}

const teamsByAthlete = new Map(data.athletes.map(athlete => [athlete.id, []]));
for (const team of data.teams) {
  for (const athleteId of team.memberIds ?? []) teamsByAthlete.get(athleteId)?.push(team);
}
const individualResultsByAthlete = new Map(data.athletes.map(athlete => [athlete.id, []]));
for (const result of data.results) {
  if (result.athleteId) individualResultsByAthlete.get(result.athleteId)?.push(result);
}
const medalsById = new Map(data.medals.map(medal => [medal.id, medal]));
const athleteMedals = new Map(data.athletes.map(athlete => [athlete.id, new Set()]));
for (const medal of data.medals) {
  if (medal.athleteId === duplicateAthleteId) medal.athleteId = canonicalAthleteId;
  if (medal.athleteId) athleteMedals.get(medal.athleteId)?.add(medal.id);
  if (medal.teamId) {
    const team = data.teams.find(item => item.id === medal.teamId);
    for (const athleteId of team?.memberIds ?? []) athleteMedals.get(athleteId)?.add(medal.id);
  }
}

for (const athlete of data.athletes) {
  const athleteResults = individualResultsByAthlete.get(athlete.id);
  const athleteTeams = teamsByAthlete.get(athlete.id);
  athlete.results = athleteResults.map(result => result.id);
  athlete.teamResults = athleteTeams.map(team => team.id);
  athlete.medals = [...athleteMedals.get(athlete.id)].sort((left, right) => medalIdNumber(left) - medalIdNumber(right));
  const medals = athlete.medals.map(id => medalsById.get(id)).filter(Boolean);
  athlete.eventIds = [...new Set([
    ...athleteResults.map(result => result.eventId),
    ...athleteTeams.map(team => team.eventId),
  ])].sort((left, right) => eventOrder.get(left) - eventOrder.get(right));
  athlete.eventCount = athlete.eventIds.length;
  athlete.medalCount = medals.length;
  athlete.goldCount = medals.filter(medal => medal.medal === 'Gold').length;
  athlete.silverCount = medals.filter(medal => medal.medal === 'Silver').length;
  athlete.bronzeCount = medals.filter(medal => medal.medal === 'Bronze').length;
}

const athleteCountsByCountry = new Map();
for (const athlete of data.athletes) {
  const key = athlete.countryIso || athlete.country;
  athleteCountsByCountry.set(key, (athleteCountsByCountry.get(key) ?? 0) + 1);
}
for (const country of data.countries) {
  country.athletes = athleteCountsByCountry.get(country.countryIso || country.country) ?? 0;
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

const uniqueAthleteCount = data.athletes.length;
const multiEventAthleteCount = data.athletes.filter(athlete => athlete.eventCount >= 2).length;
const athleteInsight = data.insights.find(insight => insight.title === 'Athletes across the supplied datasets');
if (athleteInsight) athleteInsight.value = uniqueAthleteCount;
const multiEventInsight = data.insights.find(insight => insight.title === 'Multi-event athletes');
if (multiEventInsight) multiEventInsight.value = multiEventAthleteCount;
data.overallFacts = data.overallFacts.map(fact => {
  if (fact.includes('unique athletes are linked')) {
    return `${uniqueAthleteCount} unique athletes are linked across the supplied individual and team datasets.`;
  }
  if (fact.includes('athletes appear in two or more event types')) {
    return `${multiEventAthleteCount} athletes appear in two or more event types.`;
  }
  return fact;
});

const correctionNote = {
  level: 'info',
  title: 'Karen Wiltin athlete identity correction',
  text: 'Karen Luebcke Wilton in the USA 400m Mixed 40+ Team NT roster was corrected to Karen Wiltin and linked to the same athlete profile as her individual 100m and 400m results.',
};
const existingNote = data.dataNotes.find(note => note.title === correctionNote.title);
if (existingNote) Object.assign(existingNote, correctionNote);
else data.dataNotes.push(correctionNote);

const compact = JSON.stringify(data);
const compressed = zlib.gzipSync(Buffer.from(compact), { level: 9, mtime: 0 }).toString('base64');
const partLength = Math.ceil(compressed.length / 5);
const parts = Array.from({ length: 5 }, (_, index) => compressed.slice(index * partLength, (index + 1) * partLength));

await fs.writeFile(canonicalPath, `${JSON.stringify(data, null, 2)}\n`);
await fs.writeFile(path.join(dataDir, 'championship-data.js'), `window.OCR_DATA=${compact};\n`);
await fs.writeFile(path.join(dataDir, 'championship-data-compressed.js'), `window.OCR_DATA_GZIP_B64=${JSON.stringify(compressed)};\n`);
await Promise.all(parts.map((part, index) => fs.writeFile(
  path.join(dataDir, `data-part-${index + 1}.js`),
  `${index === 0 ? 'window.OCR_DATA_PARTS=[];\n' : ''}window.OCR_DATA_PARTS.push(${JSON.stringify(part)});\n`,
)));

console.log(JSON.stringify({
  athlete: {
    id: canonicalAthlete.id,
    name: canonicalAthlete.name,
    aliases: canonicalAthlete.aliases,
    results: canonicalAthlete.results,
    teamResults: canonicalAthlete.teamResults,
    eventIds: canonicalAthlete.eventIds,
    medals: canonicalAthlete.medals,
    medalCount: canonicalAthlete.medalCount,
  },
  relayTeam: {
    id: relayTeam.id,
    name: relayTeam.name,
    members: relayTeam.members,
    memberIds: relayTeam.memberIds,
  },
  duplicateRemoved: !data.athletes.some(athlete => athlete.id === duplicateAthleteId),
  uniqueAthleteCount,
  multiEventAthleteCount,
}, null, 2));
