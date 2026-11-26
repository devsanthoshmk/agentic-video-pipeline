import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoRun} from './video-run.mjs';

try {
  const [action, ...params] = process.argv.slice(2);
  const dir = videoRun();
  if (!dir) throw new Error('Set VIDEO_RUN to the path returned by video:new.');
  const entry = join(dir, 'src/index.ts');
  const publicDir = `--public-dir=${join(dir, 'public')}`;
  let args;
  if (action === 'preview' && params.length === 0) {
    args = ['studio', entry, publicDir, '--no-open'];
  } else if (action === 'render') {
    const [composition, filename, mode = 'cpu'] = params;
    if (params.length > 3 || !composition || !/^[A-Za-z0-9_-]+$/.test(composition) ||
        !filename || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/.test(filename) || !['cpu', 'gpu'].includes(mode)) {
      throw new Error('Usage: VIDEO_RUN=videos/<run> npm run video:render -- <composition> <filename.mp4> [cpu|gpu]');
    }
    const concurrency = process.env.REMOTION_CONCURRENCY || '4';
    args = ['render', entry, composition, join(dir, 'out', filename), publicDir, `--concurrency=${concurrency}`, '--overwrite=false'];
    if (mode === 'gpu') args.push('--hardware-acceleration=required', '--video-bitrate=8M');
    else args.push('--hardware-acceleration=disable');
  } else {
    throw new Error('Use video:preview without arguments, or video:render with an output filename.');
  }
  const cli = fileURLToPath(new URL('../node_modules/@remotion/cli/remotion-cli.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, ...args], {stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
