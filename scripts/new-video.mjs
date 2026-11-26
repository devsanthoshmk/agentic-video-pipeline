import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('Usage: npm run video:new -- "Video title"');
  process.exit(2);
}
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '') || 'video';
const parent = fileURLToPath(new URL('../videos/', import.meta.url));
mkdirSync(parent, {recursive: true});
for (let n = 1; ; n++) {
  const id = `${slug}-${String(n).padStart(3, '0')}`;
  const folder = join(parent, id);
  try {
    mkdirSync(folder);
  } catch (error) {
    if (error.code === 'EEXIST') continue;
    throw error;
  }
  for (const dir of ['src', 'public', 'out']) mkdirSync(join(folder, dir));
  writeFileSync(join(folder, 'brief.md'), `# ${title.replace(/\s+/g, ' ')}\n\nRun: ${id}\n\n`, {flag: 'wx'});
  console.log(`videos/${id}`);
  break;
}
