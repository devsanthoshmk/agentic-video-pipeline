import { spawnSync } from 'node:child_process';
import { linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {videoRun} from './video-run.mjs';

const runDir = videoRun();
const outDir = runDir ? join(runDir, 'out') : fileURLToPath(new URL('../out/', import.meta.url));
const usage = 'Usage: node scripts/media.mjs probe <local-file>\n'
  + '       node scripts/media.mjs trim <local-file> <start-seconds> <duration-seconds> <filename.mp4>';

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') throw new Error(`${command} not found on PATH`);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim() || result.signal || result.status}`);
  }
  return result.stdout;
}

function localFile(path) {
  const file = realpathSync(resolve(path));
  if (!statSync(file).isFile()) throw new Error('Input must be a regular local file');
  return file;
}

function probe(file) {
  return JSON.parse(run('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-of', 'json', '-i', file,
  ]));
}

function seconds(text, label) {
  // FFmpeg's time arguments have microsecond precision. Use integer arithmetic for bounds.
  const parts = /^(\d+)(?:\.(\d{1,6}))?$|^\.(\d{1,6})$/.exec(text);
  if (!parts || parts[0] !== text) {
    throw new Error(`${label} must be non-negative decimal seconds (up to 6 decimal places)`);
  }
  const micros = BigInt(parts[1] ?? 0) * 1_000_000n
    + BigInt((parts[2] ?? parts[3] ?? '').padEnd(6, '0'));
  if (micros > 9_223_372_036_854_775_807n) throw new Error(`${label} is too large`);
  return micros;
}

function hasVideo(info) {
  return info.streams?.some(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
}

function trim(file, start, duration, filename) {
  if (!/^[^/\\:\x00-\x1f\x7f]+\.mp4$/i.test(filename) || !filename.toLowerCase().endsWith('.mp4')) {
    throw new Error('Output must be a plain .mp4 filename, not a path');
  }
  const offset = seconds(start, 'Start');
  const length = seconds(duration, 'Duration');
  if (length === 0n) throw new Error('Duration must be greater than zero');

  const info = probe(file);
  if (!hasVideo(info)) throw new Error('Input has no video stream');
  const available = seconds(info.format?.duration ?? '', 'Input duration');
  if (offset >= available || offset + length > available) {
    throw new Error(`Requested interval exceeds input duration (${info.format.duration} seconds)`);
  }

  mkdirSync(outDir, { recursive: true });
  // Strip the trailing slash for lstat so a symlink is not followed.
  if (!lstatSync(resolve(outDir)).isDirectory()) throw new Error('out/ must be a real directory');
  const destination = join(outDir, filename);
  const tempDir = mkdtempSync(join(outDir, '.trim-'));
  const staged = join(tempDir, 'clip.mp4');
  try {
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file',
      '-ss', `${offset}us`, '-i', file, '-t', `${length}us`, '-map', '0:V:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', staged,
    ]);
    if (!hasVideo(probe(staged))) throw new Error('Trim produced no video frames');
    // The completed file is on the same filesystem; link publishes it atomically without replacing anything.
    try {
      linkSync(staged, destination);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Output already exists: ${filename}`);
      throw error;
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  console.log(destination);
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'probe' && args.length === 1) {
    console.log(JSON.stringify(probe(localFile(args[0])), null, 2));
  } else if (command === 'trim' && args.length === 4) {
    trim(localFile(args[0]), ...args.slice(1));
  } else {
    throw new Error(usage);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
