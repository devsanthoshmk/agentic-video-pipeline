import {lstatSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function videoRun() {
  if (!process.env.VIDEO_RUN) return undefined;
  const path = process.env.VIDEO_RUN;
  if (!/^videos\/[a-z0-9-]+-\d{3,}$/.test(path)) throw new Error('VIDEO_RUN must be a path returned by video:new');
  const dir = resolve(root, path);
  for (const folder of [join(root, 'videos'), dir, join(dir, 'public'), join(dir, 'out')]) {
    if (!lstatSync(folder).isDirectory()) throw new Error(`Expected a real directory: ${folder}`);
  }
  return dir;
}
