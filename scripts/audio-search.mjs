import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {videoRun} from './video-run.mjs';

function usage() {
  console.error(
    'Usage:\n' +
    '  node scripts/audio-search.mjs <music|sound_effect> "search terms" [--source all|wikimedia_audio|freesound|jamendo] [--limit 10]\n' +
    '  node scripts/audio-search.mjs download <official-url> <filename> --source-page <url> --creator <name> --license <url> --title <title> [--evidence <notes>] [--manifest <path>]\n' +
    '  node scripts/audio-search.mjs verify-cache <manifest.json> <item-id> <dest-filename> --authorize-reuse'
  );
  process.exit(2);
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function probeAndDecodeAudio(file) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', '-i', file,
  ], {encoding: 'utf8'});
  if (probe.error || probe.status !== 0) {
    throw new Error(`ffprobe failed: ${probe.stderr?.trim() || probe.error?.message}`);
  }
  const info = JSON.parse(probe.stdout);
  const audioStream = (info.streams || []).find((s) => s.codec_type === 'audio');
  if (!audioStream) throw new Error('Downloaded file contains no audio stream.');

  const dec = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'info', '-v', 'error', '-xerror', '-i', file,
    '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-',
  ], {encoding: 'utf8'});
  if (dec.error || dec.status !== 0) {
    throw new Error(`Full audio decode failed: ${dec.stderr?.trim() || dec.error?.message}`);
  }
  return {
    codec: audioStream.codec_name,
    sample_rate: Number(audioStream.sample_rate),
    channels: Number(audioStream.channels),
    duration_s: Number(info.format?.duration || audioStream.duration || 0),
    bit_rate: Number(info.format?.bit_rate || audioStream.bit_rate || 0),
  };
}

function classifyCandidate(r) {
  const url = String(r.url || '');
  const landing = String(r.foreign_landing_url || '');
  const warnings = [];
  if (r.provider === 'jamendo' || landing.includes('jamendo.com')) {
    warnings.push('jamendo_often_login_or_personal_only_verify_commercial_rights');
  }
  if (url.includes('cdn.freesound.org/previews/') || url.endsWith('-hq.mp3')) {
    warnings.push('freesound_preview_stream_not_official_original');
  }
  return warnings;
}

async function searchCmd(args) {
  const category = args[0];
  if (!['music', 'sound_effect'].includes(category)) usage();
  let sourceMode = 'all';
  let limit = 10;
  const words = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--source') sourceMode = args[++i];
    else if (args[i] === '--limit') limit = Math.min(20, Math.max(1, Number(args[++i]) || 10));
    else words.push(args[i]);
  }
  const query = words.join(' ').trim();
  if (!query) usage();

  const scopes =
    sourceMode !== 'all'
      ? [{source: sourceMode}]
      : category === 'music'
        ? [{source: 'wikimedia_audio'}, {source: 'freesound'}, {category: 'music'}]
        : [{source: 'freesound'}, {source: 'wikimedia_audio'}];

  const settled = await Promise.allSettled(
    scopes.map(async (scope) => {
      const url = new URL('https://api.openverse.org/v1/audio/');
      url.search = new URLSearchParams({
        q: query,
        ...scope,
        license: 'cc0,by',
        page_size: String(limit),
      });
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {accept: 'application/json'},
      });
      if (!response.ok) throw new Error(`Openverse HTTP ${response.status} for ${JSON.stringify(scope)}`);
      const data = await response.json();
      return data.results || [];
    })
  );

  const seen = new Set();
  const candidates = [];
  const errors = [];

  for (const item of settled) {
    if (item.status === 'rejected') {
      errors.push(item.reason?.message || String(item.reason));
      continue;
    }
    for (const r of item.value) {
      if (!['cc0', 'by'].includes(r.license) || !r.foreign_landing_url || !r.license_url) continue;
      const key = r.id || r.foreign_landing_url;
      if (seen.has(key)) continue;
      seen.add(key);
      const warnings = classifyCandidate(r);
      candidates.push({
        id: r.id,
        title: r.title,
        creator: r.creator,
        source_page: r.foreign_landing_url,
        candidate_audio_url: r.url,
        provider: r.provider,
        license: r.license_url,
        attribution: r.attribution,
        durationMs: r.duration,
        warnings,
      });
    }
  }

  candidates.sort((a, b) => a.warnings.length - b.warnings.length);
  console.log(JSON.stringify({
    query,
    category,
    count: candidates.length,
    errors,
    note: 'Verify canonical source_page license and download official original (never preview streams).',
    candidates,
  }, null, 2));
}

