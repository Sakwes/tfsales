// Offline Vite config tests. Imports configuration only; no servers or API calls.
import assert from 'node:assert/strict';
import { loadConfigFromFile } from 'vite';
const names = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SELLNOVA_ISOLATED_MOCKS'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const dev = 'https://qfcnaceeppgrquoszkor.supabase.co';
let checks = 0;
async function check(mode, values, allowed) {
  for (const name of names) {
    if (values[name] === undefined) delete process.env[name]; else process.env[name] = values[name];
  }
  let succeeded = false;
  const previousError = console.error;
  try {
    console.error = () => {}; // Expected refusal messages contain no values; keep output concise.
    const result = await loadConfigFromFile({ command: 'build', mode }, 'vite.config.ts');
    succeeded = !!result;
  } catch { /* expected for rejected configurations */ }
  finally { console.error = previousError; }
  assert.equal(succeeded, allowed, 'Configuration guard outcome');
  checks++;
}
try {
  await check('production', {}, false); // Conflicting tracked dotenv cannot select production.
  await check('development', { VITE_SUPABASE_URL: 'https://tepvbliaxwgbdeisttgj.supabase.co' }, false);
  await check('production', { VITE_SUPABASE_URL: dev, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test' }, true);
  await check('production', { VITE_SUPABASE_URL: dev, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_test' }, false);
  const mock = { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'mock-public-key' };
  await check('development', mock, false);
  await check('development', { ...mock, SELLNOVA_ISOLATED_MOCKS: '1' }, true);
  await check('production', { ...mock, SELLNOVA_ISOLATED_MOCKS: '1' }, false);
  console.log(`PASS: ${checks} offline development-target/key/mock configuration checks`);
} finally {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  }
}
