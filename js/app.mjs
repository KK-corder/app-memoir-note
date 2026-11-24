import { DEFAULT_PATH, normalizeMemoir, sortedNotes, openedKey, staleMessage, textLength, errorMessage, memoryCandidates, pendingNotes, creationMessage } from './core.mjs';
import { createStore } from './storage.mjs';
import { consumeRedirect, validSession, redirectURL, loadGIS, DRIVE_SCOPE } from './login.mjs';
import { Drive } from './drive.mjs';
import { createEntries } from './entries.mjs';
import { shrinkPhoto, createGallery } from './photos.mjs';
import { composeMemory } from './compose-memory.mjs';

export async function startApp({ clientId = '', defaultPath = DEFAULT_PATH, window = globalThis.window, document = globalThis.document,
  fetcher = globalThis.fetch, now = Date.now, urls = globalThis.URL, resize = shrinkPhoto, registerWorker = true } = {}) {
  const $ = id => document.getElementById(id);
  const main = $('main'), notice = $('notice');
  const demo = new URLSearchParams(window.location.search).get('demo') === '1';
  const el = (tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
  const button = (text, action, cls = '') => { const node = el('button', text, cls); node.type = 'button'; node.addEventListener('click', action); return node; };
  function announce(message) { notice.textContent = message; notice.hidden = !message; }
  let storage;
  try { storage = window.localStorage; } catch { announce('端末の保存領域を使えません。'); }
  const store = createStore(storage, announce, defaultPath);
  const redirect = demo ? {} : consumeRedirect(window.location, window.history, store, now());
  if (redirect.error) announce(redirect.error);
  const drive = new Drive(store, () => { store.state.session = null; store.save(); announce('もう一度ログインしてください。'); }, fetcher);
  let refreshUpdates = () => {}, data = normalizeMemoir(null), view = 'today', selected = null, query = '', listPosition = 0;
  let disposeView = () => {}, loadVersion = 0, busyPhotos = false, disposed = false, popupClient = null;
  let busyCreate = false, candidates = memoryCandidates([]);
  const entries = createEntries(store, drive, { demo, now, onChange: () => refreshUpdates() });
  $('mode-label').textContent = demo ? 'デモ' : '';
  const isLoggedIn = () => validSession(store.state.session, now());
  const rememberKey = today => JSON.stringify([entries.scope(), openedKey(today)]);

  async function load() {
    const version = ++loadVersion;
    if (!demo && !isLoggedIn()) { data = normalizeMemoir(null); candidates = memoryCandidates([]); render(); return; }
    try {
      let raw;
      if (demo) {
        const response = await fetcher(new URL('demo/memoir.json', document.baseURI).href, { cache: 'no-store' });
        if (!response.ok) throw new Error('デモを読み込めませんでした。');
        raw = await response.json();
      } else raw = await drive.memoir();
      if (disposed || version !== loadVersion) return;
      data = normalizeMemoir(raw); candidates = memoryCandidates(data.notes); entries.reconcile(data.applied, data.rejected); render();
      await entries.flush();
    } catch (error) {
      if (disposed || version !== loadVersion) return;
      announce(errorMessage(error)); render();
      await entries.flush();
    }
  }
  async function loadBlob(photo, signal) {
    if (!demo) return drive.photoBlob(photo, signal);
    if (!/^[a-z0-9_-]+\.(svg|png|jpg)$/i.test(photo.drive_id)) throw new Error('デモの写真の名前が不正です。');
    const response = await fetcher(new URL(`demo/photos/${photo.drive_id}`, document.baseURI).href, { signal });
    if (!response.ok) throw new Error('写真を読み込めませんでした。');
    return response.blob();
  }
  function navigate(next, note = null) {
    if (next === 'create' && busyCreate) { announce('新しい思い出を送っています。送信が終わってから作ってください。'); return; }
    if (view === 'list') listPosition = main.scrollTop;
    view = next; selected = note; render();
    main.scrollTop = next === 'list' ? listPosition : 0;
  }
  function render() {
    disposeView(); disposeView = () => {}; refreshUpdates = () => {};
    main.replaceChildren();
    for (const tab of ['today', 'list', 'settings']) $('tab-' + tab).setAttribute('aria-current', view === tab || (['note', 'create'].includes(view) && tab === 'list') ? 'page' : 'false');
    if (view === 'settings') return renderSettings();
    if (!demo && !isLoggedIn() && !data.notes.length && !entries.creations().length && !store.state.drafts[entries.scope()]) {
      main.append(el('h1', '思い出を、ひとつずつ。'), el('p', 'Google ドライブの思い出ノートを開きます。'), button('設定でログインする', () => navigate('settings'), 'primary')); return;
    }
    if (view === 'list') return renderList();
    if (view === 'create') {
      disposeView = composeMemory({ document, window, main, el, button, entries, candidates, now, urls, resize, submitMemory, navigate, announce });
      return;
    }
    if (view === 'note') {
      selected = pendingNotes(data.notes, entries.creations()).find(note => note.id === selected?.id) || selected;
      main.append(button('‹ 一覧へ戻る', () => navigate('list'), 'back'));
      return renderNote(selected, selected.hook);
    }
    main.append(el('p', '今日の思い出', 'eyebrow'));
    const today = data.today, note = data.notes.find(note => note.id === today?.note_id);
    if (!today || !note) {
      main.append(el('h1', '今日の思い出をまだ開けません'), el('p', today ? '今日のノートが書き出しにありません。一覧から思い出を開けます。' : '今日の指定がありません。Mac の書き出しを確認してください。'), button('一覧を見る', () => navigate('list'))); return;
    }
    const stale = staleMessage(today, now());
    if (stale) main.append(el('p', stale, 'banner'));
    main.append(el('p', today.reason, 'reason'));
    if (store.state.opened[rememberKey(today)]) return renderNote(note);
    main.append(el('h1', note.title), el('p', note.date, 'date'), el('p', today.hook || 'どんな日だった？', 'hook'));
    main.append(button('思い出してから開く', () => {
      store.state.opened[rememberKey(today)] = true; store.save(); render();
    }, 'primary reveal'));
  }
  function renderList() {
    main.append(el('h1', '思い出の一覧'), button('＋ 新しい思い出', () => navigate('create'), 'primary'));
    const label = el('label', '思い出を検索'); label.htmlFor = 'search';
    const search = el('input'); search.id = 'search'; search.type = 'search'; search.value = query; search.placeholder = '題・場所・本文から';
    const count = el('p', '', 'muted'), list = el('div', '', 'note-list');
    function update() {
      query = search.value; list.replaceChildren();
      const notes = sortedNotes(pendingNotes(data.notes, entries.creations()), query); count.textContent = `${notes.length} 件の思い出`;
      for (const note of notes) {
        const row = button('', () => navigate('note', note), 'note-row');
        row.append(el('span', note.date, 'date'), el('strong', note.title), el('span', `写真 ${note.photos.length} 枚`, 'muted'));
        if (note.creation) row.append(el('span', creationMessage(note.creation), 'pending-memory'));
        list.append(row);
      }
    }
    search.addEventListener('input', update); refreshUpdates = update; update(); main.append(label, search, count, list);
  }
  async function submitMemory(draft, photos, progress) {
    if (busyCreate) throw new Error('新しい思い出の送信が終わるまでお待ちください。');
    const row = entries.recordCreate(draft, data.notes);
    busyCreate = true;
    try {
      progress('ノートを送っています…'); await entries.flush();
      if (row.status !== 'sent') {
        announce(`${row.error || 'ノートは未送信で端末に残っています。'} 写真は、ノートが届いてからノートの画面で足してください`);
        return;
      }
      const failures = [];
      for (let i = 0; i < photos.length; i++) {
        progress(`${i + 1} / ${photos.length} 枚を送っています…`);
        try {
          const result = await entries.photo(row.event.note_id, photos[i]);
          if (!result.persisted) failures.push(`${i + 1} 枚目は送信済みですが、反映待ちの情報を端末に保存できませんでした。`);
        } catch (error) { failures.push(`${i + 1} 枚目：${errorMessage(error)} ノートの画面で写真をもう一度選び直してください。`); }
      }
      announce(failures.length ? failures.join('\n') : 'ノートを送りました。Mac に届くのを待っています。');
    } finally { busyCreate = false; }
  }
  function renderNote(note, hook = '') {
    if (hook) main.append(el('p', hook, 'small-hook'));
    main.append(el('h1', note.title), el('p', note.date, 'date'), el('p', note.meta, 'meta'), el('div', note.body, 'note-body'));
    const updates = el('section', '', 'updates'); updates.setAttribute('aria-label', '追記と反映待ち'); updates.setAttribute('aria-live', 'polite'); main.append(updates);
    const strip = el('div', '', 'photo-strip'); strip.setAttribute('aria-label', '思い出の写真'); main.append(strip);
    const gallery = createGallery({ document, window, container: strip, photos: note.photos, loadBlob, urls });
    const previews = new Map(); let active = true;
    function update() {
      updates.replaceChildren();
      const rows = entries.forNote(note.id), ids = new Set(rows.map(row => row.event.id));
      const creation = rows.find(row => row.event.kind === 'create');
      const blocked = entries.blocked(note.id);
      submit.disabled = blocked || textLength(input.value) > 2000; input.disabled = blocked; file.disabled = blocked || busyPhotos;
      if (creation) {
        updates.append(el('p', creationMessage(creation), 'banner'));
        if (creation.reason) {
          const confirm = el('section', '', 'confirm'); confirm.hidden = true;
          confirm.append(el('p', 'この端末の作成記録を消しますか？ Mac や Drive の記録は消しません。'),
            button('この記録を消して一覧へ戻る', () => { if (entries.removeRejected(creation.event.id)) navigate('list'); }),
            button('キャンセル', () => { confirm.hidden = true; }));
          updates.append(button('本文を写す', async () => {
            try {
              await window.navigator.clipboard.writeText(`# ${creation.event.title}\n\n${creation.event.meta}\n\n${creation.event.body}`);
              announce('題・日付 / 場所 / 一緒にいた人・本文を写しました。');
            } catch { announce('本文を写せませんでした。本文を選択してコピーしてください。'); }
          }), button('この記録を消す', () => { confirm.hidden = false; }), confirm);
        } else {
          updates.append(el('p', creation.status === 'sent' ? '送信済み・ノートへの反映待ち' : `未送信${creation.error ? `：${creation.error}` : ''}`, 'muted'));
          if (blocked) updates.append(el('p', 'ノートを送ってから書き足せます'));
        }
      }
      for (const [id, url] of previews) if (!ids.has(id)) { urls.revokeObjectURL(url); previews.delete(id); }
      for (const row of rows.filter(row => row.event.kind === 'text')) {
        const block = el('article', '', 'append');
        block.append(el('h2', '追記（Mac に届くのを待っています）'), el('p', row.event.text, 'note-body'), el('p', row.status === 'sent' ? '送信済み・ノートへの反映待ち' : `未送信${row.error ? `：${row.error}` : ''}`, 'muted'));
        updates.append(block);
      }
      const photos = rows.filter(row => row.event.kind === 'photo');
      if (photos.length) updates.append(el('p', `写真 ${photos.length} 枚が反映待ち`, 'muted'));
      for (const row of photos) if (previews.has(row.event.id)) {
        const figure = el('figure', '', 'preview'), image = el('img'); image.src = previews.get(row.event.id); image.alt = '追加した写真';
        figure.append(image, el('figcaption', 'Mac に届くのを待っています')); updates.append(figure);
      }
      if (rows.some(row => row.status === 'pending' && !row.reason)) updates.append(button('もう一度送る', () => entries.flush()));
    }
    const form = el('form', '', 'compose'), label = el('label', '思い出したことを書き足す'); label.htmlFor = 'append-text';
    const input = el('textarea'); input.id = 'append-text'; input.rows = 5; input.placeholder = '思い出したこと、覚えていること。';
    const length = el('p', '0 / 2000 字', 'muted'), feedback = el('p', '', 'form-message'); feedback.setAttribute('role', 'status');
    const submit = el('button', '書き足す', 'primary'); submit.type = 'submit';
    input.addEventListener('input', () => {
      const size = textLength(input.value); length.textContent = `${size} / 2000 字`; submit.disabled = entries.blocked(note.id) || size > 2000;
      feedback.textContent = size > 2000 ? '追記は 2000 字までです。短くしてから書き足してください。' : '';
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        entries.record(note.id, input.value); input.value = ''; length.textContent = '0 / 2000 字'; feedback.textContent = ''; submit.disabled = false;
        await entries.flush();
      } catch (error) { feedback.textContent = errorMessage(error); }
    });
    form.append(label, input, length, feedback, submit); main.append(form);
    const photoLabel = el('label', '写真を足す', 'file-button'); photoLabel.htmlFor = 'photo-input';
    const file = el('input'); file.id = 'photo-input'; file.type = 'file'; file.accept = 'image/*'; file.multiple = true; file.disabled = busyPhotos;
    const progress = el('p', '', 'muted'); progress.setAttribute('role', 'status');
    const errors = el('div', '', 'form-message'); errors.setAttribute('role', 'status');
    file.addEventListener('change', async () => {
      if (busyPhotos) return;
      if (entries.blocked(note.id)) { announce('ノートを送ってから書き足せます'); return; }
      const files = Array.from(file.files || []); busyPhotos = true; file.disabled = true; errors.replaceChildren();
      try {
        for (let i = 0; i < files.length; i++) {
          progress.textContent = `${i + 1} / ${files.length} 枚を送っています…`;
          try {
            const blob = await resize(files[i], { document, Image: window.Image, urls });
            const result = await entries.photo(note.id, blob);
            if (active) { previews.set(result.event.id, urls.createObjectURL(blob)); update(); }
            if (!result.persisted) announce('写真は送信済みですが、反映待ちの情報を端末に保存できませんでした。');
          } catch (error) {
            const message = `${i + 1} 枚目：${errorMessage(error)} 写真をもう一度選び直してください。`;
            if (active) errors.append(el('p', message)); else announce(message);
          }
        }
        progress.textContent = `${files.length} / ${files.length} 枚の処理が終わりました。`;
      } finally { busyPhotos = false; file.disabled = entries.blocked(note.id); file.value = ''; refreshUpdates(); }
    });
    main.append(photoLabel, file, progress, errors);
    refreshUpdates = update; update();
    disposeView = () => { active = false; gallery.dispose(); for (const url of previews.values()) urls.revokeObjectURL(url); previews.clear(); };
  }
  async function preparePopup(loginButton) {
    if (demo || store.state.settings.method !== 'popup') return;
    loginButton.disabled = true;
    try {
      const oauth = await loadGIS(document, window);
      popupClient = oauth.initTokenClient({ client_id: clientId, scope: DRIVE_SCOPE,
        callback: async response => {
          if (!response.access_token || response.error || !(Number(response.expires_in) > 0)) { announce('ログインがキャンセルされたか、許可されませんでした。'); return; }
          store.state.session = { accessToken: response.access_token, expiresAt: now() + Number(response.expires_in) * 1000 };
          store.save(); announce(''); await load();
        }, error_callback: () => announce('ログイン画面を開けませんでした。リダイレクト方式をお試しください。'),
      });
      loginButton.disabled = false;
    } catch (error) { announce(errorMessage(error)); }
  }
  function renderSettings() {
    main.append(el('h1', '設定'), el('p', demo ? 'デモ：ログイン・Drive 通信は使いません。' : isLoggedIn() ? 'ログイン済み' : 'ログインしていません'));
    const methodLabel = el('label', 'ログインの方式'); methodLabel.htmlFor = 'login-method';
    const method = el('select'); method.id = 'login-method';
    for (const [value, label] of [['redirect', 'リダイレクト（既定）'], ['popup', 'ポップアップ']]) { const option = el('option', label); option.value = value; method.append(option); }
    method.value = store.state.settings.method; method.disabled = demo;
    const login = button('Google でログイン', () => {
      if (demo) return;
      if (!clientId) { announce('クライアント ID が設定されていません。'); return; }
      if (store.state.settings.method === 'popup') { popupClient?.requestAccessToken({ prompt: 'consent' }); return; }
      const state = window.crypto.randomUUID(); store.state.pendingLogin = { state, createdAt: now() };
      if (!store.save()) { announce('ログインの確認情報を端末に保存できませんでした。'); return; }
      window.location.assign(redirectURL(clientId, window.location.origin + window.location.pathname, state));
    }, 'primary'); login.disabled = demo;
    method.addEventListener('change', () => { store.state.settings.method = method.value; store.save(); render(); });
    const logout = button('ログアウト', () => {
      store.state.session = null; store.state.pendingLogin = null; store.save(); data = normalizeMemoir(null); candidates = memoryCandidates([]); ++loadVersion; render();
    }); logout.disabled = demo;
    main.append(methodLabel, method, login, logout); void preparePopup(login);
    const pathForm = el('form', '', 'settings-group'), pathLabel = el('label', 'Drive の置き場（マイドライブから）'); pathLabel.htmlFor = 'folder-path';
    const path = el('input'); path.id = 'folder-path'; path.value = store.state.settings.path; path.disabled = demo;
    const save = el('button', '置き場を保存して読み直す'); save.type = 'submit'; save.disabled = demo;
    pathForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (busyPhotos || busyCreate) { announce('ノートと写真の送信が終わってから置き場を変更してください。'); return; }
      const value = path.value.split('/').map(part => part.trim()).filter(Boolean).join('/');
      if (!value) { announce('置き場の道筋を入力してください。'); return; }
      await entries.flush();
      store.state.settings.path = value; store.save(); data = normalizeMemoir(null); candidates = memoryCandidates([]); await load();
    });
    pathForm.append(pathLabel, path, save); main.append(pathForm);
    const pending = el('p'); refreshUpdates = () => {
      pending.textContent = `未送信の追記・新しい思い出：${entries.pendingCount()} 件（端末全体：${entries.allPendingCount()} 件）。別の置き場の未送信は、道筋を元に戻して送れます。`;
    }; refreshUpdates();
    main.append(pending, button('もう一度送る', () => entries.flush()));
    main.append(el('p', `いつの書き出しか：${data.generated || 'まだ読み込んでいません'}`, 'muted'), button('書き出しを読み直す', load));
    const confirm = el('section', '', 'confirm'); confirm.hidden = true;
    main.append(button('端末に覚えたものを消す', () => {
      const count = entries.allPendingCount();
      confirm.hidden = false; confirm.replaceChildren(el('p', `未送信の追記が ${count} 件あります（新しい思い出も含みます）。フォルダ ID と開いた状態を消します。追記・写真・新しい思い出の反映待ちと未送信、下書きは残します。`),
        button('未送信を残して消す', () => { store.clearRemembered(); confirm.hidden = true; announce('フォルダ ID と開いた状態を消しました。未送信は残しています。'); }),
        button('キャンセル', () => { confirm.hidden = true; }));
    }), confirm);
  }
  for (const tab of ['today', 'list', 'settings']) $('tab-' + tab).addEventListener('click', () => navigate(tab));
  const onOnline = () => { void entries.flush(); };
  window.addEventListener('online', onOnline);
  if (registerWorker && window.navigator.serviceWorker) window.navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch(() => announce('アプリの起動用データを保存できませんでした。'));
  render(); await load();
  return { store, entries, drive, load, navigate, get data() { return data; }, dispose() { disposed = true; ++loadVersion; disposeView(); window.removeEventListener('online', onOnline); } };
}
