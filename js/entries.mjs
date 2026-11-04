import { TEXT_LIMIT, textLength, makeEvent, errorMessage } from './core.mjs';

export function createEntries(store, drive, { demo = false, now = Date.now, random = globalThis.crypto, onChange = () => {} } = {}) {
  const scope = () => demo ? 'demo' : `drive:${store.state.settings.path}`;
  let running;
  function event(kind, noteId, value) {
    let result;
    do { result = makeEvent(kind, noteId, value, now(), random); }
    while (store.state.entries.some(row => row.event.id === result.id));
    return result;
  }
  function record(noteId, text) {
    if (textLength(text) > TEXT_LIMIT) throw new Error('追記は 2000 字までです。短くしてから書き足してください。');
    if (!text.trim()) throw new Error('思い出したことを入力してください。');
    const row = { scope: scope(), event: event('text', noteId, text), status: 'pending', error: '' };
    store.state.entries.push(row);
    if (!store.save()) {
      store.state.entries.pop();
      throw new Error('端末に保存できなかったため、入力を残しました。');
    }
    onChange();
    return row;
  }
  async function send() {
    const target = scope();
    let row;
    while ((row = store.state.entries.find(row => row.scope === target && row.status === 'pending'))) {
      try {
        if (!demo) await drive.append(row.event, target.slice(6));
        row.status = 'sent'; row.error = '';
        if (!store.save()) {
          row.status = 'pending';
          throw new Error('送信結果を端末に保存できません。次回、同じ ID を確認して送り直します。');
        }
      } catch (error) {
        row.error = errorMessage(error); store.save(); onChange(); break;
      }
      onChange();
    }
  }
  function flush() {
    if (!running) running = send().finally(() => { running = null; });
    return running;
  }
  async function photo(noteId, blob) {
    const target = scope();
    const entry = event('photo', noteId);
    if (!demo) await drive.uploadPhoto(entry, blob, target.slice(6));
    store.state.entries.push({ scope: target, event: entry, status: 'sent', error: '' });
    const persisted = store.save();
    onChange();
    return { event: entry, persisted };
  }
  function reconcile(applied) {
    const ids = new Set(applied);
    const before = store.state.entries;
    store.state.entries = before.filter(row => row.scope !== scope() || !ids.has(row.event.id));
    if (before.length !== store.state.entries.length) { store.save(); onChange(); }
  }
  return {
    record, flush, photo, reconcile, scope,
    forNote: id => store.state.entries.filter(row => row.scope === scope() && row.event.note_id === id),
    pendingCount: () => store.state.entries.filter(row => row.scope === scope() && row.status === 'pending').length,
    allPendingCount: () => store.state.entries.filter(row => row.status === 'pending').length,
  };
}
