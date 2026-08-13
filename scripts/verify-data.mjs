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
const medalKey = item => `${item.eventId}|${item.category}|${item.place}`;
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
  if (!nameMatches || actual.time !== expected.time || !close(actual.timeSeconds, expected.timeSeconds) || actual.medal !== expected.medal) {
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
  if (!result || result.medal !== medal.medal || result.time !== medal.time || !close(result.timeSeconds, medal.timeSeconds)) {
    inconsistentResultLinks.push({ medalId: medal.id, resultId: result?.id ?? null });
  }
}

const bad100mFinals = data.results
  .filter(result => result.eventId === '100m' && result.elimination?.Final?.seconds != null)
  .filter(result => result.time !== result.finalTime || !close(result.timeSeconds, result.elimination?.Final?.seconds))
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
    directFinal100mResults: data.results.filter(result => result.eventId === '100m' && result.directFinal).length,
  },
  mismatches: mismatches.slice(0, 20),
  inconsistentResultLinks: inconsistentResultLinks.slice(0, 20),
  bad100mFinals,
  bad100mPlaceholders,
  badCategoryPlacings,
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
