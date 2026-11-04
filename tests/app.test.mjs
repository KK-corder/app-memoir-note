import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from '../js/app.mjs';
import { STORAGE_KEY } from '../js/storage.mjs';
import { makeDOM, eventually } from './support/dom.mjs';
import { fakeDrive } from './support/drive.mjs';

const fixture = JSON.parse(readFileSync(new URL('../demo/memoir.json', import.meta.url)));
const todayNote = fixture.notes.find(note => note.id === fixture.today.note_id);
const now = () => Date.parse('2026-11-04T21:00:00+09:00');
async function boot({ dom = makeDOM(), data = fixture, clock = now, resize, ...options } = {}) {
  const requests = [];
  async function fetcher(url) {
    assert.equal(this, undefined, 'unbound fetch'); requests.push(url);
    assert.equal(new URL(url).origin, 'http://localhost:8080', 'demo must never use Google');
    return url.endsWith('memoir.json') ? new Response(JSON.stringify(data)) : new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  }
  const app = await startApp({ ...dom, clientId: 'test-client', defaultPath: 'injected/path', now: clock, fetcher, registerWorker: false, resize, ...options });
  return { ...dom, app, requests };
}
test('demo reveal has only reason, title, date and hook until opened; reload remembers it', async () => {
  const first = await boot(), main = first.$('main');
  assert.ok(main.textContent.includes(fixture.today.reason)); assert.ok(main.textContent.includes(todayNote.title)); assert.ok(main.textContent.includes(todayNote.date)); assert.ok(main.textContent.includes(fixture.today.hook));
  assert.ok(!main.textContent.includes(todayNote.meta)); assert.ok(!main.textContent.includes(todayNote.body)); assert.equal(main.querySelectorAll('img').length, 0); assert.equal(first.requests.length, 1);
  await first.button('思い出してから開く').click();
  assert.ok(main.textContent.includes(todayNote.meta)); assert.ok(main.textContent.includes(todayNote.body));
  await eventually(() => main.querySelectorAll('img').length === 5);
  const saved = JSON.parse(first.storage.get(STORAGE_KEY)); assert.ok(!JSON.stringify(saved).includes(todayNote.body));
  first.app.dispose(); assert.equal(first.live.size, 0);
  const second = await boot({ dom: makeDOM('?demo=1', first.storage), clock: () => now() + 86400000 });
  assert.ok(second.$('main').textContent.includes(todayNote.body)); assert.match(second.$('main').textContent, /11月4日の思い出（Mac の書き出しがまだです）/); second.app.dispose();
});
test('new today/date pair is gated even when previous pair was opened', async () => {
  const first = await boot(); await first.button('思い出してから開く').click(); first.app.dispose();
  const data = structuredClone(fixture); data.today.date = '2026-11-05';
  const next = await boot({ dom: makeDOM('?demo=1', first.storage), data, clock: () => now() + 86400000 });
  assert.ok(next.button('思い出してから開く')); assert.ok(!next.$('main').textContent.includes(todayNote.body)); next.app.dispose();
});
test('list sorting, body/meta/title search, detail, and scroll restoration use real DOM events', async () => {
  const page = await boot(); await page.$('tab-list').click(); const main = page.$('main');
  const rows = main.querySelectorAll('.note-row'); assert.equal(rows.length, fixture.notes.length);
  assert.ok(rows[0].textContent.includes('2026-10-19')); assert.ok(rows[1].textContent.includes('2026-10-02')); assert.ok(rows[2].textContent.includes('2026-10'));
  const search = page.$('search'); search.value = '青いベンチ'; await search.emit('input'); assert.equal(main.querySelectorAll('.note-row').length, 1);
  main.scrollTop = 217; await main.querySelector('.note-row').click();
  assert.ok(main.textContent.includes(todayNote.body)); assert.ok(main.textContent.includes(todayNote.hook)); assert.equal(page.button('思い出してから開く'), undefined);
  await page.button('‹ 一覧へ戻る').click(); assert.equal(main.scrollTop, 217); assert.equal(page.$('search').value, '青いベンチ');
  for (const value of ['空想の友人ナギ', todayNote.title]) { page.$('search').value = value; await page.$('search').emit('input'); assert.equal(main.querySelectorAll('.note-row').length, 1); }
  page.app.dispose();
});
test('submit clears text, shows sent status, survives reload; 2001 chars cannot save', async () => {
  const page = await boot(); await page.button('思い出してから開く').click(); const main = page.$('main');
  const input = page.$('append-text'); input.value = '作り物の追記'; await main.querySelector('form').emit('submit');
  assert.equal(input.value, ''); assert.match(main.textContent, /送信済み・ノートへの反映待ち/); assert.ok(main.textContent.includes('作り物の追記'));
  const count = page.app.store.state.entries.length; input.value = 'あ'.repeat(2001); await input.emit('input');
  assert.ok(page.button('書き足す').disabled); assert.match(main.textContent, /2000 字まで/);
  await main.querySelector('form').emit('submit'); assert.equal(page.app.store.state.entries.length, count); assert.equal(input.value.length, 2001);
  page.app.dispose(); const reload = await boot({ dom: makeDOM('?demo=1', page.storage) });
  assert.match(reload.$('main').textContent, /送信済み・ノートへの反映待ち/); assert.ok(reload.$('main').textContent.includes('作り物の追記')); reload.app.dispose();
});
test('text storage failure leaves input visible and records nothing', async () => {
  const page = await boot(); await page.button('思い出してから開く').click();
  page.window.localStorage.setItem = () => { throw Error('quota'); };
  const input = page.$('append-text'); input.value = '消えない入力'; await page.$('main').querySelector('form').emit('submit');
  assert.equal(input.value, '消えない入力'); assert.equal(page.app.store.state.entries.length, 0); assert.match(page.$('main').textContent, /入力を残しました/); page.app.dispose();
});
test('missing hook/photos/today/note are safe and hook fallback works', async () => {
  for (const missing of ['hook', 'photos', 'today', 'note']) {
    const data = structuredClone(fixture);
    if (missing === 'hook') { delete data.today.hook; delete data.notes.find(note => note.id === data.today.note_id).hook; }
    if (missing === 'photos') for (const note of data.notes) delete note.photos;
    if (missing === 'today') delete data.today;
    if (missing === 'note') data.today.note_id = 'absent';
    const page = await boot({ data });
    if (missing === 'hook') assert.match(page.$('main').textContent, /どんな日だった？/);
    if (['today', 'note'].includes(missing)) assert.match(page.$('main').textContent, /まだ開けません/);
    if (missing === 'photos') { await page.button('思い出してから開く').click(); assert.equal(page.$('main').querySelectorAll('.photo-tile').length, 0); }
    page.app.dispose();
  }
});
test('cache reset confirms count and preserves unsent text by default', async () => {
  const page = await boot(); page.app.entries.record(todayNote.id, '未送信'); page.app.store.state.opened.example = true; page.app.store.save();
  await page.$('tab-settings').click(); await page.button('端末に覚えたものを消す').click();
  assert.match(page.$('main').textContent, /未送信の追記が 1 件あります/);
  assert.equal(page.app.store.state.opened.example, true);
  await page.button('未送信を残して消す').click();
  assert.equal(page.app.entries.pendingCount(), 1); assert.deepEqual(page.app.store.state.opened, {});
  assert.equal(JSON.parse(page.storage.get(STORAGE_KEY)).entries.length, 1); page.app.dispose();
});
test('photos are processed one by one with progress; previews become a count after reopening', async () => {
  let page, inflight = 0, maximum = 0; const progress = [];
  page = await boot({ resize: async file => {
    maximum = Math.max(maximum, ++inflight); progress.push(page.$('main').textContent);
    await new Promise(resolve => setTimeout(resolve, 1)); inflight--;
    if (file.bad) throw new Error('この写真は読めませんでした。');
    return new Blob(['jpeg'], { type: 'image/jpeg' });
  } });
  await page.button('思い出してから開く').click(); const input = page.$('photo-input'); input.files = [{}, { bad: true }, {}]; await input.emit('change');
  assert.equal(maximum, 1); assert.match(progress[1], /2 \/ 3 枚/); assert.match(page.$('main').textContent, /この写真は読めませんでした/);
  assert.equal(page.$('main').querySelectorAll('.preview').length, 2); assert.equal(page.app.entries.forNote(todayNote.id).filter(row => row.event.kind === 'photo').length, 2);
  await page.$('tab-list').click(); await page.$('tab-today').click();
  assert.equal(page.$('main').querySelectorAll('.preview').length, 0); assert.match(page.$('main').textContent, /写真 2 枚が反映待ち/);
  assert.ok(page.requests.every(url => !url.includes('google'))); page.app.dispose();
});
test('applied removes both pending displays from the rendered note', async () => {
  const data = structuredClone(fixture), page = await boot({ data }); await page.button('思い出してから開く').click();
  const text = page.app.entries.record(todayNote.id, '取り込み対象'); await page.app.entries.flush();
  const photo = await page.app.entries.photo(todayNote.id, new Blob(['x'], { type: 'image/jpeg' }));
  assert.match(page.$('main').textContent, /反映待ち/); data.applied.push(text.event.id, photo.event.id); await page.app.load();
  assert.ok(!page.$('main').textContent.includes('反映待ち')); assert.ok(!page.$('main').textContent.includes('取り込み対象')); page.app.dispose();
});
test('note strings are textContent, never parsed as markup', async () => {
  const data = structuredClone(fixture); data.notes.find(note => note.id === data.today.note_id).body = '<script>attack()</script><img onerror="attack()">';
  const page = await boot({ data }); await page.button('思い出してから開く').click();
  assert.match(page.$('main').querySelector('.note-body').textContent, /<script>/); assert.equal(page.$('main').querySelectorAll('script').length, 0); page.app.dispose();
});
test('production end-to-end uses injected config, recovers pending text on restart, logs photo after upload', async () => {
  const dom = makeDOM(''), server = fakeDrive(fixture);
  dom.storage.set(STORAGE_KEY, JSON.stringify({ session: { accessToken: 'test-only', expiresAt: Date.now() + 3600000 } }));
  const app = await startApp({ ...dom, clientId: 'injected-client', fetcher: server.fetcher, now: Date.now, registerWorker: false, resize: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) });
  await dom.button('思い出してから開く').click(); server.controls.failLog = true;
  dom.$('append-text').value = '偽 Drive の追記'; await dom.$('main').querySelector('form').emit('submit');
  assert.match(dom.$('main').textContent, /未送信/); assert.equal(app.entries.pendingCount(), 1); app.dispose();
  server.controls.failLog = false;
  const nextDOM = makeDOM('', dom.storage), next = await startApp({ ...nextDOM, clientId: 'injected-client', fetcher: server.fetcher, registerWorker: false, resize: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) });
  assert.equal(next.entries.pendingCount(), 0); assert.equal(server.log().entries.length, 1);
  const file = nextDOM.$('photo-input'); file.files = [{}]; await file.emit('change');
  assert.equal(server.log().entries[1].kind, 'photo'); assert.match(server.mutations.at(-2).name, /\.jpg$/); assert.equal(server.mutations.at(-1).name, 'append_log.json');
  next.dispose();
});
test('redirect login receives injected client/path, logout clears tokens only', async () => {
  const dom = makeDOM(''), page = await boot({ dom });
  await page.$('tab-settings').click(); assert.equal(page.$('folder-path').value, 'injected/path');
  await page.button('Google でログイン').click(); const url = new URL(page.window.location.assigned);
  assert.equal(url.searchParams.get('client_id'), 'test-client'); assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8080/MemoirNote/');
  page.app.store.state.session = { accessToken: 'test', expiresAt: now() + 100000 }; page.app.entries.record('test', '未送信');
  await page.button('ログアウト').click(); assert.equal(page.app.store.state.session, null); assert.equal(page.app.store.state.pendingLogin, null); assert.equal(page.app.entries.pendingCount(), 1); page.app.dispose();
});
test('popup is prepared before click, uses same scopes, and demo never loads GIS', async () => {
  const dom = makeDOM(''); let args, requested = false;
  dom.window.google = { accounts: { oauth2: { initTokenClient(options) { args = options; return { requestAccessToken() { requested = true; } }; } } } };
  const page = await boot({ dom }); await page.$('tab-settings').click(); const method = page.$('login-method'); method.value = 'popup'; await method.emit('change');
  await eventually(() => !page.button('Google でログイン').disabled); await page.button('Google でログイン').click();
  assert.ok(requested); assert.equal(args.client_id, 'test-client'); assert.match(args.scope, /drive\.readonly/); assert.match(args.scope, /drive\.file/); page.app.dispose();
  const demo = await boot(); demo.app.store.state.settings.method = 'popup'; await demo.$('tab-settings').click(); assert.equal(demo.document.head.querySelectorAll('script').length, 0); demo.app.dispose();
});
test('navigation during photo processing releases previews and re-enables the current picker', async () => {
  let finish;
  const page = await boot({ resize: () => new Promise(resolve => { finish = resolve; }) });
  await page.button('思い出してから開く').click(); const file = page.$('photo-input'); file.files = [{}]; const uploading = file.emit('change');
  await page.$('tab-list').click(); await page.$('tab-today').click(); assert.ok(page.$('photo-input').disabled);
  finish(new Blob(['jpeg'], { type: 'image/jpeg' })); await uploading;
  assert.equal(page.$('photo-input').disabled, false); assert.equal(page.$('main').querySelectorAll('.preview').length, 0); assert.match(page.$('main').textContent, /写真 1 枚が反映待ち/);
  page.app.dispose(); assert.equal(page.live.size, 0);
});
test('startup retries persisted text even if memoir export is temporarily missing', async () => {
  const dom = makeDOM(''), server = fakeDrive(fixture);
  dom.storage.set(STORAGE_KEY, JSON.stringify({ session: { accessToken: 'test-only', expiresAt: Date.now() + 3600000 } }));
  const app = await startApp({ ...dom, fetcher: server.fetcher, registerWorker: false });
  app.entries.record(todayNote.id, '書き出しが無くても送る'); app.dispose();
  server.files.splice(server.files.findIndex(file => file.id === 'memoir'), 1);
  const nextDOM = makeDOM('', dom.storage), next = await startApp({ ...nextDOM, fetcher: server.fetcher, registerWorker: false });
  assert.equal(next.entries.pendingCount(), 0); assert.equal(server.log().entries[0].text, '書き出しが無くても送る'); assert.match(nextDOM.$('notice').textContent, /memoir.json が見つかりません/); next.dispose();
});
