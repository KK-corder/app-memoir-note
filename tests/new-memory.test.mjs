import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryDraft, makeMemory, makeEvent, validEvent, normalizeMemoir, memoryCandidates, matchingCandidates, pendingNotes, sortedNotes } from '../js/core.mjs';
import { createStore, STORAGE_KEY } from '../js/storage.mjs';
import { createEntries } from '../js/entries.mjs';
import { Drive } from '../js/drive.mjs';
import { startApp } from '../js/app.mjs';
import { makeDOM, eventually } from './support/dom.mjs';
import { fakeDrive } from './support/drive.mjs';

const fixture = JSON.parse(readFileSync(new URL('../demo/memoir.json', import.meta.url)));
const now = () => Date.parse('2026-11-08T15:30:00Z');
const draft = overrides => memoryDraft({ title: ' 空想の散歩😀 ', date: '2026-11-08', ...overrides }, now());
const jpeg = () => new Blob(['fictional-jpeg-only'], { type: 'image/jpeg' });
function setup(demo = false) {
  const dom = makeDOM(), store = createStore(dom.window.localStorage);
  store.state.session = { accessToken: 'test-only', expiresAt: Date.now() + 3600000 };
  const server = fakeDrive(fixture), drive = new Drive(store, () => {}, server.fetcher);
  return { ...dom, store, server, drive, entries: createEntries(store, drive, { demo, now }) };
}
async function boot({ dom = makeDOM(), data = structuredClone(fixture), resize = async () => jpeg(), server } = {}) {
  const requests = [];
  async function fetcher(url) {
    assert.equal(this, undefined); assert.equal(new URL(url).origin, 'http://localhost:8080'); requests.push(url);
    return new Response(JSON.stringify(data));
  }
  const app = await startApp({ ...dom, now, resize, registerWorker: false, fetcher: server ? server.fetcher : fetcher });
  return { ...dom, app, data, requests };
}
async function openCreate(page) { await page.$('tab-list').click(); await page.button('＋ 新しい思い出').click(); }
async function fill(page, key, value) { const input = page.$(`memory-${key}`); input.value = value; await input.emit(key === 'dateKind' ? 'change' : 'input'); }
const submit = page => page.$('main').querySelector('form').emit('submit');

