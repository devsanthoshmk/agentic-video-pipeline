import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'media-smoke-'));

function run(command, args, expectedError) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (result.error) throw result.error;
  if (expectedError) {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, expectedError);
  } else {
    assert.equal(result.status, 0, result.stderr);
  }
  return result.stdout;
}

try {
  // Use an isolated project so the smoke test cannot modify the user's out/ directory.
  mkdirSync(join(root, 'scripts'));
  const cli = join(root, 'scripts', 'media.mjs');
  copyFileSync(new URL('./media.mjs', import.meta.url), cli);
  copyFileSync(new URL('./video-run.mjs', import.meta.url), join(root, 'scripts', 'video-run.mjs'));
  const media = (args, expectedError) => run(process.execPath, [cli, ...args], expectedError);
  const probe = file => JSON.parse(media(['probe', file]));

  for (const audio of [true, false]) {
    const name = audio ? '-input with audio.mp4' : 'silent.mp4';
    const source = join(root, name);
    const filename = audio ? 'audio clip.mp4' : 'silent clip.mp4';
    const destination = join(root, 'out', filename);
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24',
      ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:a', 'aac'] : []),
      '-t', '2', '-c:v', 'mpeg4', source,
    ]);
    const original = readFileSync(source);
    const types = info => info.streams.map(stream => stream.codec_type).sort();
    assert.deepEqual(types(probe(name)), audio ? ['audio', 'video'] : ['video']);
    const command = ['trim', name, '1.25', '.75', filename];
    assert.equal(media(command).trim(), destination);
    const clip = probe(destination);
    assert.deepEqual(types(clip), audio ? ['audio', 'video'] : ['video']);
    assert.ok(Math.abs(Number(clip.format.duration) - 0.75) < 0.1, clip.format.duration);
    const saved = readFileSync(destination);
    media(command, /already exists/);
    assert.deepEqual(readFileSync(destination), saved);
    assert.deepEqual(readFileSync(source), original);
  }

  media(['probe', 'missing.mp4'], /ENOENT/);
  media(['probe', '.'], /regular local file/);
  media(['trim', 'silent.mp4', '0', '1', '../escaped.mp4'], /plain .mp4 filename/);
  media(['trim', 'silent.mp4', '-1', '1', 'bad.mp4'], /Start must be/);
  media(['trim', 'silent.mp4', '0', '0', 'bad.mp4'], /greater than zero/);
  media(['trim', 'silent.mp4', '1.5', '0.500001', 'bad.mp4'], /exceeds input duration/);
  assert.deepEqual(readdirSync(join(root, 'out')).sort(), ['audio clip.mp4', 'silent clip.mp4']);
  console.log('Media smoke tests passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
