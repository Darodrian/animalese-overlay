import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.join(ROOT, 'data');
export const SOUNDS_DIR = path.join(PUBLIC_DIR, 'sounds');

export const VILLAGERS_CACHE = path.join(DATA_DIR, 'villagers.json');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
