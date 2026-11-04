export const DEFAULT_PATH = '思い出ノート/_app';
export const TEXT_LIMIT = 2000;
export const WRITE_PERMISSION_MESSAGE = 'もう一度ログインして書き込みを許可してください';
export const textLength = text => Array.from(text).length;
export const japanISO = time => new Date(Number(time) + 9 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+09:00');
export const japanDate = time => japanISO(time).slice(0, 10);
export const openedKey = today => JSON.stringify([today.date, today.note_id]);
const string = value => typeof value === 'string' ? value : '';

export function normalizeMemoir(raw) {
  const notes = (Array.isArray(raw?.notes) ? raw.notes : []).filter(note => note && typeof note.id === 'string' && note.id).map(note => ({
    id: note.id, title: string(note.title) || '題のない思い出', date: string(note.date),
    meta: string(note.meta), body: string(note.body), hook: string(note.hook),
    photos: (Array.isArray(note.photos) ? note.photos : []).filter(photo => photo && typeof photo.drive_id === 'string').map(photo => ({ ...photo, name: string(photo.name) || '思い出の写真' })),
  }));
  const today = raw?.today && typeof raw.today === 'object' ? {
    date: string(raw.today.date), note_id: string(raw.today.note_id), reason: string(raw.today.reason), hook: string(raw.today.hook),
  } : null;
  return { generated: string(raw?.generated), notes, today, applied: (Array.isArray(raw?.applied) ? raw.applied : []).filter(id => typeof id === 'string') };
}

export function sortedNotes(notes, query = '') {
  const needle = query.toLocaleLowerCase();
  const date = note => /^\d{4}-\d{2}$/.test(note.date) ? `${note.date}-01` : note.date;
  return notes.filter(note => [note.title, note.meta, note.body].some(value => value.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => date(b).localeCompare(date(a)));
}

export function staleMessage(today, time) {
  if (!today || today.date === japanDate(time)) return '';
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today.date);
  return `${parts ? `${Number(parts[2])}月${Number(parts[3])}日` : '日付不明'}の思い出（Mac の書き出しがまだです）`;
}

export function makeEvent(kind, noteId, value, time = Date.now(), random = globalThis.crypto) {
  const at = japanISO(time);
  const bytes = random.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, byte => '0123456789abcdefghijklmnopqrstuvwxyz'[byte % 36]).join('');
  const id = `m-${at.slice(0, 10)}-${at.slice(11, 19).replaceAll(':', '')}-${suffix}`;
  return { id, kind, note_id: noteId, ...(kind === 'text' ? { text: value } : { photo: `${id}.jpg` }), at };
}

export function validEvent(event) {
  return Boolean(event && /^m-\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{4}$/i.test(event.id)
    && typeof event.note_id === 'string' && event.note_id
    && typeof event.at === 'string' && event.at.endsWith('+09:00') && Number.isFinite(Date.parse(event.at))
    && (event.kind === 'text' ? typeof event.text === 'string' && event.text.trim() && textLength(event.text) <= TEXT_LIMIT
      : event.kind === 'photo' && event.photo === `${event.id}.jpg`));
}

export function errorMessage(error) {
  return error?.status === 403 ? WRITE_PERMISSION_MESSAGE : error?.status === 401 ? 'もう一度ログインしてください。未送信の追記は端末に残っています。'
    : error?.message || '通信できませんでした。もう一度お試しください。';
}