test('create form navigation restores search/scroll, today uses Japan, demo candidates and chips use textContent', async () => {
  const page = await boot(); await page.$('tab-list').click();
  page.$('search').value = '空想'; await page.$('search').emit('input'); page.$('main').scrollTop = 173;
  await page.button('＋ 新しい思い出').click(); assert.equal(page.$('memory-date').value, '2026-11-09');
  await fill(page, 'place', '架');
  assert.equal(page.$('main').querySelectorAll('.suggestion')[0].textContent, '架空の月色広場');
  await page.button('架空の月色広場').click(); assert.equal(page.$('memory-place').value, '架空の月色広場');
  await fill(page, 'person', '友'); assert.equal(page.$('main').querySelectorAll('.suggestion')[0].textContent, '空想の友人ミナ');
  await page.button('空想の友人ミナ').click(); assert.equal(page.$('main').querySelectorAll('.person-chip').length, 1);
  await fill(page, 'person', '<img onerror=x>'); await page.button('人を足す').click();
  assert.equal(page.$('main').querySelectorAll('.person-chip').length, 2); assert.equal(page.$('main').querySelectorAll('img').length, 0);
  await page.$('main').querySelector('.person-chip').querySelector('button').click(); assert.equal(page.app.entries.draft().people.length, 1);
  await page.button('‹ 一覧へ戻る').click(); assert.equal(page.$('main').scrollTop, 173); assert.equal(page.$('search').value, '空想');
  page.app.dispose(); assert.equal(page.live.size, 0);
});
test('form reports required title/date, title slash/41 chars, body 10001 and reversed range without queuing', async () => {
  const page = await boot(); await openCreate(page);
  for (const [fields, message] of [
    [{ title: '' }, /題を入力/], [{ title: '題だけ', date: '' }, /日付を入力/],
    [{ title: 'a/b', date: '2026-11-08' }, /題には/], [{ title: '字'.repeat(41) }, /40 字/],
    [{ title: '作り物', body: 'あ'.repeat(10001) }, /10000 字/],
    [{ body: '', dateKind: 'range', end: '2026-11-07' }, /始まりより後/],
  ]) {
    for (const [key, value] of Object.entries(fields)) await fill(page, key, value);
    await submit(page); assert.match(page.$('main').querySelector('.form-message').textContent, message); assert.equal(page.app.entries.creations().length, 0);
  }
  let prevented = false; await page.$('memory-title').emit('paste', { clipboardData: { getData: () => '改行\n入り' }, preventDefault() { prevented = true; } });
  assert.ok(prevented); assert.match(page.$('main').textContent, /改行は入れられません/); page.app.dispose();
});
test('reload keeps all text draft fields but no photos; discard confirms, accepted create clears draft and persists sorted note', async () => {
  const page = await boot(); await openCreate(page);
  for (const [key, value] of Object.entries({ title: '再開する空想', dateKind: 'range', date: '2026-10-04', end: '2026-10-06', month: '2026-09', place: '架空庭園', body: '本文\n二行目', person: '架空A' })) await fill(page, key, value);
  await page.button('人を足す').click(); await fill(page, 'person', '打ちかけ');
  page.$('memory-photos').files = [{}, {}]; await page.$('memory-photos').emit('change');
  assert.equal(page.live.size, 2); await page.$('main').querySelector('.preview').querySelector('button').click(); assert.equal(page.live.size, 1);
  assert.ok(!page.storage.get(STORAGE_KEY).includes('fictional-jpeg-only')); page.app.dispose(); assert.equal(page.live.size, 0);
  const next = await boot({ dom: makeDOM('?demo=1', page.storage) }); await openCreate(next);
  assert.equal(next.$('memory-title').value, '再開する空想'); assert.equal(next.$('memory-dateKind').value, 'range'); assert.equal(next.$('memory-end').value, '2026-10-06');
  assert.equal(next.$('memory-person').value, '打ちかけ'); assert.equal(next.$('main').querySelectorAll('.person-chip').length, 1); assert.equal(next.$('main').querySelectorAll('.preview').length, 0);
  await next.button('下書きを捨てる').click(); assert.equal(next.app.entries.draft().title, '再開する空想'); await next.button('キャンセル').click();
  await fill(next, 'person', ''); await submit(next);
  assert.equal(next.app.entries.draft().title, ''); assert.equal(next.app.entries.creations()[0].status, 'sent');
  const rows = next.$('main').querySelectorAll('.note-row'); assert.equal(rows[1].querySelector('strong').textContent, '再開する空想');
  assert.match(rows[1].textContent, /Mac に届くのを待っています/); await rows[1].click();
  assert.equal(next.$('main').querySelector('.meta').textContent, '2026.10.04-06 / 架空庭園 / 架空A'); assert.equal(next.$('main').querySelector('.note-body').textContent, '本文\n二行目');
  next.app.dispose();
  const again = await boot({ dom: makeDOM('?demo=1', next.storage) }); await again.$('tab-list').click();
  assert.ok(again.$('main').textContent.includes('再開する空想')); await openCreate(again); assert.equal(again.$('memory-title').value, '');
  await fill(again, 'title', '捨てる下書き'); await again.button('下書きを捨てる').click(); await again.button('下書きを捨てて空にする').click();
  assert.equal(again.$('memory-title').value, ''); assert.equal(again.app.store.state.drafts.demo, undefined); again.app.dispose();
});
test('demo create and photos run locally with progress and no retained image content', async () => {
  const page = await boot(); await openCreate(page); await fill(page, 'title', '写真つきの空想');
  page.$('memory-photos').files = [{}, {}, {}]; await page.$('memory-photos').emit('change');
  const photo = page.app.entries.photo, progress = [];
  page.app.entries.photo = async (...args) => { progress.push(page.$('main').textContent); return photo(...args); };
  await submit(page); assert.match(progress[1], /2 \/ 3 枚/); assert.deepEqual(page.app.store.state.entries.map(row => row.event.kind), ['create', 'photo', 'photo', 'photo']);
  assert.equal(page.app.entries.pendingCount(), 0); assert.ok(!page.storage.get(STORAGE_KEY).includes('fictional-jpeg-only')); assert.equal(page.live.size, 0);
  assert.equal(page.requests.length, 1); page.app.dispose();
});
test('production form failure leaves create pending, blocks followups, preserves reset, then retries once on restart', async () => {
  const dom = makeDOM(''), server = fakeDrive(structuredClone(fixture));
  dom.storage.set(STORAGE_KEY, JSON.stringify({ session: { accessToken: 'test-only', expiresAt: Date.now() + 3600000 } }));
  const page = await boot({ dom, server }); await openCreate(page); await fill(page, 'title', '偽 Drive の空想');
  page.$('memory-photos').files = [{}]; await page.$('memory-photos').emit('change'); server.controls.failLog = true;
  await submit(page); assert.equal(page.app.entries.pendingCount(), 1); assert.equal(page.app.entries.draft().title, ''); assert.equal(server.mutations.length, 0);
  assert.match(page.$('notice').textContent, /写真は、ノートが届いてからノートの画面で足してください/);
  await page.$('main').querySelector('.note-row').click(); assert.equal(page.button('書き足す').disabled, true); assert.equal(page.$('photo-input').disabled, true);
  assert.match(page.$('main').textContent, /ノートを送ってから書き足せます/);
  page.$('append-text').value = '先行禁止'; await submit(page); page.$('photo-input').files = [{}]; await page.$('photo-input').emit('change'); assert.equal(page.app.store.state.entries.length, 1);
  await page.$('tab-settings').click(); assert.match(page.$('main').textContent, /新しい思い出：1 件/);
  await page.button('端末に覚えたものを消す').click(); await page.button('未送信を残して消す').click(); assert.equal(page.app.entries.pendingCount(), 1);
  page.app.dispose(); server.controls.failLog = false;
  const next = await boot({ dom: makeDOM('', page.storage), server }); assert.equal(next.app.entries.pendingCount(), 0);
  await next.$('tab-list').click(); await next.$('main').querySelector('.note-row').click();
  assert.equal(next.button('書き足す').disabled, false); assert.equal(next.$('photo-input').disabled, false);
  next.$('append-text').value = '後から追記'; await submit(next);
  next.$('photo-input').files = [{}]; await next.$('photo-input').emit('change'); await next.app.entries.flush();
  assert.deepEqual(server.log().entries.map(event => event.kind), ['create', 'text', 'photo']); next.app.dispose();
});
test('production creation sends selected photos after create; 401/403 never send photos and manual retry recovers', async () => {
  for (const status of [null, 401, 403]) {
    const dom = makeDOM(''), server = fakeDrive(structuredClone(fixture));
    dom.storage.set(STORAGE_KEY, JSON.stringify({ session: { accessToken: 'test-only', expiresAt: Date.now() + 3600000 } }));
    const page = await boot({ dom, server }); await openCreate(page); await fill(page, 'title', '送信順を確かめる空想');
    page.$('memory-photos').files = [{}, {}]; await page.$('memory-photos').emit('change'); server.controls.status = status; await submit(page);
    if (status) {
      assert.equal(page.app.entries.pendingCount(), 1); assert.equal(server.mutations.length, 0);
      await page.$('main').querySelector('.note-row').click(); assert.match(page.$('main').textContent, status === 403 ? /書き込みを許可/ : /ログイン/);
      server.controls.status = null; page.app.store.state.session = { accessToken: 'test-only', expiresAt: Date.now() + 3600000 };
      await page.button('もう一度送る').click(); assert.equal(page.button('書き足す').disabled, false); assert.deepEqual(server.log().entries.map(event => event.kind), ['create']);
    } else assert.deepEqual(server.log().entries.map(event => event.kind), ['create', 'photo', 'photo']);
    page.app.dispose();
  }
});
test('applied swaps an open pending note to exported body without losing list position; refreshed candidates replace old ones', async () => {
  const page = await boot(); await openCreate(page); await fill(page, 'title', '取り込みの空想'); await submit(page);
  const row = page.app.entries.creations()[0]; page.$('main').scrollTop = 225; await page.$('main').querySelector('.note-row').click();
  page.data.notes.push({ id: row.event.note_id, title: row.event.title, date: '2026-11-09', meta: '2026.11.09 / 新しい架空広場 / 新しい友人', body: 'Mac で取り込んだ本文' }); page.data.applied.push(row.event.id);
  await page.app.load(); assert.equal(page.app.entries.creations().length, 0); assert.equal(page.$('main').querySelector('.note-body').textContent, 'Mac で取り込んだ本文');
  assert.ok(!page.$('main').textContent.includes('Mac に届くのを待っています')); await page.button('‹ 一覧へ戻る').click(); assert.equal(page.$('main').scrollTop, 225);
  await page.button('＋ 新しい思い出').click(); await fill(page, 'place', '新'); assert.ok(page.button('新しい架空広場')); page.app.dispose();
});
test('rejected reason stays visible after reload, copy is plain text, local delete requires confirmation and preserves other entries', async () => {
  const page = await boot(); await openCreate(page); await fill(page, 'title', '失敗した空想'); await fill(page, 'body', '写す本文'); await submit(page);
  const row = page.app.entries.creations()[0]; page.app.entries.record('別のノート', '残す追記');
  page.data.rejected.push({ id: row.event.id, reason: '同じ名前のノートがあります<script>' }); await page.app.load();
  assert.match(page.$('main').textContent, /Mac で作れませんでした: 同じ名前/); assert.equal(page.app.entries.creations().length, 1);
  await page.$('main').querySelector('.note-row').click(); assert.match(page.$('main').textContent, /Mac で作れませんでした/); assert.equal(page.$('main').querySelectorAll('script').length, 0);
  let copied; page.window.navigator.clipboard = { async writeText(value) { copied = value; } };
  await page.button('本文を写す').click(); assert.equal(copied, `# ${row.event.title}\n\n${row.event.meta}\n\n写す本文`);
  await page.button('この記録を消す').click(); assert.equal(page.app.entries.creations().length, 1); await page.button('キャンセル').click(); page.app.dispose();
  const next = await boot({ dom: makeDOM('?demo=1', page.storage), data: { ...fixture, rejected: undefined } }); await next.$('tab-list').click();
  assert.match(next.$('main').textContent, /Mac で作れませんでした/); await next.$('main').querySelector('.note-row').click();
  await next.button('この記録を消す').click(); await next.button('この記録を消して一覧へ戻る').click();
  assert.equal(next.app.entries.creations().length, 0); assert.equal(next.app.entries.forNote('別のノート').length, 1); next.app.dispose();
});
test('leaving during photo preparation releases images and cannot repopulate a later form', async () => {
  let finish;
  const page = await boot({ resize: () => new Promise(resolve => { finish = resolve; }) }); await openCreate(page);
  const file = page.$('memory-photos'); file.files = [{}]; const preparing = file.emit('change');
  await page.button('‹ 一覧へ戻る').click(); await page.button('＋ 新しい思い出').click(); finish(jpeg()); await preparing;
  assert.equal(page.$('main').querySelectorAll('.preview').length, 0); assert.equal(page.live.size, 0); page.app.dispose();
});
test('navigation during create sending keeps its scope and finishes photos after create', async () => {
  const page = await boot(); await openCreate(page); await fill(page, 'title', '移動中の空想');
  await fill(page, 'place', '架');
  page.$('memory-photos').files = [{}]; await page.$('memory-photos').emit('change');
  let release; const flush = page.app.entries.flush;
  page.app.entries.flush = async () => { await new Promise(resolve => { release = resolve; }); await flush(); };
  const creating = submit(page); await eventually(() => Boolean(release));
  assert.equal(page.button('架空の月色広場').disabled, true); await page.button('架空の月色広場').click();
  assert.equal(page.app.store.state.drafts.demo, undefined);
  await page.$('tab-list').click();
  await page.button('＋ 新しい思い出').click(); assert.equal(page.$('memory-title'), null); assert.match(page.$('notice').textContent, /送信が終わってから/);
  release(); await creating; assert.deepEqual(page.app.store.state.entries.map(row => row.event.kind), ['create', 'photo']); assert.equal(page.live.size, 0); page.app.dispose();
});
test('logged-out restart can recover a scoped draft and queue a create without network access', async () => {
  const dom = makeDOM('');
  dom.storage.set(STORAGE_KEY, JSON.stringify({ drafts: { 'drive:思い出ノート/_app': draft({ title: 'ログイン前の下書き' }) } }));
  const page = await boot({ dom }); await openCreate(page); assert.equal(page.$('memory-title').value, 'ログイン前の下書き');
  assert.equal(page.requests.length, 0); await submit(page); assert.equal(page.app.entries.pendingCount(), 1); assert.equal(page.requests.length, 0);
  assert.match(page.$('notice').textContent, /ログイン/); await page.$('main').querySelector('.note-row').click();
  assert.equal(page.button('書き足す').disabled, true); page.app.dispose();
});
test('form storage failure retains visible inputs and selected photos without accepting a create', async () => {
  const page = await boot(); await openCreate(page); await fill(page, 'title', '失いたくない入力');
  page.$('memory-photos').files = [{}]; await page.$('memory-photos').emit('change');
  page.window.localStorage.setItem = () => { throw Error('quota'); }; await submit(page);
  assert.equal(page.$('memory-title').value, '失いたくない入力'); assert.equal(page.app.entries.creations().length, 0);
  assert.equal(page.app.entries.draft().title, '失いたくない入力'); assert.equal(page.$('main').querySelectorAll('.preview').length, 1);
  assert.match(page.$('main').querySelector('.form-message').textContent, /入力を残しました/); page.app.dispose(); assert.equal(page.live.size, 0);
});

