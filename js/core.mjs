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
  const rejected = (Array.isArray(raw?.rejected) ? raw.rejected : []).filter(row => row && typeof row.id === 'string' && typeof row.reason === 'string').map(({ id, reason }) => ({ id, reason }));
  return { generated: string(raw?.generated), notes, today, applied: (Array.isArray(raw?.applied) ? raw.applied : []).filter(id => typeof id === 'string'), rejected };
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
  return { id, kind, note_id: noteId, ...(kind === 'text' ? { text: value } : kind === 'create' ? { title: value.title, meta: value.meta, body: value.body } : { photo: `${id}.jpg` }), at };
}

export function validEvent(event) {
  return Boolean(event && /^m-\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{4}$/i.test(event.id)
    && typeof event.note_id === 'string' && event.note_id
    && typeof event.at === 'string' && event.at.endsWith('+09:00') && Number.isFinite(Date.parse(event.at))
    && (event.kind === 'text' ? typeof event.text === 'string' && event.text.trim() && textLength(event.text) <= TEXT_LIMIT
      : event.kind === 'create' ? validCreation(event)
        : event.kind === 'photo' && event.photo === `${event.id}.jpg`));
}

export function memoryDraft(value = {}, time = Date.now()) {
  return {
    title: string(value?.title), dateKind: ['day', 'month', 'range'].includes(value?.dateKind) ? value.dateKind : 'day',
    date: typeof value?.date === 'string' ? value.date : japanDate(time),
    month: typeof value?.month === 'string' ? value.month : japanDate(time).slice(0, 7), end: string(value?.end),
    place: string(value?.place), people: Array.isArray(value?.people) ? value.people.filter(person => typeof person === 'string') : [],
    person: string(value?.person), body: string(value?.body),
  };
}

const lineBreak = /[\r\n\u2028\u2029]/;
function titleError(title) {
  if (!title.trim()) return '題を入力してください。';
  if (/[\/\\]/.test(title) || lineBreak.test(title)) return '題には /、\\、改行を入れられません。';
  if (/^[_\.]/.test(title.trim())) return '題は _ や . で始められません。';
  return textLength(title.trim()) > 40 ? '題は 40 字までです。' : '';
}
export function personError(person) {
  if (!person.trim()) return '名前を入力してください。';
  if (/[・/]/.test(person) || lineBreak.test(person)) return '名前には ・、/、改行を入れられません。';
  return textLength(person.trim()) > 20 ? '名前は 1 人 20 字までです。' : '';
}
function validDate(value, month = false) {
  if (!(month ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(value) || value.startsWith('0000')) return false;
  const day = month ? `${value}-01` : value, parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(Number(parsed)) && parsed.toISOString().slice(0, 10) === day;
}
export function makeMemory(draft, notes = [], pending = []) {
  const title = string(draft.title).trim(), place = string(draft.place).trim(), body = string(draft.body);
  const error = titleError(string(draft.title));
  if (error) throw new Error(error);
  const month = draft.dateKind === 'month', date = month ? draft.month : draft.date;
  if (!['day', 'month', 'range'].includes(draft.dateKind) || !validDate(date, month)) throw new Error(month ? '月を YYYY-MM の形で入力してください。' : '日付を入力してください（YYYY-MM-DD）。');
  let label = date.replaceAll('-', '.');
  if (draft.dateKind === 'range') {
    if (!validDate(draft.end) || draft.end <= date) throw new Error('期間の終わりは、始まりより後の日にしてください。');
    const offset = date.slice(0, 7) === draft.end.slice(0, 7) ? 8 : date.slice(0, 4) === draft.end.slice(0, 4) ? 5 : 0;
    label += `-${draft.end.slice(offset).replaceAll('-', '.')}`;
  }
  if (lineBreak.test(string(draft.place)) || place.includes('/')) throw new Error('場所には改行や / を入れられません（日付 / 場所 / 人の区切りに使います）。');
  if (textLength(place) > 60) throw new Error('場所は 60 字までです。');
  const people = (draft.people || []).map(person => {
    const error = personError(person); if (error) throw new Error(error); return person.trim();
  });
  if (string(draft.person).trim()) throw new Error('入力中の名前を「人を足す」で足してください。');
  if (textLength(body) > 10000) throw new Error('本文は 10000 字までです。');
  const note_id = `${date}_${title}`;
  if (notes.some(note => note.id === note_id) || pending.some(row => row.event.note_id === note_id)) throw new Error('同じ日付と題のノートがあります。題を変えてください');
  return { note_id, title, meta: `${label} / ${place} / ${people.join('・')}`, body };
}
function validCreation(event) {
  if (typeof event.title !== 'string' || titleError(event.title) || event.title !== event.title.trim()
    || typeof event.meta !== 'string' || lineBreak.test(event.meta) || !event.meta.trim()
    || typeof event.body !== 'string' || textLength(event.body) > 10000) return false;
  const date = event.note_id.slice(0, event.note_id.indexOf('_'));
  return validDate(date, date.length === 7) && event.note_id === `${date}_${event.title}`;
}

export function memoryCandidates(notes) {
  const places = new Map(), people = new Map();
  const add = (map, value) => { if (value) map.set(value, (map.get(value) || 0) + 1); };
  for (const note of notes) {
    const fields = string(note.meta).split('/').map(value => value.trim());
    add(places, fields[1]);
    for (const person of (fields[2] || '').split(/[・、]/)) add(people, person.trim());
  }
  const rank = map => [...map].sort((a, b) => b[1] - a[1]).map(([value]) => value);
  return { places: rank(places), people: rank(people) };
}
export const matchingCandidates = (values, query) => query.trim() ? values.filter(value => value.includes(query.trim())).slice(0, 8) : [];

export function pendingNotes(notes, creations) {
  const ids = new Set(creations.map(row => row.event.note_id));
  return [...notes.filter(note => !ids.has(note.id)), ...creations.map(row => ({
    id: row.event.note_id, title: row.event.title, date: row.event.note_id.split('_')[0],
    meta: row.event.meta, body: row.event.body, hook: '', photos: [], creation: row,
  }))];
}
export const creationMessage = row => row.reason ? `Mac で作れませんでした: ${row.reason}` : 'Mac に届くのを待っています';

export function errorMessage(error) {
  return error?.status === 403 ? WRITE_PERMISSION_MESSAGE : error?.status === 401 ? 'もう一度ログインしてください。未送信の追記は端末に残っています。'
    : error?.message || '通信できませんでした。もう一度お試しください。';
}
