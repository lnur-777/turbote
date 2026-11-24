import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseListings, normalizeSearchUrl, extractUrl } from '../src/turbo.js';
import { Store } from '../src/storage.js';

test('parseListings: elan kartlarını oxuyur', () => {
  const html = fs.readFileSync(new URL('./fixtures/autos.html', import.meta.url), 'utf8');
  const r = parseListings(html);
  assert.equal(r.title, 'Mercedes almaq');
  assert.equal(r.total, 5999);
  assert.ok(r.items.length >= 30, `items: ${r.items.length}`);
  const first = r.items[0];
  assert.equal(first.id, 9832444);
  assert.equal(first.url, 'https://turbo.az/autos/9832444-mercedes-e-350-e');
  assert.equal(first.name, 'Mercedes E 350 e');
  assert.equal(first.price, '140 928 ₼');
  assert.equal(first.attributes, '2025, 2.0 L, 0 km');
  assert.equal(first.datetime, 'Bakı, bugün 12:14');
  assert.ok(first.image.startsWith('https://'));
  assert.deepEqual(first.labels, ['Rəsmi']);
  assert.equal(first.barter, true);
  assert.equal(first.vip, true);
  assert.equal(new Set(r.items.map((i) => i.id)).size, r.items.length);
});

test('normalizeSearchUrl: filtrləri saxlayır, sıralamanı tarixə çevirir', () => {
  const u = normalizeSearchUrl('https://turbo.az/autos?page=3&q%5Bmake%5D%5B%5D=4&q%5Bprice_to%5D=30000&q%5Bsort%5D=price_asc');
  const p = new URL(u).searchParams;
  assert.equal(p.get('page'), null);
  assert.equal(p.get('q[sort]'), 'date');
  assert.deepEqual(p.getAll('q[make][]'), ['4']);
  assert.equal(p.get('q[price_to]'), '30000');
  assert.equal(normalizeSearchUrl('https://turbo.az/autos/123-bmw'), null);
  assert.equal(normalizeSearchUrl('https://tap.az/autos'), null);
  assert.equal(normalizeSearchUrl('salam'), null);
});

test('extractUrl: mətndən linki tapır', () => {
  assert.equal(extractUrl('bax turbo.az/autos?q[make][]=4 Mercedes').url, 'https://turbo.az/autos?q[make][]=4');
  assert.equal(extractUrl('https://turbo.az/autos?x=1').url, 'https://turbo.az/autos?x=1');
  assert.equal(extractUrl('heç nə'), null);
});

test('Store: lokal fayl yoxdursa GitHub Gist-dən bərpa edir və dəyişikliyi sinxronlaşdırır', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turboaz-store-'));
  const dbPath = path.join(tmpDir, 'db.json');
  let patchedContent = null;
  const origFetch = globalThis.fetch;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith('/gists?per_page=100')) {
      return new Response(JSON.stringify([{ id: 'gist123', files: { 'turboaz-bot-db.json': {} } }]), { status: 200 });
    }
    if (u.endsWith('/gists/gist123') && (!opts.method || opts.method === 'GET')) {
      const saved = { owners: [111], offset: 5, nextId: 2, globalMaxId: 999, filters: [{ id: 1, name: 'Test' }] };
      return new Response(JSON.stringify({ id: 'gist123', files: { 'turboaz-bot-db.json': { content: JSON.stringify(saved) } } }), { status: 200 });
    }
    if (u.endsWith('/gists/gist123') && opts.method === 'PATCH') {
      patchedContent = JSON.parse(opts.body).files['turboaz-bot-db.json'].content;
      return new Response(JSON.stringify({ id: 'gist123' }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${u}`);
  };

  try {
    const store = new Store(dbPath, { githubToken: 'ghp_fake' });
    await store.init();
    assert.equal(store.gistId, 'gist123');
    assert.deepEqual(store.data.owners, [111]);
    assert.equal(store.data.filters.length, 1);
    assert.ok(fs.existsSync(dbPath));

    store.data.nextId = 3;
    await store.flush();
    assert.equal(JSON.parse(patchedContent).nextId, 3);
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
