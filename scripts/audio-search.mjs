const [category, ...words] = process.argv.slice(2);
const query = words.join(' ').trim();
if (!['music', 'sound_effect'].includes(category) || !query) {
  console.error('Usage: npm run audio:search -- <music|sound_effect> "search terms"');
  process.exit(2);
}
try {
  const url = new URL('https://api.openverse.org/v1/audio/');
  // Freesound effects can be indexed without a category label.
  const scope = category === 'music' ? {category} : {source: 'freesound'};
  url.search = new URLSearchParams({q: query, ...scope, license: 'cc0,by', page_size: '8'});
  const response = await fetch(url, {signal: AbortSignal.timeout(15000), headers: {accept: 'application/json'}});
  if (!response.ok) throw new Error(`Openverse returned HTTP ${response.status}`);
  const {results} = await response.json();
  console.log(JSON.stringify(results.filter((r) => ['cc0', 'by'].includes(r.license) && r.foreign_landing_url && r.license_url).map((r) => ({
    title: r.title, creator: r.creator, source: r.foreign_landing_url, provider: r.provider,
    license: r.license_url, attribution: r.attribution, durationMs: r.duration,
  })), null, 2));
} catch (error) {
  console.error(`Stock search failed: ${error.message}${error.cause ? ` (${error.cause.message})` : ''}`);
  process.exitCode = 1;
}
