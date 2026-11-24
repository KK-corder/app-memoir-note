import { TEXT_LIMIT, textLength, makeEvent, errorMessage, makeMemory, memoryDraft } from './core.mjs';

export function createEntries(store, drive, { demo = false, now = Date.now, random = globalThis.crypto, onChange = () => {} } = {}) {
  const scope = () => demo ? 'demo' : `drive:${store.state.settings.path}`;
  let running;
  const creations = () => store.state.entries.filter(row => row.scope === scope() && row.event.kind === 'create');
  const blocked = noteId => creations().some(row => row.event.note_id === noteId && (row.status !== 'sent' || row.reason));
  function checkWritable(noteId) {
    if (blocked(noteId)) throw new Error('ノートを送ってから書き足せます');
  }
  function saveDraft(value) {
    const target = scope(), before = store.state.drafts[target];
    if (value === null) delete store.state.drafts[target];
    else store.state.drafts[target] = memoryDraft(value, now());
    if (store.save()) return true;
    if (before === undefined) delete store.state.drafts[target]; else store.state.drafts[target] = before;
    return false;
  }
  function recordCreate(draft, notes = []) {
    const memory = makeMemory(draft, notes, creations()), target = scope();
    const row = { scope: target, event: event('create', memory.note_id, memory), status: 'pending', error: '' };
    const before = store.state.drafts[target];
    store.state.entries.push(row); delete store.state.drafts[target];
    if (!store.save()) {
      store.state.entries.pop(); if (before !== undefined) store.state.drafts[target] = before;
      throw new Error('端末に保存できなかったため、入力を残しました。');
    }
    onChange(); return row;
  }
  function event(kind, noteId, value) {
    let result;
    do { result = makeEvent(kind, noteId, value, now(), random); }
    while (store.state.entries.some(row => row.event.id === result.id));
    return result;
  }
  function record(noteId, text) {
    checkWritable(noteId);
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
    while ((row = store.state.entries.find(row => row.scope === target && row.status === 'pending' && !row.reason))) {
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
    checkWritable(noteId);
    const target = scope();
    const entry = event('photo', noteId);
    if (!demo) await drive.uploadPhoto(entry, blob, target.slice(6));
    store.state.entries.push({ scope: target, event: entry, status: 'sent', error: '' });
    const persisted = store.save();
    onChange();
    return { event: entry, persisted };
  }
  function reconcile(applied, rejected = []) {
    const ids = new Set(applied);
    const before = store.state.entries;
    let changed = false;
    for (const row of creations()) {
      const rejection = rejected.find(item => item.id === row.event.id);
      if (rejection && row.reason !== rejection.reason) { row.reason = rejection.reason; changed = true; }
    }
    store.state.entries = before.filter(row => row.scope !== scope() || row.reason || !ids.has(row.event.id));
    if (changed || before.length !== store.state.entries.length) { store.save(); onChange(); }
  }
  function removeRejected(id) {
    const before = store.state.entries;
    store.state.entries = before.filter(row => !(row.scope === scope() && row.event.kind === 'create' && row.event.id === id && row.reason));
    if (!store.save()) { store.state.entries = before; return false; }
    onChange(); return true;
  }
  return {
    record, recordCreate, flush, photo, reconcile, scope, creations, blocked, removeRejected, saveDraft,
    draft: () => memoryDraft(store.state.drafts[scope()], now()),
    forNote: id => store.state.entries.filter(row => row.scope === scope() && row.event.note_id === id),
    pendingCount: () => store.state.entries.filter(row => row.scope === scope() && row.status === 'pending').length,
    allPendingCount: () => store.state.entries.filter(row => row.status === 'pending').length,
  };
}
