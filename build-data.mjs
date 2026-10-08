// Builds a static snapshot of every API response into public/data/ so the app can be
// hosted on GitHub Pages (no server). Starts server.js on a spare port, crawls it, writes JSON.
//   node build-data.mjs
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
const OUT = 'public/data';
const RANGES = ['1mo', '6mo', '1y', '5y', 'max']; // must match the buttons in index.html
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
const stop = () => server.kill();
process.on('exit', stop);

async function get(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path);
      if (r.ok) return await r.json();
      throw new Error(`${r.status}`);
    } catch (e) {
      if (i === tries - 1) throw new Error(`${path}: ${e.message}`);
      await sleep(1500 * (i + 1));
    }
  }
}
const save = (file, data) => fs.writeFile(`${OUT}/${file}`, JSON.stringify(data));

try {
  for (let i = 0; i < 20; i++) { try { await fetch(BASE); break; } catch { await sleep(500); } }
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(`${OUT}/stock`, { recursive: true });
  await fs.mkdir(`${OUT}/chart`, { recursive: true });

  const top = await get('/api/top50');            // fatal if this fails
  await save('top50.json', top);
  await fs.copyFile('pipeline.json', `${OUT}/pipeline.json`);

  const symbols = [...top.rows, ...(top.watch || [])].map((r) => r.symbol);
  let failed = 0;
  const queue = [...symbols];
  const worker = async () => {
    for (let sym; (sym = queue.shift()); ) {
      try {
        await save(`stock/${sym}.json`, await get(`/api/stock/${encodeURIComponent(sym)}`));
        for (const r of RANGES) await save(`chart/${sym}-${r}.json`, await get(`/api/chart/${encodeURIComponent(sym)}?range=${r}`));
        console.log('ok', sym);
      } catch (e) { failed++; console.warn('FAILED', e.message); }
      await sleep(250);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await save('meta.json', { generated: Date.now(), symbols: symbols.length - failed });
  console.log(`Done: ${symbols.length - failed}/${symbols.length} symbols`);
  if (failed > symbols.length / 4) throw new Error('Too many symbols failed; not publishing a bad snapshot');
} finally {
  stop();
}
