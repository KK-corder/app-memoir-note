import { readFileSync } from 'node:fs';

export class Node {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.listeners = new Map(); this.attributes = {};
    this._text = ''; this.className = ''; this.hidden = false; this.value = ''; this.disabled = false; this.scrollTop = 0;
  }
  set textContent(value) { this._text = String(value); for (const node of this.children) node.parent = null; this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(listener => listener !== fn)); }
  async emit(type, props = {}) { for (const fn of this.listeners.get(type) || []) await fn({ preventDefault() {}, touches: [], ...props }); }
  click() { if (!this.disabled) return this.emit('click'); }
  descendants(predicate) { return this.children.flatMap(child => [...(predicate(child) ? [child] : []), ...child.descendants(predicate)]); }
  querySelectorAll(selector) {
    return this.descendants(node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : selector.startsWith('#') ? node.id === selector.slice(1) : node.tagName === selector.toUpperCase());
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

export function makeDOM(search = '?demo=1', storage = new Map()) {
  const document = new Node('document'); document.ownerDocument = document;
  document.createElement = tag => new Node(tag, document);
  document.head = document.createElement('head'); document.body = document.createElement('body'); document.append(document.head, document.body);
  document.baseURI = 'http://localhost:8080/MemoirNote/';
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = document.createElement(match[1]); node.id = match[2]; node.hidden = /\shidden\b/.test(match[0]); document.body.append(node);
  }
  document.getElementById = id => document.querySelector('#' + id);
  const window = {
    listeners: new Map(), addEventListener: Node.prototype.addEventListener, removeEventListener: Node.prototype.removeEventListener, emit: Node.prototype.emit,
    location: { search, hash: '', pathname: '/MemoirNote/', origin: 'http://localhost:8080', assign(url) { this.assigned = url; } },
    history: { replaceState(...args) { this.replaced = args; } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    navigator: {}, crypto: globalThis.crypto,
  };
  const live = new Set(), revoked = [];
  let serial = 0;
  const urls = { createObjectURL() { const url = `blob:test-${++serial}`; live.add(url); return url; }, revokeObjectURL(url) { live.delete(url); revoked.push(url); } };
  return { window, document, storage, urls, live, revoked, $: id => document.getElementById(id), button: text => document.querySelectorAll('button').find(node => node.textContent === text) };
}

export async function eventually(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); }
  throw new Error('Condition did not become true');
}
