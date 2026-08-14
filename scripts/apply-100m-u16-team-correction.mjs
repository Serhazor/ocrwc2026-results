import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const canonicalPath = path.join(dataDir, 'championship-data.json');
const sourcePath = path.join(dataDir, 'podium-source.json');
const eventId = '100m-team';
const category = 'Mixed U16';
const removedTeamId = 't10';
const removedResultId = 'r316';
const medalForPlace = place => ['Gold', 'Silver', 'Bronze'][place - 1] ?? null;

const data = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const removedTeam = data.teams.find(team => team.id === removedTeamId);
const removedResult = data.results.find(result => result.id === removedResultId);

if (Boolean(removedTeam) !== Boolean(removedResult)) {
  throw new Error('The empty Mixed U16 Team E team and result records are inconsistent.');
}
if (removedTeam && (
  removedTeam.name !== 'Usa 100m Mixed U16 Team E'
  || removedTeam.eventId !== eventId
  || removedTeam.category !== category
  || removedTeam.memberIds.length !== 0
)) {
  throw new Error('The targeted Team E record does not match the expected empty Mixed U16 team.');
}

data.teams = data.teams.filter(team => team.id !== removedTeamId);
data.results = data.results.filter(result => result.id !== removedResultId && result.teamId !== removedTeamId);

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
    teamId: result.teamId,
  });
  delete medal.athleteId;
}

const sourceRows = new Map([
  ['Usa 100m Mixed U16 Team F', 314],
  ['Usa 100m Mixed U16 Team J', 315],
  ['Usa 100m Mixed U16 Team Nt', 316],
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
    sourceFile: '100M Day 1 - Q1  Q2 Results.xlsx',
    sourceRow: sourceRows.get(result.name),
  });
}
source.generated = '2026-08-14';

const summary = data.summaries[eventId];
const eventResults = data.results.filter(result => result.eventId === eventId);
summary.entries = eventResults.length;
summary.countries = new Set(eventResults.map(result => result.countryIso || result.country)).size;
summary.categories = new Set(eventResults.map(result => result.category)).size;
summary.medalEligibleTeams = eventResults.filter(result => result.status === 'Ranked' && result.category !== 'Open').length;

const correctionNote = {
  level: 'info',
  title: '100m Mixed U16 empty team removal',
  text: 'USA 100m Mixed U16 Team E was removed because no athletes were linked to the team. Mixed U16 placings and medals were recalculated; USA 100m Mixed 16+ Team E remains unchanged.',
};
const existingNote = data.dataNotes.find(note => note.title === correctionNote.title);
if (existingNote) Object.assign(existingNote, correctionNote);
else data.dataNotes.push(correctionNote);

await fs.writeFile(canonicalPath, `${JSON.stringify(data, null, 2)}\n`);
await fs.writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`);

await import('./repair-podium-data.mjs?after-100m-u16-empty-team-removal');

const repaired = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
const finalPodium = repaired.results
  .filter(result => result.eventId === eventId && result.category === category && result.medal)
  .sort((left, right) => left.place - right.place)
  .map(result => ({ place: result.place, medal: result.medal, name: result.name, time: result.time }));

console.log(JSON.stringify({
  removed: Boolean(removedTeam),
  remaining100mTeams: repaired.results.filter(result => result.eventId === eventId).length,
  remainingMixedU16Teams: repaired.results.filter(result => result.eventId === eventId && result.category === category).length,
  finalPodium,
}, null, 2));