test('memory dates and metadata exactly match all interchange examples', () => {
  const cases = [
    [{}, '2026-11-08', '2026.11.08'],
    [{ dateKind: 'month', month: '2026-11' }, '2026-11', '2026.11'],
    [{ dateKind: 'range', end: '2026-11-10' }, '2026-11-08', '2026.11.08-10'],
    [{ dateKind: 'range', date: '2026-10-30', end: '2026-11-02' }, '2026-10-30', '2026.10.30-11.02'],
    [{ dateKind: 'range', date: '2026-12-30', end: '2027-01-02' }, '2026-12-30', '2026.12.30-2027.01.02'],
  ];
  for (const [fields, date, meta] of cases) {
    const value = makeMemory(draft(fields));
    assert.equal(value.note_id, `${date}_空想の散歩😀`); assert.equal(value.meta, `${meta} /  / `); assert.equal(value.body, '');
    const event = makeEvent('create', value.note_id, value, now()); assert.ok(validEvent(event));
    assert.deepEqual(Object.keys(event), ['id', 'kind', 'note_id', 'title', 'meta', 'body', 'at']);
    assert.match(event.id, /^m-2026-11-09-003000-[a-z0-9]{4}$/);
  }
  assert.equal(makeMemory(draft({ place: ' 架空山 ', people: ['友人A', '友人B', '友人C'] })).meta, '2026.11.08 / 架空山 / 友人A・友人B・友人C');
  assert.equal(memoryDraft({}, now()).date, '2026-11-09');
});
test('validation rejects missing/invalid fields, limits and backwards or equal ranges; emoji follow textLength', () => {
  for (const fields of [
    { title: '' }, { date: '' }, { title: 'a/b' }, { title: 'a\\b' }, { title: 'a\nb' }, { title: 'a\rb' }, { title: '.abc' }, { title: ' _abc' }, { title: '😀'.repeat(41) },
    { body: 'あ'.repeat(10001) }, { place: 'あ'.repeat(61) }, { place: 'a\nb' }, { place: 'a / b' },
    { people: ['😀'.repeat(21)] }, { people: ['a・b'] }, { people: ['a/b'] }, { people: ['a\nb'] }, { person: 'まだ追加していない人' },
    { dateKind: 'month', month: '2026-1' }, { dateKind: 'month', month: '2026-13' }, { date: '2026-02-29' }, { date: '0000-01-01' },
    { dateKind: 'range', end: '2026-11-07' }, { dateKind: 'range', end: '2026-11-08' }, { dateKind: 'range', end: '' },
  ]) assert.throws(() => makeMemory(draft(fields)), Error, JSON.stringify(fields).slice(0, 100));
  assert.doesNotThrow(() => makeMemory(draft({ title: '😀'.repeat(40), place: '地'.repeat(60), people: ['😀'.repeat(20)], body: '😀'.repeat(10000) })));
  assert.doesNotThrow(() => makeMemory(draft({ date: '2024-02-29' })));
});
test('candidates count only second/third slash fields, split people, rank and filter to eight', () => {
  const notes = [{ meta: '2026.11 /  /' }, { meta: '2026 / 場所だけ' }, { meta: '2026 / 空想広場 / 友人A・友人B、友人C / 無視' }, { meta: '2026 / 空想広場 / 友人A' }, {}];
  const result = memoryCandidates(notes);
  assert.deepEqual(result, { places: ['空想広場', '場所だけ'], people: ['友人A', '友人B', '友人C'] });
  assert.deepEqual(matchingCandidates(result.places, '広'), ['空想広場']); assert.deepEqual(matchingCandidates(result.people, ''), []);
  assert.equal(matchingCandidates(Array.from({ length: 12 }, (_, i) => `友人${i}`), '友').length, 8);
});
test('duplicate notes are blocked in exports and scoped pending creates, including sent/rejected records', async () => {
  const { entries, store } = setup(true), value = makeMemory(draft());
  assert.throws(() => entries.recordCreate(draft(), [{ id: value.note_id }]), /同じ日付と題/);
  const row = entries.recordCreate(draft());
  assert.throws(() => entries.recordCreate(draft()), /同じ日付と題/); await entries.flush();
  assert.throws(() => entries.recordCreate(draft()), /同じ日付と題/);
  entries.reconcile([], [{ id: row.event.id, reason: '同じ名前のノートがあります' }]);
  assert.throws(() => entries.recordCreate(draft()), /同じ日付と題/);
  const production = createEntries(store, {}); assert.doesNotThrow(() => production.recordCreate(draft()));
});
test('draft is scoped, whitelisted, old stores load, and create/draft transition rolls back on quota error', () => {
  const { entries, store, window, storage } = setup(true);
  assert.deepEqual(store.state.drafts, {});
  entries.saveDraft({ ...draft(), photos: ['must-not-persist'], candidates: ['must-not-persist'] });
  assert.ok(!storage.get(STORAGE_KEY).includes('must-not-persist')); assert.equal(storage.size, 1);
  const production = createEntries(store, {}); assert.equal(production.draft().title, '');
  const write = window.localStorage.setItem; window.localStorage.setItem = () => { throw Error('quota'); };
  assert.throws(() => entries.recordCreate(draft()), /入力を残しました/);
  assert.equal(store.state.entries.length, 0); assert.equal(entries.draft().title, draft().title);
  window.localStorage.setItem = write; entries.recordCreate(draft());
  const nextStore = createStore(window.localStorage), next = createEntries(nextStore, {}, { demo: true });
  assert.equal(next.draft().title, ''); assert.equal(next.pendingCount(), 1);
  const old = createStore({ getItem: () => JSON.stringify({ entries: [], opened: { x: true } }) });
  assert.deepEqual(old.state.drafts, {}); assert.equal(old.state.opened.x, true);
});
test('fake Drive preserves create -> photo -> text order, latest foreign entries, and checks create ID content', async () => {
  const { entries, server, drive } = setup();
  const row = entries.recordCreate(draft());
  assert.throws(() => entries.record(row.event.note_id, 'まだ送れない'), /ノートを送ってから/);
  await assert.rejects(entries.photo(row.event.note_id, jpeg()), /ノートを送ってから/); assert.equal(server.calls.length, 0);
  await entries.flush(); await entries.photo(row.event.note_id, jpeg()); entries.record(row.event.note_id, '追記'); await entries.flush();
  assert.deepEqual(server.log().entries.map(entry => entry.kind), ['create', 'photo', 'text']);
  for (const field of ['title', 'meta', 'body']) await assert.rejects(drive.append({ ...row.event, [field]: row.event[field] + '別' }), /同じ ID|形式/);
  const foreign = makeEvent('text', 'fiction-other-device', '別の端末', now()); let reads = 0;
  server.controls.read = file => { if (file.name === 'append_log.json' && ++reads === 2) file.data.entries.push(foreign); };
  entries.recordCreate(draft({ title: '別の作り物' })); await entries.flush();
  assert.equal(server.log().entries.at(-2).id, foreign.id); assert.equal(server.log().entries.at(-1).kind, 'create');
});
test('lost create response and local-save failure retry exactly once, rejection persists and applied reconciles', async () => {
  const { entries, server, window, store } = setup();
  const row = entries.recordCreate(draft()); server.controls.loseResponse = true; await entries.flush();
  assert.equal(row.status, 'pending'); assert.equal(server.log().entries.length, 1);
  const nextStore = createStore(window.localStorage), next = createEntries(nextStore, new Drive(nextStore, () => {}, server.fetcher));
  await next.flush(); await next.flush(); assert.equal(next.pendingCount(), 0); assert.equal(server.log().entries.length, 1);
  next.reconcile([row.event.id]); assert.equal(next.creations().length, 0);
  const second = next.recordCreate(draft({ title: '保存結果の復旧' }));
  const save = window.localStorage.setItem; window.localStorage.setItem = () => { throw Error('quota'); };
  await next.flush(); assert.equal(second.status, 'pending');
  window.localStorage.setItem = save; await next.flush(); assert.equal(server.log().entries.length, 2);
  const reason = '同じ名前のノートがあります'; next.reconcile([], [{ id: second.event.id, reason }]); next.reconcile([]);
  assert.equal(next.creations()[0].reason, reason); assert.equal(next.blocked(second.event.note_id), true);
  assert.equal(createStore(window.localStorage).state.entries[0].reason, reason);
  assert.equal(next.removeRejected(row.event.id), true); assert.equal(next.creations().length, 1);
  assert.equal(next.removeRejected(second.event.id), true); assert.equal(next.creations().length, 0);
  assert.deepEqual(normalizeMemoir({}).rejected, []); assert.equal(store.state.entries.length, 1);
});
test('pending month notes sort as the first and exports with the same ID do not duplicate the local recovery row', () => {
  const { entries } = setup(true); const row = entries.recordCreate(draft({ dateKind: 'month', month: '2026-10' }));
  const notes = pendingNotes([{ id: row.event.note_id, date: '2026-10', title: '重複', meta: '', body: '' }, ...normalizeMemoir(fixture).notes], entries.creations());
  assert.equal(notes.filter(note => note.id === row.event.note_id).length, 1);
  assert.deepEqual(sortedNotes(notes).slice(0, 4).map(note => note.date), ['2026-10-19', '2026-10-02', '2026-10', '2026-10']);
});
