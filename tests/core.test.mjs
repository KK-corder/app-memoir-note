import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeMemoir, sortedNotes, staleMessage, japanDate, makeEvent, validEvent, textLength } from '../js/core.mjs';
import { createStore, STORAGE_KEY } from '../js/storage.mjs';
import { parseRedirect, consumeRedirect, redirectURL, DRIVE_SCOPE } from '../js/login.mjs';

const time = Date.parse('2026-11-04T21:05:01+09:00');
test('Japan date and entry ID/at match the interchange contract', () => {
  assert.equal(japanDate(Date.parse('2026-11-04T15:00:00Z')), '2026-11-05');
  assert.equal(japanDate(Date.parse('2026-11-04T14:59:59Z')), '2026-11-04');
  const entry = makeEvent('text', 'fiction', 'hello', time);
  assert.match(entry.id, /^m-2026-11-04-210501-[a-z0-9]{4}$/); assert.equal(entry.at, '2026-11-04T21:05:01+09:00'); assert.ok(validEvent(entry));
  const photo = makeEvent('photo', 'fiction', null, time); assert.equal(photo.photo, `${photo.id}.jpg`); assert.ok(validEvent(photo));
  assert.equal(textLength('😀'.repeat(2000)), 2000);
});
test('normalization handles omitted fields and invalid top-level data', () => {
  for (const raw of [null, {}, [], { today: {} }]) assert.deepEqual(normalizeMemoir(raw).notes, []);
  const data = normalizeMemoir({ notes: [{ id: 'a', body: 'plain' }, null, {}] });
  assert.equal(data.notes[0].hook, ''); assert.deepEqual(data.notes[0].photos, []);
});
test('demo covers every required fixture and month dates sort as the first', () => {
  const raw = JSON.parse(readFileSync(new URL('../demo/memoir.json', import.meta.url)));
  const data = normalizeMemoir(raw), notes = sortedNotes(data.notes);
  assert.ok(notes.length >= 8); assert.ok(raw.applied.length > 0);
  assert.ok(notes.some(note => note.body.length > 2000)); assert.ok(raw.notes.some(note => note.hook === null));
  assert.ok(notes.some(note => note.photos.length === 0)); assert.ok(notes.some(note => note.photos.length === 1)); assert.ok(notes.some(note => note.photos.length >= 4));
  assert.deepEqual(notes.slice(0, 3).map(note => note.date), ['2026-10-19', '2026-10-02', '2026-10']);
  assert.equal(sortedNotes(notes, '青いベンチ')[0].id, data.today.note_id);
  assert.match(notes.find(note => note.id === data.today.note_id).body, /\d{4}-\d{2}-\d{2} 追記:/);
  assert.equal(staleMessage(data.today, time), '');
  assert.equal(staleMessage(data.today, time + 86400000), '11月4日の思い出（Mac の書き出しがまだです）');
});
test('storage uses one key, supplies defaults, tolerates malformed/denied storage', () => {
  const map = new Map(), errors = [];
  const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const store = createStore(storage, message => errors.push(message), 'test/path');
  assert.equal(store.state.settings.path, 'test/path'); store.save(); assert.deepEqual([...map.keys()], [STORAGE_KEY]);
  store.state.entries.push({ scope: 'demo', event: { id: 'pending' }, status: 'pending' }); store.state.opened.a = true; store.state.folders.a = { app: 'x' }; store.clearRemembered();
  const next = createStore(storage); assert.equal(next.state.entries.length, 1); assert.deepEqual(next.state.opened, {}); assert.deepEqual(next.state.folders, {});
  map.set(STORAGE_KEY, '{bad'); assert.doesNotThrow(() => createStore(storage));
  const failing = createStore({ getItem() { throw Error(); }, setItem() { throw Error(); } }, message => errors.push(message));
  assert.equal(failing.save(), false); assert.ok(errors.length >= 2);
});
test('OAuth state is validated, expires, and callback fragment is removed', () => {
  const pending = { state: 'random-state', createdAt: time };
  const hash = '#access_token=test&token_type=Bearer&expires_in=3600&state=random-state';
  assert.equal(parseRedirect(hash, pending, time).session.accessToken, 'test');
  assert.ok(parseRedirect(hash, { ...pending, state: 'wrong' }, time).error);
  assert.ok(parseRedirect(hash, pending, time + 600001).error);
  assert.ok(parseRedirect(hash, pending, time - 1).error);
  const store = createStore({ getItem() {}, setItem() {} }); store.state.pendingLogin = pending;
  let cleaned;
  consumeRedirect({ hash, pathname: '/app/', search: '' }, { replaceState(a, b, url) { cleaned = url; } }, store, time);
  assert.equal(cleaned, '/app/'); assert.equal(store.state.pendingLogin, null);
  const url = new URL(redirectURL('test-client', 'https://example.test/app/', 'random-state'));
  assert.equal(url.searchParams.get('scope'), DRIVE_SCOPE); assert.equal(url.searchParams.get('client_id'), 'test-client');
});
