import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoRun} from './video-run.mjs';

const legacy = process.env.VIDEO_TTS_ENGINE === 'supertonic';
const model = process.env.VIDEO_KOKORO_DIR || join(homedir(), '.cache/kokoro-82m');
const python = legacy ? (process.env.VIDEO_TTS_PYTHON || 'python3') : (process.env.VIDEO_KOKORO_PYTHON || join(model, '.venv/bin/python'));
const script = fileURLToPath(new URL(legacy ? './audio-voice.py' : './audio-kokoro.py', import.meta.url));
const result = spawnSync(python, [script, ...process.argv.slice(2)], {
  stdio: 'inherit', env: {...process.env, VIDEO_RUN_ROOT: videoRun() ?? '', VIDEO_KOKORO_DIR: model},
});
if (result.error) console.error(`Cannot start narration runtime (${python}): ${result.error.message}`);
process.exitCode = result.status ?? 1;