async function downloadCmd(args) {
  const [downloadUrl, filename, ...rest] = args;
  if (!downloadUrl || !filename || PathBad(filename)) usage();
  let sourcePage = '', creator = '', license = '', title = '', evidence = 'Verified canonical source page', manifestPath = '';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--source-page') sourcePage = rest[++i];
    else if (rest[i] === '--creator') creator = rest[++i];
    else if (rest[i] === '--license') license = rest[++i];
    else if (rest[i] === '--title') title = rest[++i];
    else if (rest[i] === '--evidence') evidence = rest[++i];
    else if (rest[i] === '--manifest') manifestPath = rest[++i];
    else usage();
  }
  if (!sourcePage || !creator || !license || !title) {
    throw new Error('download requires --source-page, --creator, --license, and --title for provenance.');
  }
  if (downloadUrl.includes('cdn.freesound.org/previews/') || downloadUrl.endsWith('-hq.mp3')) {
    throw new Error('Refusing to stage Freesound preview stream URL; supply verified official original download.');
  }

  const runDir = videoRun();
  const audioDir = runDir ? join(runDir, 'public/media/audio') : resolve('public/media/audio');
  mkdirSync(audioDir, {recursive: true});
  const dest = join(audioDir, filename);
  if (existsSync(dest)) throw new Error(`Destination already exists: ${dest}`);

  const tempDir = mkdtempSync(join(audioDir, '.dl-'));
  const tmpFile = join(tempDir, filename);
  try {
    const resp = await fetch(downloadUrl, {signal: AbortSignal.timeout(45000)});
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    writeFileSync(tmpFile, buf);
    const ffprobeSummary = probeAndDecodeAudio(tmpFile);
    const sha256 = sha256File(tmpFile);
    linkSync(tmpFile, dest);

    const cacheRoot = process.env.VIDEO_AUDIO_CACHE_DIR || join(homedir(), '.cache/agentic-video-pipeline/stock-audio');
    mkdirSync(cacheRoot, {recursive: true});
    const mPath = manifestPath ? resolve(manifestPath) : join(cacheRoot, 'manifest.json');
    const manifest = existsSync(mPath) ? JSON.parse(readFileSync(mPath, 'utf8')) : {items: []};
    const entry = {
      item_id: sha256.slice(0, 16),
      title,
      creator,
      source_page: sourcePage,
      official_url: downloadUrl,
      license_version_url: license,
      verified_date: new Date().toISOString(),
      verification_evidence: evidence,
      permitted_uses: ['personal', 'commercial', 'sync', 'edit'],
      sha256,
      staged_path: dest,
      ffprobe_summary: ffprobeSummary,
    };
    const cachedFile = join(cacheRoot, `${sha256}-${filename}`);
    if (!existsSync(cachedFile)) writeFileSync(cachedFile, readFileSync(dest));
    entry.cached_file = cachedFile;
    manifest.items = manifest.items.filter((x) => x.sha256 !== sha256);
    manifest.items.push(entry);
    writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf8');

    console.log(JSON.stringify({staged: dest, manifest: mPath, entry}, null, 2));
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
}

function verifyCacheCmd(args) {
  const [manifestArg, itemId, destName, ...rest] = args;
  if (!manifestArg || !itemId || !destName || PathBad(destName)) usage();
  if (!rest.includes('--authorize-reuse')) {
    throw new Error('Cross-run/offline reuse requires explicit --authorize-reuse after checking run isolation.');
  }
  const mPath = resolve(manifestArg);
  const manifest = JSON.parse(readFileSync(mPath, 'utf8'));
  const entry = (manifest.items || []).find((x) => x.item_id === itemId || x.sha256 === itemId);
  if (!entry) throw new Error(`Manifest item not found: ${itemId}`);
  if (!entry.cached_file || !existsSync(entry.cached_file)) {
    throw new Error(`Cached audio file missing: ${entry.cached_file}`);
  }
  const actualHash = sha256File(entry.cached_file);
  if (actualHash !== entry.sha256) {
    throw new Error(`SHA-256 mismatch for ${entry.cached_file} (expected ${entry.sha256}, got ${actualHash})`);
  }
  const runDir = videoRun();
  const audioDir = runDir ? join(runDir, 'public/media/audio') : resolve('public/media/audio');
  mkdirSync(audioDir, {recursive: true});
  const dest = join(audioDir, destName);
  if (existsSync(dest)) throw new Error(`Destination already exists: ${dest}`);
  writeFileSync(dest, readFileSync(entry.cached_file));
  console.log(JSON.stringify({staged: dest, cache_hit: true, sha256: actualHash, entry}, null, 2));
}

function PathBad(name) {
  return !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

try {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage();
  if (argv[0] === 'download') await downloadCmd(argv.slice(1));
  else if (argv[0] === 'verify-cache') verifyCacheCmd(argv.slice(1));
  else await searchCmd(argv);
} catch (error) {
  console.error(`Stock audio operation failed: ${error.message}${error.cause ? ` (${error.cause.message})` : ''}`);
  process.exitCode = 1;
}
