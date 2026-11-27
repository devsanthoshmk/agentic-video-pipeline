import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoRun} from './video-run.mjs';

const rawArgs = process.argv.slice(2);
const legacy = process.env.VIDEO_TTS_ENGINE === 'supertonic';

function getFlagValue(args, name) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

function findNvidiaLibDirs(venvRoot) {
  const libDir = join(venvRoot, 'lib');
  if (!existsSync(libDir)) return [];
  const pyDirs = readdirSync(libDir).filter((d) => d.startsWith('python'));
  const found = [];
  for (const py of pyDirs) {
    const nvidiaDir = join(libDir, py, 'site-packages/nvidia');
    if (!existsSync(nvidiaDir)) continue;
    for (const pkg of readdirSync(nvidiaDir)) {
      const candidate = join(nvidiaDir, pkg, 'lib');
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
}

const model = process.env.VIDEO_KOKORO_DIR || join(homedir(), '.cache/kokoro-82m');
const gpuFlag = getFlagValue(rawArgs, '--gpu') ?? (process.env.VIDEO_GPU === '1' ? 'auto' : 'off');
const gpuVenvRoot = process.env.VIDEO_KOKORO_GPU_VENV || join(model, '.venv-gpu');
const cpuVenvRoot = join(model, '.venv');
const hasGpuVenv = existsSync(join(gpuVenvRoot, 'bin/python'));

let python;
let childLdPath = process.env.LD_LIBRARY_PATH || '';
const finalArgs = [...rawArgs];

if (legacy) {
  python = process.env.VIDEO_TTS_PYTHON || 'python3';
} else {
  const useGpuVenv = (gpuFlag === 'on' || gpuFlag === 'auto') && hasGpuVenv;
  const selectedVenv = useGpuVenv ? gpuVenvRoot : cpuVenvRoot;
  python = process.env.VIDEO_KOKORO_PYTHON || (existsSync(join(selectedVenv, 'bin/python')) ? join(selectedVenv, 'bin/python') : 'python3');
  if (useGpuVenv) {
    const nvLibs = findNvidiaLibDirs(gpuVenvRoot);
    if (nvLibs.length > 0) {
      childLdPath = childLdPath ? `${nvLibs.join(':')}:${childLdPath}` : nvLibs.join(':');
    }
  }
  if (!rawArgs.some((a) => a === '--gpu' || a.startsWith('--gpu=')) && gpuFlag !== 'off') {
    finalArgs.push('--gpu', gpuFlag);
  }
}

const script = fileURLToPath(new URL(legacy ? './audio-voice.py' : './audio-kokoro.py', import.meta.url));
const env = {
  ...process.env,
  VIDEO_RUN_ROOT: videoRun() ?? '',
  VIDEO_KOKORO_DIR: model,
};
if (childLdPath) env.LD_LIBRARY_PATH = childLdPath;

const result = spawnSync(python, [script, ...finalArgs], {stdio: 'inherit', env});
if (result.error) console.error(`Cannot start narration runtime (${python}): ${result.error.message}`);
process.exitCode = result.status ?? 1;
