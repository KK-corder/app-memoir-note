import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function worker() {
  const handlers = {};
  const context = vm.createContext({ URL, self: { location: { href: 'https://example.test/app-memoir-note/sw.js' }, addEventListener: (name, fn) => { handlers[name] = fn; } } });
  vm.runInContext(read('sw.js'), context); return { handlers, context };
}
test('Service Worker never intercepts Google, non-shell files, POSTs, or sibling apps', () => {
  const { handlers, context } = worker();
  for (const url of ['https://www.googleapis.com/drive/v3/files/x?alt=media', 'https://accounts.google.com/gsi/client', 'https://example.test/other/index.html', 'https://example.test/app-memoir-note/memoir.json', 'https://example.test/app-memoir-note/photos/private.jpg']) {
    let intercepted = false; handlers.fetch({ request: { url, method: 'GET' }, respondWith() { intercepted = true; } }); assert.equal(intercepted, false, url);
  }
  assert.equal(vm.runInContext("shellURL({ url: 'https://example.test/app-memoir-note/index.html', method: 'POST' })", context), null);
  assert.equal(vm.runInContext("shellURL({ url: 'https://example.test/app-memoir-note/?demo=1', method: 'GET' })", context), 'https://example.test/app-memoir-note/index.html');
  assert.match(vm.runInContext('CACHE', context), /-v\d+$/);
});
test('every cached asset exists and allowlist includes app modules and demo only', () => {
  const { context } = worker();
  const paths = vm.runInContext('SHELL', context).map(url => new URL(url).pathname.replace('/app-memoir-note/', ''));
  for (const path of paths) assert.ok(existsSync(new URL('../' + path, import.meta.url)), path);
  assert.ok(paths.includes('demo/memoir.json')); assert.ok(paths.includes('js/app.mjs'));
  assert.ok(!paths.some(path => path.includes('tests/') || path.includes('docs/')));
});
test('manifest is relative, standalone, Japanese, with real 192/512 and apple icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest')); assert.equal(manifest.name, '思い出ノート'); assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, './');
  for (const icon of [...manifest.icons, { src: './icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = readFileSync(new URL('../' + icon.src, import.meta.url)); const size = Number(icon.sizes.split('x')[0]);
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  assert.match(read('index.html'), /apple-touch-icon/);
});
test('mobile CSS includes safe areas, touch sizing, readable inputs, dark mode and wrapping', () => {
  const css = read('styles.css'); assert.match(read('index.html'), /viewport-fit=cover/);
  for (const edge of ['top', 'right', 'bottom', 'left']) assert.ok(css.includes(`env(safe-area-inset-${edge})`));
  assert.match(css, /min-height: 44px/); assert.match(css, /font-size: 16px/); assert.match(css, /100dvh/); assert.match(css, /white-space: pre-wrap/); assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /prefers-color-scheme: dark/);
});
