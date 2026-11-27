import {existsSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

function usage() {
  console.error('Usage: node scripts/capture-screenshots.mjs --url <https://...> --out <file.png> [--selector <css>] [--wait 1500] [--width 1440] [--height 900] [--scale 2] [--full-page]');
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = {wait: 1500, width: 1440, height: 900, scale: 2, fullPage: false};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--url') opts.url = args[++i];
  else if (a === '--out') opts.out = args[++i];
  else if (a === '--selector') opts.selector = args[++i];
  else if (a === '--wait') opts.wait = Number(args[++i]) || 1500;
  else if (a === '--width') opts.width = Number(args[++i]) || 1440;
  else if (a === '--height') opts.height = Number(args[++i]) || 900;
  else if (a === '--scale') opts.scale = Number(args[++i]) || 2;
  else if (a === '--full-page') opts.fullPage = true;
  else usage();
}

if (!opts.url || !opts.out) usage();
const dest = resolve(opts.out);
if (existsSync(dest)) {
  console.error(`Output already exists: ${dest}`);
  process.exit(1);
}
mkdirSync(dirname(dest), {recursive: true});

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('puppeteer-core is not installed in this project.');
  process.exit(1);
}

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = chromeCandidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Chromium executable found. Set PUPPETEER_EXECUTABLE_PATH.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: {width: opts.width, height: opts.height, deviceScaleFactor: opts.scale},
});

try {
  const page = await browser.newPage();
  await page.goto(opts.url, {waitUntil: 'networkidle2', timeout: 30000});
  if (opts.selector) {
    await page.waitForSelector(opts.selector, {timeout: 15000});
  }
  await new Promise((r) => setTimeout(r, opts.wait));
  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (!el) throw new Error(`Selector not found: ${opts.selector}`);
    await el.screenshot({path: dest});
  } else {
    await page.screenshot({path: dest, fullPage: opts.fullPage});
  }
  console.log(dest);
} finally {
  await browser.close();
}
