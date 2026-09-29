import fs from 'node:fs/promises';
import { SOUNDS_DIR } from '../lib/paths.js';

const BASE =
  'https://raw.githubusercontent.com/izure1/animalese-tts/main/docs/sounds';

const FILES = [
  { name: 'english-sprite.wav', bytes: 1279244 },
  { name: 'english-sprite.json', bytes: 2023 },
];

const UA = 'animalese-overlay/1.0 (self-hosted streaming overlay)';

async function isValidWav(buf) {
  return (
    buf.length > 44 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  );
}

async function alreadyGood(file) {
  try {
    const buf = await fs.readFile(`${SOUNDS_DIR}/${file.name}`);
    if (buf.length !== file.bytes) {
      console.log(`  ~ ${file.name} exists but is ${buf.length} bytes (expected ${file.bytes})`);
      return false;
    }
    if (file.name.endsWith('.wav') && !(await isValidWav(buf))) {
      console.log(`  ~ ${file.name} exists but is not a valid RIFF/WAVE file`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function download(file) {
  const res = await fetch(`${BASE}/${file.name}`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${file.name}: HTTP ${res.status} ${res.statusText}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== file.bytes) {
    console.warn(
      `  ! ${file.name} is ${buf.length} bytes, expected ${file.bytes}. Upstream may have changed it.`,
    );
  }
  if (file.name.endsWith('.wav') && !(await isValidWav(buf))) {
    throw new Error(`${file.name} did not download as a valid RIFF/WAVE file`);
  }
  if (file.name.endsWith('.json')) JSON.parse(buf.toString('utf8'));

  await fs.mkdir(SOUNDS_DIR, { recursive: true });
  await fs.writeFile(`${SOUNDS_DIR}/${file.name}`, buf);
  return buf.length;
}

console.log('Setting up audio sprite...');
await fs.mkdir(SOUNDS_DIR, { recursive: true });

for (const file of FILES) {
  if (await alreadyGood(file)) {
    console.log(`  = ${file.name} (${file.bytes} bytes, already present)`);
    continue;
  }
  const size = await download(file);
  console.log(`  + ${file.name} (${size} bytes)`);
}

console.log('Sprite ready. Next: npm run refresh');
