import { validSession } from './login.mjs';
import { validEvent, WRITE_PERMISSION_MESSAGE } from './core.mjs';

const API = 'https://www.googleapis.com/drive/v3/';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const MARKER = 'memoir-note-v1';
export const escapeDriveValue = value => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export function searchQuery(parent, name, folder = false) {
  return `'${escapeDriveValue(parent)}' in parents and trashed = false and name = '${escapeDriveValue(name)}'${folder ? " and mimeType = 'application/vnd.google-apps.folder'" : ''}`;
}
export class DriveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Drive {
  constructor(store, onExpired = () => {}, fetcher = globalThis.fetch) {
    this.store = store; this.onExpired = onExpired; this.fetcher = fetcher; this.queue = Promise.resolve();
  }
  async request(url, options = {}, format = 'json') {
    if (!validSession(this.store.state.session)) throw new DriveError(401, 'もう一度ログインしてください。');
    const fetcher = this.fetcher;
    const response = await fetcher(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.store.state.session.accessToken}` }, cache: 'no-store' });
    if (response.status === 401) this.onExpired();
    if (!response.ok) throw new DriveError(response.status, response.status === 403 ? WRITE_PERMISSION_MESSAGE : `Drive と通信できませんでした（${response.status}）。`);
    return format === 'blob' ? response.blob() : response.json();
  }
  async find(parent, name, folder = false) {
    const files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: searchQuery(parent, name, folder), fields: 'nextPageToken,files(id,name,mimeType,isAppAuthorized,appProperties,capabilities(canEdit))', pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const result = await this.request(`${API}files?${params}`);
      files.push(...(result.files || [])); pageToken = result.nextPageToken || '';
    } while (pageToken);
    return files;
  }
  async unique(parent, name, folder = false) {
    const files = await this.find(parent, name, folder);
    if (files.length !== 1) throw new Error(files.length ? `${name} が複数あります。置き場を確認してください。` : `${name} が見つかりません。Mac の書き出しと置き場を確認してください。`);
    return files[0].id;
  }
  async folders(path = this.store.state.settings.path) {
    const cached = this.store.state.folders[path];
    if (typeof cached?.app === 'string') return cached;
    let app = 'root';
    const parts = path.split('/').map(part => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('置き場の道筋を入力してください。');
    for (const name of parts) app = await this.unique(app, name, true);
    const ids = { app };
    this.store.state.folders[path] = ids; this.store.save();
    return ids;
  }
  async inbox(path) {
    const { app } = await this.folders(path);
    return this.unique(app, 'inbox', true);
  }
  media(id) { return `${API}files/${encodeURIComponent(id)}?alt=media`; }
  async memoir() {
    const { app } = await this.folders();
    return this.request(this.media(await this.unique(app, 'memoir.json')));
  }
  photoBlob(photo, signal) { return this.request(this.media(photo.drive_id), { signal }, 'blob'); }
  serialize(job) {
    const result = this.queue.then(job);
    this.queue = result.catch(() => {});
    return result;
  }
  append(event, path = this.store.state.settings.path) {
    return this.serialize(async () => this.appendTo(await this.inbox(path), event));
  }
  async readLog(id) {
    let log;
    try { log = await this.request(this.media(id)); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    if (log?.version !== 1 || !Array.isArray(log.entries) || !log.entries.every(validEvent)) {
      throw new Error('append_log.json の形式を読めないため、上書きせず送信を止めました。');
    }
    return log;
  }
  async appendTo(inbox, event) {
    if (!validEvent(event)) throw new Error('追記の形式を確認してください。');
    const files = await this.find(inbox, 'append_log.json');
    if (files.length > 1) throw new Error('append_log.json が複数あります。上書きせず送信を止めました。');
    if (!files.length) return this.create(inbox, 'append_log.json', new Blob([JSON.stringify({ version: 1, entries: [event] })], { type: 'application/json' }));
    const file = files[0];
    if (!file.isAppAuthorized || file.appProperties?.memoirNote !== MARKER || file.capabilities?.canEdit !== true) throw new DriveError(403, WRITE_PERMISSION_MESSAGE);
    const check = log => {
      const existing = log.entries.find(row => row.id === event.id);
      if (existing && ['kind', 'note_id', 'at', 'text', 'photo'].some(key => existing[key] !== event[key])) throw new Error('同じ ID の別の追記があります。上書きせず送信を止めました。');
      return Boolean(existing);
    };
    if (check(await this.readLog(file.id))) return;
    // Re-read immediately before writing so additions since the first read survive.
    const latest = await this.readLog(file.id);
    if (check(latest)) return;
    latest.entries.push(event);
    return this.request(`${UPLOAD}/${encodeURIComponent(file.id)}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(latest),
    });
  }
  create(inbox, name, blob) {
    if (name !== 'append_log.json' && !/^m-\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]{4}\.jpg$/i.test(name)) throw new Error('書き込めないファイルです。');
    const boundary = `memoir_${globalThis.crypto.randomUUID()}`;
    const metadata = { name, parents: [inbox], mimeType: blob.type, appProperties: { memoirNote: MARKER } };
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${blob.type}\r\n\r\n`, blob, `\r\n--${boundary}--\r\n`]);
    return this.request(`${UPLOAD}?uploadType=multipart`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }
  uploadPhoto(event, blob, path = this.store.state.settings.path) {
    return this.serialize(async () => {
      if (!validEvent(event) || event.kind !== 'photo' || blob.type !== 'image/jpeg') throw new Error('JPEG 写真の形式を確認してください。');
      const inbox = await this.inbox(path);
      await this.create(inbox, event.photo, blob);
      await this.appendTo(inbox, event);
    });
  }
}
