export function resizedDimensions(width, height) {
  if (!(width > 0 && height > 0)) throw new Error('この写真は読めませんでした。');
  const scale = Math.min(1, 2048 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function shrinkPhoto(file, { document = globalThis.document, Image = globalThis.Image, urls = globalThis.URL } = {}) {
  const url = urls.createObjectURL(file);
  let canvas;
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = () => reject(new Error('この写真は読めませんでした。'));
      image.src = url;
    });
    const size = resizedDimensions(image.naturalWidth, image.naturalHeight);
    canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('この写真は読めませんでした。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob?.type === 'image/jpeg') resolve(blob);
      else reject(new Error('この写真は JPEG に変換できませんでした。'));
    }, 'image/jpeg', 0.85));
  } finally {
    urls.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function createGallery({ document, window, container, photos, loadBlob, urls = URL }) {
  let disposed = false, modal = null, index = 0, returnFocus;
  const abort = new AbortController(), loaded = new Map(), promises = new Map();
  const ownedURLs = new Set();
  const el = (tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
  const image = (url, alt) => { const node = el('img'); node.src = url; node.alt = alt; return node; };
  const buttons = photos.map((photo, i) => {
    const button = el('button', `写真 ${i + 1}`, 'photo-tile'); button.type = 'button';
    button.setAttribute('aria-label', `${photo.name} を全画面で見る`);
    button.addEventListener('click', () => open(i, button)); container.append(button); return button;
  });
  async function load(i) {
    if (disposed) return null;
    if (!promises.has(i)) promises.set(i, (async () => {
      try {
        const blob = await loadBlob(photos[i], abort.signal);
        if (disposed) return null;
        const url = urls.createObjectURL(blob); ownedURLs.add(url); loaded.set(i, url);
        buttons[i].replaceChildren(image(url, photos[i].name));
        return url;
      } catch (error) {
        if (!disposed) { buttons[i].textContent = `写真 ${i + 1} を読めませんでした`; promises.delete(i); }
        return null;
      }
    })());
    return promises.get(i);
  }
  function close() {
    if (!modal) return;
    modal.close(); modal.remove(); modal = null;
    returnFocus?.focus();
  }
  async function show(i) {
    index = (i + photos.length) % photos.length;
    const current = index, dialog = modal;
    const content = el('div', '写真を読み込んでいます…', 'viewer-image');
    const bar = el('div', '', 'viewer-bar');
    const prev = el('button', '前の写真'), next = el('button', '次の写真'), dismiss = el('button', '閉じる');
    prev.type = next.type = dismiss.type = 'button'; prev.disabled = next.disabled = photos.length < 2;
    prev.addEventListener('click', () => show(index - 1)); next.addEventListener('click', () => show(index + 1)); dismiss.addEventListener('click', close);
    bar.append(prev, el('span', `${index + 1} / ${photos.length}`), next, dismiss);
    dialog.replaceChildren(content, bar); dismiss.focus();
    const url = loaded.get(index) || await load(index);
    if (modal !== dialog || index !== current) return;
    if (url) content.replaceChildren(image(url, photos[index].name));
    else content.textContent = 'この写真を読めませんでした。閉じて、もう一度お試しください。';
  }
  function open(i, button) {
    if (disposed || !photos.length) return;
    returnFocus = button;
    if (!modal) {
      modal = el('dialog', '', 'photo-viewer'); modal.setAttribute('aria-label', '思い出の写真'); document.body.append(modal);
      modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
      modal.addEventListener('keydown', event => { if (event.key === 'ArrowRight') void show(index + 1); if (event.key === 'ArrowLeft') void show(index - 1); });
      let start;
      modal.addEventListener('touchstart', event => { start = event.touches[0]?.clientX; }, { passive: true });
      modal.addEventListener('touchend', event => {
        const end = event.changedTouches[0]?.clientX;
        if (Number.isFinite(start) && Number.isFinite(end) && Math.abs(end - start) > 50) void show(index + (end < start ? 1 : -1));
        start = undefined;
      }, { passive: true });
      modal.showModal();
    }
    return show(i);
  }
  let observer;
  if (window.IntersectionObserver) {
    observer = new window.IntersectionObserver(records => {
      for (const record of records) if (record.isIntersecting) { void load(buttons.indexOf(record.target)); observer.unobserve(record.target); }
    });
    buttons.forEach(button => observer.observe(button));
  } else {
    void (async () => { for (let i = 0; i < photos.length && !disposed; i++) await load(i); })();
  }
  return { open, close, dispose() {
    disposed = true; abort.abort(); observer?.disconnect(); close();
    for (const url of ownedURLs) urls.revokeObjectURL(url);
    ownedURLs.clear(); loaded.clear(); promises.clear(); container.replaceChildren();
  } };
}
