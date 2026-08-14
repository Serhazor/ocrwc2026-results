import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

const data = JSON.parse(fs.readFileSync('data/championship-data.json', 'utf8'));
const source = JSON.parse(fs.readFileSync('data/podium-source.json', 'utf8'));
const eventIds = ['100m', '100m-team', '400m', '400m-team', 'short', 'standard', 'xc-team'];
const expectedResultCounts = {
  '100m': 306,
  '100m-team': 32,
  '400m': 407,
  '400m-team': 60,
  short: 770,
  standard: 570,
  'xc-team': 107,
};

const normalize = value => String(value ?? '')
  .replace(/\s*\(\d+\)\s*$/, '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const personKey = value => normalize(value).split(' ').filter(Boolean).sort().join('|');
const close = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 0.001;
const sameSeconds = (left, right) => (left == null && right == null) || close(left, right);
const medalKey = item => `${item.eventId}|${item.category}|${item.place}`;
const medalIdNumber = value => Number(String(value ?? '').replace(/\D+/g, '')) || 0;
const medalTableSort = (left, right) => (
  right.gold - left.gold
  || right.silver - left.silver
  || right.bronze - left.bronze
  || left.country.localeCompare(right.country)
);
const buildMedalTable = medals => {
  const rows = new Map();
  for (const medal of medals) {
    const key = medal.countryIso || medal.country;
    if (!rows.has(key)) rows.set(key, {
      country: medal.country,
      countryIso: medal.countryIso,
      flag: medal.flag,
      gold: 0,
      silver: 0,
      bronze: 0,
      total: 0,
    });
    const row = rows.get(key);
    row[medal.medal.toLowerCase()] += 1;
    row.total += 1;
  }
  return [...rows.values()].sort(medalTableSort).map((row, index) => ({ ...row, rank: index + 1 }));
};
const athletes = new Map(data.athletes.map(athlete => [athlete.id, athlete]));
const actualMedals = new Map(data.medals.map(medal => [medalKey(medal), medal]));
const sourceMedals = new Map(source.medals.map(medal => [medalKey(medal), medal]));
const mismatches = [];

for (const expected of source.medals) {
  const actual = actualMedals.get(medalKey(expected));
  if (!actual) {
    mismatches.push({ key: medalKey(expected), issue: 'missing medal', sourceFile: expected.sourceFile, sourceRow: expected.sourceRow });
    continue;
  }
  const athlete = actual.athleteId ? athletes.get(actual.athleteId) : null;
  const nameMatches = actual.teamId
    ? normalize(actual.name) === normalize(expected.name)
    : personKey(actual.name) === personKey(expected.name)
      || athlete?.aliases?.some(alias => personKey(alias) === personKey(expected.name));
  if (!nameMatches || actual.time !== expected.time || !sameSeconds(actual.timeSeconds, expected.timeSeconds) || actual.medal !== expected.medal) {
    mismatches.push({
      key: medalKey(expected),
      issue: 'source mismatch',
      expected: { name: expected.name, time: expected.time, timeSeconds: expected.timeSeconds, medal: expected.medal },
      actual: { name: actual.name, time: actual.time, timeSeconds: actual.timeSeconds, medal: actual.medal },
      sourceFile: expected.sourceFile,
      sourceRow: expected.sourceRow,
    });
  }
}
for (const actual of data.medals) {
  if (!sourceMedals.has(medalKey(actual))) mismatches.push({ key: medalKey(actual), issue: 'unexpected medal' });
}

const inconsistentResultLinks = [];
for (const medal of data.medals) {
  const result = data.results.find(item => (
    item.eventId === medal.eventId
    && item.category === medal.category
    && item.place === medal.place
    && (medal.athleteId ? item.athleteId === medal.athleteId : item.teamId === medal.teamId)
  ));
  if (!result || result.medal !== medal.medal || result.time !== medal.time || !sameSeconds(result.timeSeconds, medal.timeSeconds)) {
    inconsistentResultLinks.push({ medalId: medal.id, resultId: result?.id ?? null });
  }
}

const bad100mFinals = data.results
  .filter(result => result.eventId === '100m' && result.finalTime != null)
  .filter(result => result.time !== result.finalTime || !sameSeconds(result.timeSeconds, result.elimination?.Final?.seconds))
  .map(result => result.id);
const bad100mPlaceholders = data.results
  .filter(result => result.eventId === '100m')
  .flatMap(result => Object.entries(result.elimination ?? {}).map(([stage, run]) => ({ result, stage, run })))
  .filter(({ run }) => String(run?.raw).trim() === '41' && run?.seconds != null)
  .map(({ result, stage }) => `${result.id}:${stage}`);

const badCategoryPlacings = [];
for (const eventId of eventIds) {
  const categories = Map.groupBy(data.medals.filter(medal => medal.eventId === eventId), medal => medal.category);
  for (const [category, medals] of categories) {
    medals.sort((left, right) => left.place - right.place);
    if (medals.some((medal, index) => medal.place !== index + 1)) badCategoryPlacings.push(`${eventId}:${category}`);
  }
}

const badMedalTables = [];
for (const eventId of [...eventIds, 'combined']) {
  const medals = eventId === 'combined' ? data.medals : data.medals.filter(medal => medal.eventId === eventId);
  if (JSON.stringify(data.medalTables[eventId]) !== JSON.stringify(buildMedalTable(medals))) badMedalTables.push(eventId);
}

const expectedAthleteMedals = new Map(data.athletes.map(athlete => [athlete.id, new Set()]));
for (const medal of data.medals) {
  if (medal.athleteId) expectedAthleteMedals.get(medal.athleteId)?.add(medal.id);
  if (medal.teamId) {
    const team = data.teams.find(item => item.id === medal.teamId);
    for (const athleteId of team?.memberIds ?? []) expectedAthleteMedals.get(athleteId)?.add(medal.id);
  }
}
const badAthleteMedalTotals = data.athletes
  .filter(athlete => {
    const expectedIds = [...expectedAthleteMedals.get(athlete.id)].sort((left, right) => medalIdNumber(left) - medalIdNumber(right));
    const medals = expectedIds.map(id => data.medals.find(medal => medal.id === id));
    return JSON.stringify(athlete.medals) !== JSON.stringify(expectedIds)
      || athlete.medalCount !== medals.length
      || athlete.goldCount !== medals.filter(medal => medal.medal === 'Gold').length
      || athlete.silverCount !== medals.filter(medal => medal.medal === 'Silver').length
      || athlete.bronzeCount !== medals.filter(medal => medal.medal === 'Bronze').length;
  })
  .map(athlete => athlete.id);

const combinedRows = new Map(buildMedalTable(data.medals).map(row => [row.countryIso || row.country, row]));
const badCountryMedalTotals = data.countries
  .filter(country => {
    const expected = combinedRows.get(country.countryIso || country.country);
    return country.gold !== (expected?.gold ?? 0)
      || country.silver !== (expected?.silver ?? 0)
      || country.bronze !== (expected?.bronze ?? 0)
      || country.total !== (expected?.total ?? 0);
  })
  .map(country => country.countryIso);

const teamsByAthlete = new Map(data.athletes.map(athlete => [athlete.id, []]));
for (const team of data.teams) {
  for (const athleteId of team.memberIds ?? []) teamsByAthlete.get(athleteId)?.push(team);
}
const eventOrder = new Map(data.events.map((event, index) => [event.id, index]));
const badAthleteTeamLinks = data.athletes
  .filter(athlete => {
    const teams = teamsByAthlete.get(athlete.id);
    const expectedTeamIds = teams.map(team => team.id);
    const expectedEventIds = [...new Set([
      ...data.results.filter(result => result.athleteId === athlete.id).map(result => result.eventId),
      ...teams.map(team => team.eventId),
    ])].sort((left, right) => eventOrder.get(left) - eventOrder.get(right));
    return JSON.stringify(athlete.teamResults) !== JSON.stringify(expectedTeamIds)
      || JSON.stringify(athlete.eventIds) !== JSON.stringify(expectedEventIds)
      || athlete.eventCount !== expectedEventIds.length;
  })
  .map(athlete => athlete.id);

const correctedXcTeam = data.teams.find(team => team.eventId === 'xc-team' && team.name === 'NED XC Elite Mixed Team');
const jilles = data.athletes.find(athlete => normalize(athlete.name) === normalize('Jilles van Merkenstein'));
const olof = data.athletes.find(athlete => normalize(athlete.name) === normalize('Olof van Houten'));
const xcRosterCorrectionApplied = Boolean(
  correctedXcTeam
  && jilles
  && olof
  && correctedXcTeam.memberIds.includes(jilles.id)
  && !correctedXcTeam.memberIds.includes(olof.id)
  && jilles.teamResults.includes(correctedXcTeam.id)
  && !olof.teamResults.includes(correctedXcTeam.id)
);

const correctedEstXcResult = data.results.find(result => (
  result.eventId === 'xc-team'
  && result.category === 'Elite Mixed'
  && result.name === 'EST XC Elite Mixed Team'
));
const xcTimeCorrectionApplied = Boolean(
  correctedEstXcResult
  && correctedEstXcResult.time === '42:53.5'
  && close(correctedEstXcResult.timeSeconds, 2573.5)
  && correctedEstXcResult.place === 12
);
const eliteMixedRankedResults = data.results
  .filter(result => result.eventId === 'xc-team' && result.category === 'Elite Mixed' && result.status === 'Ranked')
  .sort((left, right) => left.timeSeconds - right.timeSeconds || left.name.localeCompare(right.name));
const eliteMixedPlacingsRecalculated = eliteMixedRankedResults.every((result, index) => result.place === index + 1);

const vitalijStandardResult = data.results.find(result => (
  result.eventId === 'standard'
  && result.category === 'M40-44'
  && result.athleteId === 'a991'
));
const standardM4044CorrectionApplied = Boolean(
  vitalijStandardResult
  && vitalijStandardResult.status === 'DNC'
  && vitalijStandardResult.place == null
  && vitalijStandardResult.medal == null
  && vitalijStandardResult.note === 'Finished without bands; unranked.'
);
const standardM4044RankedResults = data.results
  .filter(result => result.eventId === 'standard' && result.category === 'M40-44' && result.status === 'Ranked')
  .sort((left, right) => left.timeSeconds - right.timeSeconds || left.name.localeCompare(right.name));
const standardM4044PlacingsRecalculated = standardM4044RankedResults.every((result, index) => (
  result.place === index + 1
  && result.medal === (['Gold', 'Silver', 'Bronze'][index] ?? null)
));
const standardM4044PodiumCorrect = ['Gavin Hogarth', 'Pablo Llusía', 'Magnus Marklund']
  .every((name, index) => {
    const medal = data.medals.find(item => item.eventId === 'standard' && item.category === 'M40-44' && item.place === index + 1);
    return medal?.name === name && medal.medal === ['Gold', 'Silver', 'Bronze'][index];
  });

const json = JSON.stringify(data);
const directContext = { window: {} };
vm.runInNewContext(fs.readFileSync('data/championship-data.js', 'utf8'), directContext);
const compressedContext = { window: {} };
vm.runInNewContext(fs.readFileSync('data/championship-data-compressed.js', 'utf8'), compressedContext);
const decompressed = zlib.gunzipSync(Buffer.from(compressedContext.window.OCR_DATA_GZIP_B64, 'base64')).toString();
const partsContext = { window: {} };
for (let index = 1; index <= 5; index += 1) vm.runInNewContext(fs.readFileSync(`data/data-part-${index}.js`, 'utf8'), partsContext);
const splitPayload = zlib.gunzipSync(Buffer.from(partsContext.window.OCR_DATA_PARTS.join(''), 'base64')).toString();

const resultCounts = Object.fromEntries(eventIds.map(eventId => [eventId, data.results.filter(result => result.eventId === eventId).length]));
const medalCounts = Object.fromEntries(eventIds.map(eventId => [eventId, data.medals.filter(medal => medal.eventId === eventId).length]));
const checks = {
  allUploadedResultRowsAccountedFor: eventIds.every(eventId => resultCounts[eventId] === expectedResultCounts[eventId]),
  podiumCountsMatchSources: eventIds.every(eventId => medalCounts[eventId] === source.counts[eventId]),
  allPodiumsMatchSources: mismatches.length === 0,
  resultMedalLinks: inconsistentResultLinks.length === 0,
  categoryPlacings: badCategoryPlacings.length === 0,
  final100mFields: bad100mFinals.length === 0,
  placeholder41Excluded: bad100mPlaceholders.length === 0,
  medalTablesRecalculated: badMedalTables.length === 0,
  athleteMedalTotalsRecalculated: badAthleteMedalTotals.length === 0,
  countryMedalTotalsRecalculated: badCountryMedalTotals.length === 0,
  athleteTeamLinksRecalculated: badAthleteTeamLinks.length === 0,
  xcRosterCorrectionApplied,
  xcTimeCorrectionApplied,
  eliteMixedPlacingsRecalculated,
  standardM4044CorrectionApplied,
  standardM4044PlacingsRecalculated,
  standardM4044PodiumCorrect,
  directPayload: JSON.stringify(directContext.window.OCR_DATA) === json,
  compressedPayload: decompressed === json,
  splitPayload: splitPayload === json,
};

const report = {
  passed: Object.values(checks).every(Boolean),
  checks,
  counts: {
    uploadedResultRows: Object.values(resultCounts).reduce((sum, value) => sum + value, 0),
    podiumRecords: data.medals.length,
    resultsByEvent: resultCounts,
    podiumsByEvent: medalCounts,
    final100mResults: data.results.filter(result => result.eventId === '100m' && result.elimination?.Final?.seconds != null).length,
    final100mParticipants: data.results.filter(result => result.eventId === '100m' && result.finalTime != null).length,
    directFinal100mResults: data.results.filter(result => result.eventId === '100m' && result.directFinal).length,
  },
  mismatches: mismatches.slice(0, 20),
  inconsistentResultLinks: inconsistentResultLinks.slice(0, 20),
  bad100mFinals,
  bad100mPlaceholders,
  badCategoryPlacings,
  badMedalTables,
  badAthleteMedalTotals: badAthleteMedalTotals.slice(0, 20),
  badCountryMedalTotals,
  badAthleteTeamLinks: badAthleteTeamLinks.slice(0, 20),
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
