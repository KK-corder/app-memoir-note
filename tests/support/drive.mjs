import assert from 'node:assert/strict';

export function fakeDrive(memoir = { notes: [] }) {
  const files = [
    { id: 'folder', name: '思い出ノート', parents: ['root'], mimeType: 'application/vnd.google-apps.folder' },
    { id: 'app', name: '_app', parents: ['folder'], mimeType: 'application/vnd.google-apps.folder' },
    { id: 'inbox', name: 'inbox', parents: ['app'], mimeType: 'application/vnd.google-apps.folder' },
    { id: 'memoir', name: 'memoir.json', parents: ['app'], mimeType: 'application/json', data: memoir },
  ];
  const calls = [], mutations = [], controls = {};
  const addLog = (entries = [], extra = {}) => {
    const file = { id: `log-${files.length}`, name: 'append_log.json', parents: ['inbox'], mimeType: 'application/json', isAppAuthorized: true, appProperties: { memoirNote: 'memoir-note-v1' }, capabilities: { canEdit: true }, data: { version: 1, entries }, ...extra };
    files.push(file); return file;
  };
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetcher(url, options = {}) {
    assert.equal(this, undefined, 'fetch must be invoked without a receiver');
    assert.match(options.headers.Authorization, /^Bearer /);
    assert.equal(options.cache, 'no-store');
    const parsed = new URL(url), method = options.method || 'GET'; calls.push({ url, method, options });
    if (controls.status) return response({}, controls.status);
    if (parsed.pathname === '/drive/v3/files') {
      const q = parsed.searchParams.get('q');
      const parent = /^'([^']+)' in parents/.exec(q)?.[1], name = /and name = '([^']+)'/.exec(q)?.[1];
      return response({ files: files.filter(file => file.parents.includes(parent) && file.name === name).map(({ data, ...metadata }) => metadata) });
    }
    if (parsed.pathname.startsWith('/drive/v3/files/')) {
      const id = decodeURIComponent(parsed.pathname.split('/').at(-1)), file = files.find(file => file.id === id);
      if (!file) return response({}, 404);
      if (file.name.endsWith('.jpg')) return new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
      controls.read?.(file);
      if (controls.invalidJSON && file.name === 'append_log.json') return new Response('{bad json');
      return response(file.data);
    }
    assert.match(url, /^https:\/\/www.googleapis.com\/upload\/drive\/v3\/files/);
    if (method === 'POST') {
      const boundary = options.headers['Content-Type'].split('boundary=')[1];
      const parts = (await options.body.text()).split(`--${boundary}`);
      const metadata = JSON.parse(parts[1].split('\r\n\r\n')[1].trim());
      assert.deepEqual(metadata.parents, ['inbox']);
      assert.ok(metadata.name === 'append_log.json' || /^m-.*\.jpg$/.test(metadata.name));
      if (controls.failPhoto && metadata.name.endsWith('.jpg')) return response({}, 500);
      if (controls.failLog && metadata.name === 'append_log.json') return response({}, 500);
      const file = { ...metadata, id: `created-${files.length}`, isAppAuthorized: true, capabilities: { canEdit: true }, data: metadata.mimeType === 'application/json' ? JSON.parse(parts[2].split('\r\n\r\n')[1].trim()) : null };
      files.push(file); mutations.push({ method, name: file.name });
      if (controls.loseResponse) { controls.loseResponse = false; throw new TypeError('connection lost after write'); }
      return response({ id: file.id });
    }
    assert.equal(method, 'PATCH');
    const file = files.find(file => file.id === decodeURIComponent(parsed.pathname.split('/').at(-1)));
    assert.equal(file.name, 'append_log.json'); assert.deepEqual(file.parents, ['inbox']);
    if (controls.failLog) return response({}, 500);
    file.data = JSON.parse(options.body); mutations.push({ method, name: file.name });
    if (controls.loseResponse) { controls.loseResponse = false; throw new TypeError('connection lost after write'); }
    return response({ id: file.id });
  }
  return { fetcher, files, calls, mutations, controls, addLog, log: () => files.find(file => file.name === 'append_log.json')?.data };
}
