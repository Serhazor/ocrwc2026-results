import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const canonicalPath = path.join(dataDir, 'championship-data.json');
const data = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));

const correction = {
  teamName: 'NED XC Elite Mixed Team',
  outgoingName: 'Olof van Houten',
  incomingName: 'Jilles van Merkenstein',
};
const timeCorrection = {
  teamName: 'EST XC Elite Mixed Team',
  category: 'Elite Mixed',
  originalTime: '39:53.5',
  correctedTime: '42:53.5',
  correctedSeconds: 42 * 60 + 53.5,
  reason: 'Confirmed three-minute time adjustment.',
};
const normalize = value => String(value ?? '').trim().toLowerCase();
const medalIdNumber = value => Number(String(value ?? '').replace(/\D+/g, '')) || 0;
const eventOrder = new Map(data.events.map((event, index) => [event.id, index]));

const team = data.teams.find(item => item.eventId === 'xc-team' && item.name === correction.teamName);
const outgoing = data.athletes.find(item => normalize(item.name) === normalize(correction.outgoingName));
const incoming = data.athletes.find(item => normalize(item.name) === normalize(correction.incomingName));
if (!team || !outgoing || !incoming) throw new Error('The requested XC roster correction could not be resolved.');

const memberIndex = team.memberIds.indexOf(outgoing.id);
if (memberIndex < 0 && !team.memberIds.includes(incoming.id)) {
  throw new Error(`${correction.outgoingName} is not currently linked to ${correction.teamName}.`);
}
if (memberIndex >= 0) {
  team.memberIds[memberIndex] = incoming.id;
  team.members[memberIndex] = incoming.name;
}

const correctedResult = data.results.find(item => (
  item.eventId === 'xc-team'
  && item.name === timeCorrection.teamName
  && item.category === timeCorrection.category
));
if (!correctedResult) throw new Error(`Missing XC result for ${timeCorrection.teamName}.`);
correctedResult.time = timeCorrection.correctedTime;
correctedResult.timeSeconds = timeCorrection.correctedSeconds;
correctedResult.note = timeCorrection.reason;

const correctedCategoryResults = data.results
  .filter(item => (
    item.eventId === 'xc-team'
    && item.category === timeCorrection.category
    && item.status === 'Ranked'
    && Number.isFinite(item.timeSeconds)
  ))
  .sort((left, right) => left.timeSeconds - right.timeSeconds || left.name.localeCompare(right.name));
for (const [index, result] of correctedCategoryResults.entries()) result.place = index + 1;

const teamsByAthlete = new Map(data.athletes.map(athlete => [athlete.id, []]));
for (const currentTeam of data.teams) {
  for (const athleteId of currentTeam.memberIds ?? []) teamsByAthlete.get(athleteId)?.push(currentTeam);
}
const individualResultsByAthlete = new Map(data.athletes.map(athlete => [athlete.id, []]));
for (const result of data.results) {
  if (result.athleteId) individualResultsByAthlete.get(result.athleteId)?.push(result);
}
const medalsById = new Map(data.medals.map(medal => [medal.id, medal]));
const athleteMedals = new Map(data.athletes.map(athlete => [athlete.id, new Set()]));
for (const medal of data.medals) {
  if (medal.athleteId) athleteMedals.get(medal.athleteId)?.add(medal.id);
  if (medal.teamId) {
    const medalTeam = data.teams.find(item => item.id === medal.teamId);
    for (const athleteId of medalTeam?.memberIds ?? []) athleteMedals.get(athleteId)?.add(medal.id);
  }
}

for (const athlete of data.athletes) {
  const athleteTeams = teamsByAthlete.get(athlete.id);
  athlete.teamResults = athleteTeams.map(item => item.id);
  athlete.medals = [...athleteMedals.get(athlete.id)].sort((left, right) => medalIdNumber(left) - medalIdNumber(right));
  const medals = athlete.medals.map(id => medalsById.get(id)).filter(Boolean);
  const linkedEventIds = new Set([
    ...individualResultsByAthlete.get(athlete.id).map(result => result.eventId),
    ...athleteTeams.map(item => item.eventId),
  ]);
  athlete.eventIds = [...linkedEventIds].sort((left, right) => eventOrder.get(left) - eventOrder.get(right));
  athlete.eventCount = athlete.eventIds.length;
  athlete.medalCount = medals.length;
  athlete.goldCount = medals.filter(medal => medal.medal === 'Gold').length;
  athlete.silverCount = medals.filter(medal => medal.medal === 'Silver').length;
  athlete.bronzeCount = medals.filter(medal => medal.medal === 'Bronze').length;
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

const correctionNote = {
  level: 'info',
  title: 'XC Team Relay roster correction',
  text: 'The Netherlands Elite Mixed team roster reflects a confirmed last-minute injury substitution: Jilles van Merkenstein replaced Olof van Houten.',
};
const existingNote = data.dataNotes.find(note => note.title === correctionNote.title);
if (existingNote) Object.assign(existingNote, correctionNote);
else data.dataNotes.push(correctionNote);

const timeCorrectionNote = {
  level: 'info',
  title: 'XC Team Relay time correction',
  text: 'A confirmed three-minute adjustment was applied to EST XC Elite Mixed Team. Its time changed from 39:53.5 to 42:53.5 and the Elite Mixed placings were recalculated.',
};
const existingTimeNote = data.dataNotes.find(note => note.title === timeCorrectionNote.title);
if (existingTimeNote) Object.assign(existingTimeNote, timeCorrectionNote);
else data.dataNotes.push(timeCorrectionNote);

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
  team: team.name,
  outgoing: { name: outgoing.name, eventCount: outgoing.eventCount, medalCount: outgoing.medalCount },
  incoming: { name: incoming.name, eventCount: incoming.eventCount, medalCount: incoming.medalCount },
  timeCorrection: {
    team: correctedResult.name,
    time: correctedResult.time,
    place: correctedResult.place,
    categoryPlacings: correctedCategoryResults.map(result => ({ place: result.place, name: result.name, time: result.time })),
  },
}, null, 2));
