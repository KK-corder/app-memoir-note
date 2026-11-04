import test from 'node:test';
import assert from 'node:assert/strict';
import { Drive, searchQuery } from '../js/drive.mjs';
import { createStore } from '../js/storage.mjs';
import { makeEvent, WRITE_PERMISSION_MESSAGE } from '../js/core.mjs';
import { fakeDrive } from './support/drive.mjs';

export function setup() {
  const server = fakeDrive();
  const store = createStore({ getItem() {}, setItem() {} });
  store.state.session = { accessToken: 'test-only', expiresAt: Date.now() + 3600000 };
  return { server, store, drive: new Drive(store, () => { store.state.session = null; }, server.fetcher) };
}
const entry = () => makeEvent('text', 'fiction', '追記');
test('Drive resolves root path, reads memoir without writes, and fetch has no receiver', async () => {
  const { drive, server } = setup();
  assert.deepEqual(await drive.memoir(), { notes: [] }); assert.equal(server.mutations.length, 0);
  assert.match(searchQuery("a'b", 'x\\y'), /a\\'b/);
});
test('absent log is created in inbox, then entries are appended in order', async () => {
  const { drive, server } = setup(), first = entry(), second = entry();
  await drive.append(first); await drive.append(second);
  assert.deepEqual(server.log().entries, [first, second]);
  assert.deepEqual(server.mutations, [{ method: 'POST', name: 'append_log.json' }, { method: 'PATCH', name: 'append_log.json' }]);
});
test('latest entries and unknown top-level fields survive reread before PATCH', async () => {
  const { drive, server } = setup(), old = entry(), other = entry(), added = entry();
  const log = server.addLog([old]); log.data.extra = 'preserve';
  let reads = 0;
  server.controls.read = file => { if (file.name === 'append_log.json' && ++reads === 2) file.data.entries.push(other); };
  await drive.append(added); assert.deepEqual(server.log().entries, [old, other, added]); assert.equal(server.log().extra, 'preserve');
});
test('lost POST/PATCH responses are idempotent when retried', async () => {
  for (const existing of [false, true]) {
    const { drive, server } = setup(), added = entry(); if (existing) server.addLog([entry()]);
    server.controls.loseResponse = true;
    await assert.rejects(drive.append(added), /connection lost/);
    await drive.append(added);
    assert.equal(server.log().entries.filter(row => row.id === added.id).length, 1); assert.equal(server.mutations.length, 1);
  }
});
test('same ID with different content never overwrites the existing record', async () => {
  const { drive, server } = setup(), added = entry(); server.addLog([added]);
  await assert.rejects(drive.append({ ...added, text: '別の内容' }), /同じ ID/); assert.equal(server.mutations.length, 0);
});
test('duplicate, non-app-created, read-only, and malformed logs are never overwritten', async () => {
  for (const scenario of ['duplicate', 'not-app', 'read-only', 'malformed', 'json']) {
    const { drive, server } = setup(); const log = server.addLog();
    if (scenario === 'duplicate') server.addLog();
    if (scenario === 'not-app') log.appProperties = {};
    if (scenario === 'read-only') log.capabilities.canEdit = false;
    if (scenario === 'malformed') log.data = { unexpected: true };
    if (scenario === 'json') server.controls.invalidJSON = true;
    await assert.rejects(drive.append(entry())); assert.equal(server.mutations.length, 0, scenario);
  }
});
test('403 explains write permission and 401 expires login', async () => {
  const { drive, store, server } = setup(); server.controls.status = 403;
  await assert.rejects(drive.append(entry()), error => error.status === 403 && error.message === WRITE_PERMISSION_MESSAGE);
  server.controls.status = 401; await assert.rejects(drive.memoir()); assert.equal(store.state.session, null);
});
test('photo creation precedes log write and failed photo never creates a record', async () => {
  const { drive, server } = setup(), photo = makeEvent('photo', 'fiction'), blob = new Blob(['jpeg'], { type: 'image/jpeg' });
  server.controls.failPhoto = true; await assert.rejects(drive.uploadPhoto(photo, blob)); assert.equal(server.log(), undefined); assert.equal(server.mutations.length, 0);
  server.controls.failPhoto = false; await drive.uploadPhoto(photo, blob);
  assert.deepEqual(server.mutations.map(row => row.name), [photo.photo, 'append_log.json']); assert.deepEqual(server.log().entries, [photo]);
});
test('failed photo log leaves only the already uploaded photo and does not delete files', async () => {
  const { drive, server } = setup(); server.controls.failLog = true;
  const photo = makeEvent('photo', 'fiction');
  await assert.rejects(drive.uploadPhoto(photo, new Blob(['jpeg'], { type: 'image/jpeg' })));
  assert.deepEqual(server.mutations.map(row => row.name), [photo.photo]); assert.equal(server.log(), undefined);
});
test('simultaneous submissions in one app are serialized without losing entries', async () => {
  const { drive, server } = setup(), first = entry(), second = entry();
  await Promise.all([drive.append(first), drive.append(second), drive.append(first)]);
  assert.deepEqual(server.log().entries, [first, second]);
});
test('media uses bearer header and no-store and folders are never created', async () => {
  const { drive, server } = setup(); server.files.push({ id: 'picture', name: 'x.jpg', parents: ['photos'] });
  assert.equal((await drive.photoBlob({ drive_id: 'picture' })).type, 'image/jpeg');
  server.files.splice(server.files.findIndex(row => row.id === 'inbox'), 1);
  await assert.rejects(drive.append(entry()), /inbox が見つかりません/); assert.equal(server.mutations.length, 0);
});
