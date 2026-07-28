import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = new URL('../node_modules/occt-import-js/dist/', import.meta.url);
const destination = new URL('../public/vendor/', import.meta.url);

await mkdir(destination, { recursive: true });
for (const filename of ['occt-import-js.js', 'occt-import-js.wasm']) {
  await cp(new URL(filename, source), new URL(filename, destination));
}

