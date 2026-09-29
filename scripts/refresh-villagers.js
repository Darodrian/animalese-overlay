import { loadVillagers } from '../lib/nookipedia.js';

const force = !process.argv.includes('--no-force');

console.log(force ? 'Refreshing villager cache...' : 'Loading villager cache if stale...');

const cache = await loadVillagers({ force });

const c = cache.counts ?? {};
console.log(`  series villagers      : ${c.series ?? '?'}`);
console.log(`  new horizons          : ${c.newHorizons ?? '?'}`);
console.log(`  portraits resolved    : ${c.resolved ?? cache.villagers.length}`);
console.log(`  of which NH portraits : ${c.portraits ?? '?'}`);
console.log(`  unresolved images     : ${c.unresolvedImages ?? 0}`);
console.log(`  generated             : ${cache.generated}`);
if (cache.stale) console.log('  WARNING: served stale data');

const missingUrls = cache.villagers.filter((v) => !v.imageUrl).length;
if (missingUrls) {
  console.error(`  ERROR: ${missingUrls} villagers have no imageUrl`);
  process.exitCode = 1;
}
