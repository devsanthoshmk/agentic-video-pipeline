import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';

mkdirSync('out', {recursive: true});
const dir = mkdtempSync('out/smoke-');
const path = join(dir, 'demo.mp4');
try {
  execFileSync('npm', ['run', 'render', '--', 'Demo', path, '--concurrency=2', '--log=error'], {stdio: 'inherit'});
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]));
  const video = metadata.streams.find((stream) => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.width, video.height, video.avg_frame_rate], ['h264', 1280, 720, '30/1']);
  assert.ok(Math.abs(Number(metadata.format.duration) - 5) < 0.04);
  const hashes = execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-an', '-f', 'framemd5', '-'], {encoding: 'utf8'})
    .split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.split(',').at(-1).trim());
  assert.equal(hashes.length, 150);
  assert.notEqual(hashes[0], hashes.at(-1));
  console.log('Remotion smoke passed: 150 changing frames, 1280×720, 30 fps, 5 seconds.');
} finally {
  rmSync(path, {force: true});
  rmSync(dir, {recursive: true});
}
