import test from 'node:test';
import assert from 'node:assert/strict';
import { shrinkPhoto, resizedDimensions, createGallery } from '../js/photos.mjs';
import { makeDOM, eventually } from './support/dom.mjs';

test('photo dimensions never upscale or exceed 2048 in portrait/landscape', () => {
  assert.deepEqual(resizedDimensions(4032, 3024), { width: 2048, height: 1536 });
  assert.deepEqual(resizedDimensions(3024, 4032), { width: 1536, height: 2048 });
  assert.deepEqual(resizedDimensions(640, 480), { width: 640, height: 480 });
});
test('canvas draws resized image and encodes JPEG at 0.85, releasing source URL', async () => {
  const { urls, live } = makeDOM(); const calls = [];
  class Image { naturalWidth = 4032; naturalHeight = 3024; set src(value) { this.onload(); } }
  const canvas = { getContext() { return { fillRect() {}, drawImage(...args) { calls.push(['draw', ...args.slice(1)]); } }; }, toBlob(callback, type, quality) { calls.push(['encode', this.width, this.height, type, quality]); callback(new Blob(['jpeg'], { type })); } };
  const blob = await shrinkPhoto(new Blob(), { document: { createElement: () => canvas }, Image, urls });
  assert.equal(blob.type, 'image/jpeg'); assert.deepEqual(calls, [['draw', 0, 0, 2048, 1536], ['encode', 2048, 1536, 'image/jpeg', 0.85]]);
  assert.equal(live.size, 0); assert.equal(canvas.width, 0);
});
test('undecodable HEIC reports a readable error and releases source URL', async () => {
  const { urls, live } = makeDOM(); class Image { set src(value) { this.onerror(); } }
  await assert.rejects(shrinkPhoto(new Blob(['heic']), { Image, urls }), /この写真は読めませんでした/); assert.equal(live.size, 0);
});
test('gallery lazily fetches intersecting photos and opens, advances, swipes and closes modal', async () => {
  const dom = makeDOM(); let observed, callback; const loaded = [];
  dom.window.IntersectionObserver = class { constructor(fn) { callback = fn; observed = []; } observe(node) { observed.push(node); } unobserve() {} disconnect() {} };
  const container = dom.document.createElement('div'); dom.document.body.append(container);
  const gallery = createGallery({ ...dom, container, photos: [1, 2, 3].map(i => ({ name: `photo ${i}`, drive_id: i })), loadBlob: async photo => { loaded.push(photo.drive_id); return new Blob(); } });
  assert.deepEqual(loaded, []); callback([{ isIntersecting: true, target: observed[0] }]); await eventually(() => dom.live.size === 1); assert.deepEqual(loaded, [1]);
  await gallery.open(0, observed[0]); let modal = dom.document.querySelector('dialog'); assert.ok(modal.open); assert.match(modal.textContent, /1 \/ 3/);
  await dom.button('次の写真').click(); await eventually(() => dom.live.size === 2); assert.match(modal.textContent, /2 \/ 3/);
  await modal.emit('touchstart', { touches: [{ clientX: 200 }] }); await modal.emit('touchend', { changedTouches: [{ clientX: 10 }] });
  await eventually(() => dom.live.size === 3); assert.match(modal.textContent, /3 \/ 3/);
  await dom.button('閉じる').click(); assert.equal(dom.document.querySelector('dialog'), null); assert.equal(dom.document.activeElement, observed[0]);
  gallery.dispose(); assert.equal(dom.live.size, 0);
});
test('leaving the screen before an in-flight photo finishes creates no leaked URL', async () => {
  const dom = makeDOM(); let finish;
  const gallery = createGallery({ ...dom, container: dom.document.createElement('div'), photos: [{ name: 'p' }], loadBlob: () => new Promise(resolve => { finish = resolve; }) });
  gallery.dispose(); finish(new Blob()); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(dom.live.size, 0);
});
