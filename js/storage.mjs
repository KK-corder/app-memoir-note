import { DEFAULT_PATH } from './core.mjs';

export const STORAGE_KEY = 'memoir-note-v1';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function createStore(storage, onError = () => {}, defaultPath = DEFAULT_PATH) {
  let saved = {};
  try { saved = object(JSON.parse(storage?.getItem(STORAGE_KEY) || '{}')); }
  catch { onError('端末の保存データを読めませんでした。'); }
  const state = {
    session: saved.session || null, pendingLogin: saved.pendingLogin || null,
    settings: { method: saved.settings?.method === 'popup' ? 'popup' : 'redirect', path: typeof saved.settings?.path === 'string' && saved.settings.path.trim() ? saved.settings.path : defaultPath },
    folders: object(saved.folders), opened: object(saved.opened),
    entries: Array.isArray(saved.entries) ? saved.entries.filter(row => row && typeof row.scope === 'string' && row.event?.id) : [],
  };
  function save() {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch { onError('端末に保存できません。空き容量やブラウザの設定を確認してください。'); return false; }
  }
  return { state, save, clearRemembered() { state.folders = {}; state.opened = {}; return save(); } };
}
