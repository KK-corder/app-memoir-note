import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/storage.mjs';
import { createEntries } from '../js/entries.mjs';
import { Drive } from '../js/drive.mjs';
import { fakeDrive } from './support/drive.mjs';

function setup(demo = false) {
  const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const store = createStore(storage); store.state.session = { accessToken: 'test-only', expiresAt: Date.now() + 3600000 };
  const server = fakeDrive(), drive = new Drive(store, () => {}, server.fetcher);
  return { memory, storage, store, server, drive, entries: createEntries(store, drive, { demo }) };
}
test('text is persisted before sending, failure survives reload and retry sends once', async () => {
  const { entries, memory, server, storage } = setup();
  const row = entries.record('fiction', '空想の追記');
  assert.equal(JSON.parse(memory.get(STORAGE_KEY)).entries[0].status, 'pending'); assert.equal(server.calls.length, 0);
  server.controls.loseResponse = true; await entries.flush();
  assert.equal(entries.pendingCount(), 1); assert.match(row.error, /connection lost/);
  const nextStore = createStore(storage), next = createEntries(nextStore, new Drive(nextStore, () => {}, server.fetcher));
  await next.flush(); await next.flush();
  assert.equal(next.pendingCount(), 0); assert.equal(server.log().entries.length, 1); assert.equal(next.forNote('fiction')[0].status, 'sent');
});
test('403 stays pending with actionable permission message', async () => {
  const { entries, server } = setup(); entries.record('fiction', '追記'); server.controls.status = 403; await entries.flush();
  assert.equal(entries.pendingCount(), 1); assert.equal(entries.forNote('fiction')[0].error, 'もう一度ログインして書き込みを許可してください');
});
test('2001 codepoints and storage failure do not queue or clear input', () => {
  const { entries, storage, store } = setup();
  assert.throws(() => entries.record('fiction', 'あ'.repeat(2001)), /2000 字/);
  assert.throws(() => entries.record('fiction', '   '), /入力/);
  storage.setItem = () => { throw Error('quota'); };
  assert.throws(() => entries.record('fiction', '消えない追記'), /入力を残しました/); assert.equal(store.state.entries.length, 0);
});
test('demo sends only locally and demo/production/path scopes never mix', async () => {
  const { entries, server, store } = setup(true); entries.record('fiction', 'demo'); await entries.flush();
  assert.equal(entries.pendingCount(), 0); assert.equal(server.calls.length, 0);
  const prod = createEntries(store, new Drive(store, () => {}, server.fetcher)); assert.deepEqual(prod.forNote('fiction'), []);
  prod.record('fiction', 'real'); store.state.settings.path = 'another/path'; await prod.flush();
  assert.equal(server.calls.length, 0); assert.equal(prod.allPendingCount(), 1);
  prod.reconcile(store.state.entries.map(row => row.event.id)); assert.equal(store.state.entries.length, 2);
});
test('applied removes text and photo status, with no image content in storage', async () => {
  const { entries, memory } = setup(true);
  const text = entries.record('fiction', '追記'); await entries.flush();
  const photo = await entries.photo('fiction', new Blob(['do-not-store-photo'], { type: 'image/jpeg' }));
  assert.equal(entries.forNote('fiction').length, 2); assert.ok(!memory.get(STORAGE_KEY).includes('do-not-store-photo'));
  entries.reconcile([text.event.id, photo.event.id]); assert.equal(entries.forNote('fiction').length, 0);
});
test('failed photo is not retained locally', async () => {
  const { entries, server, store } = setup(); server.controls.failPhoto = true;
  await assert.rejects(entries.photo('fiction', new Blob(['x'], { type: 'image/jpeg' })));
  assert.equal(store.state.entries.length, 0);
});
test('new text added during an active send is flushed by the same run', async () => {
  const { store } = setup(); let unblock;
  const sent = [], gate = new Promise(resolve => { unblock = resolve; });
  const entries = createEntries(store, { async append(event) { await gate; sent.push(event); } });
  entries.record('fiction', 'first'); const flushing = entries.flush(); entries.record('fiction', 'second'); unblock(); await flushing;
  assert.equal(sent.length, 2); assert.equal(entries.pendingCount(), 0);
});
test('failed local save after successful send is retried by ID after reopening', async () => {
  const { entries, server, storage } = setup(); entries.record('fiction', '端末保存に失敗する追記');
  const setItem = storage.setItem; storage.setItem = () => { throw Error('quota'); };
  await entries.flush(); assert.equal(entries.pendingCount(), 1); assert.equal(server.log().entries.length, 1);
  storage.setItem = setItem;
  const restored = createStore(storage), next = createEntries(restored, new Drive(restored, () => {}, server.fetcher));
  await next.flush(); assert.equal(next.pendingCount(), 0); assert.equal(server.log().entries.length, 1);
});
