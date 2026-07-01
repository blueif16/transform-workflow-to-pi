import { describe, it, expect } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packRunDir, unpackRunDir, BUNDLE_EXCLUDE } from '../src/runner/migrate.js';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}
async function write(root: string, rel: string, body: string | Buffer): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

// P6 — the run-dir BUNDLE: the portable snapshot a migration ships laptop⇄cloud, reloaded on the target.
describe('run-dir bundle pack/unpack', () => {
  it('round-trips the whole run-dir: nested files + exact bytes survive pack → unpack into a fresh dir', async () => {
    const src = await tmpDir('piflow-bundle-src-');
    await write(src, '.pi/journal.json', '{"version":3,"nodes":{"a":{}}}');
    await write(src, '.pi/nodes/a/prompt.md', 'do a\n');
    await write(src, 'a.txt', 'produced-by-a');
    // a byte-y artifact (non-utf8) to prove base64 fidelity, not just text.
    await write(src, 'nested/deep/blob.bin', Buffer.from([0, 1, 2, 255, 254, 128]));

    const bundle = await packRunDir(src);
    expect(Buffer.isBuffer(bundle)).toBe(true);

    const dst = await tmpDir('piflow-bundle-dst-');
    await unpackRunDir(bundle, dst);

    expect(await fs.readFile(path.join(dst, '.pi/journal.json'), 'utf8')).toBe('{"version":3,"nodes":{"a":{}}}');
    expect(await fs.readFile(path.join(dst, '.pi/nodes/a/prompt.md'), 'utf8')).toBe('do a\n');
    expect(await fs.readFile(path.join(dst, 'a.txt'), 'utf8')).toBe('produced-by-a');
    expect([...(await fs.readFile(path.join(dst, 'nested/deep/blob.bin')))]).toEqual([0, 1, 2, 255, 254, 128]);
  });

  it('EXCLUDES host-local coordination sentinels (run.lock, freeze) so they never travel to the target', async () => {
    const src = await tmpDir('piflow-bundle-src-');
    await write(src, '.pi/journal.json', '{}');
    await write(src, '.pi/run.lock', '{"pid":123}'); // must NOT travel — target would see itself locked
    await write(src, '.pi/freeze', 'ts'); // must NOT travel — target would re-park immediately

    const dst = await tmpDir('piflow-bundle-dst-');
    await unpackRunDir(await packRunDir(src), dst);

    expect(existsSync(path.join(dst, '.pi/journal.json'))).toBe(true);
    expect(existsSync(path.join(dst, '.pi/run.lock'))).toBe(false);
    expect(existsSync(path.join(dst, '.pi/freeze'))).toBe(false);
    // The default exclude set names exactly those two sentinels.
    expect(BUNDLE_EXCLUDE).toEqual(expect.arrayContaining(['.pi/run.lock', '.pi/freeze']));
  });

  it('unpack returns the written relative paths and creates missing parent directories', async () => {
    const src = await tmpDir('piflow-bundle-src-');
    await write(src, '.pi/state.json', '{"channels":{}}');
    await write(src, 'out/report.md', '# report');

    const dst = await tmpDir('piflow-bundle-dst-');
    const written = await unpackRunDir(await packRunDir(src), dst);
    expect(written.sort()).toEqual(['.pi/state.json', 'out/report.md']);
  });
});
