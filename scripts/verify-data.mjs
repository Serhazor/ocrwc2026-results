import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

const data = JSON.parse(fs.readFileSync('data/championship-data.json', 'utf8'));
const results400 = data.results.filter(result => result.eventId === '400m');
const medals400 = data.medals.filter(medal => medal.eventId === '400m');
const finalists = results400.filter(result => result.medal);
const expectedKinds = { Gold: 0, Silver: 0, Bronze: 0 };
medals400.forEach(medal => { expectedKinds[medal.medal] += 1; });

const categoryMedals = new Map();
for (const medal of medals400) {
  if (!categoryMedals.has(medal.category)) categoryMedals.set(medal.category, []);
  categoryMedals.get(medal.category).push(medal);
}
const badCategories = [...categoryMedals]
  .filter(([, medals]) => medals.some((medal, index) => medal.place !== index + 1))
  .map(([category]) => category);
const inconsistentResults = results400.filter(result => (
  (result.medal != null) !== medals400.some(medal => medal.athleteId === result.athleteId && medal.category === result.category)
));

const json = JSON.stringify(data);
const directContext = { window: {} };
vm.runInNewContext(fs.readFileSync('data/championship-data.js', 'utf8'), directContext);
const compressedContext = { window: {} };
vm.runInNewContext(fs.readFileSync('data/championship-data-compressed.js', 'utf8'), compressedContext);
const decompressed = zlib.gunzipSync(Buffer.from(compressedContext.window.OCR_DATA_GZIP_B64, 'base64')).toString();
const partsContext = { window: {} };
for (let index = 1; index <= 5; index += 1) {
  vm.runInNewContext(fs.readFileSync(`data/data-part-${index}.js`, 'utf8'), partsContext);
}
const parts = zlib.gunzipSync(Buffer.from(partsContext.window.OCR_DATA_PARTS.join(''), 'base64')).toString();

const checks = {
  qualifyingResults: results400.length === 407,
  roundOf12: results400.filter(result => result.elimination?.['Round of 12']).length === 23,
  roundOf6: results400.filter(result => result.elimination?.['Round of 6']).length === 134,
  finalists: finalists.length === 98,
  medalRecords: medals400.length === 98,
  medalCategories: categoryMedals.size === 37,
  categoryPlacings: badCategories.length === 0,
  resultMedalLinks: inconsistentResults.length === 0,
  directPayload: JSON.stringify(directContext.window.OCR_DATA) === json,
  compressedPayload: decompressed === json,
  splitPayload: parts === json,
};

console.log(JSON.stringify({
  passed: Object.values(checks).every(Boolean),
  checks,
  counts: {
    results400: results400.length,
    roundOf12: results400.filter(result => result.elimination?.['Round of 12']).length,
    roundOf6: results400.filter(result => result.elimination?.['Round of 6']).length,
    finalists: finalists.length,
    directFinals: finalists.filter(result => result.directFinal).length,
    medals400: medals400.length,
    allMedals: data.medals.length,
  },
  medalKinds: expectedKinds,
  event: data.events.find(event => event.id === '400m'),
  summary: data.summaries['400m'],
  medalTableLeaders: data.medalTables['400m'].slice(0, 5),
  combinedLeaders: data.medalTables.combined.slice(0, 5),
  eliteMedals: medals400.filter(medal => medal.category.includes('Elite')),
  badCategories,
  inconsistentResults: inconsistentResults.map(result => result.id),
}, null, 2));

if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
