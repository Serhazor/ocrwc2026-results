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

for (const expected of source.medals) {
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

await writePayloads(data);
console.log(JSON.stringify({ finalTimesRepaired, sourceNamesRepaired, podiumRecordsSynchronized: source.medals.length }, null, 2));
