// Build step: the licences of the fonts the PDF export embeds (OFL 1.1, Apache 2.0) ship next to
// the font modules, as both licences require: dist/export/pdf/fonts/LICENSES.md.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src/export/pdf/fonts/LICENSES.md');
const to = join(root, 'dist/export/pdf/fonts/LICENSES.md');
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log('wrote dist/export/pdf/fonts/LICENSES.md');
