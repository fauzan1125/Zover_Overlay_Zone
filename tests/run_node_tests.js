/**
 * Headless Node CLI test runner for ZoVer test suite.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Mock browser globals
class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.children = [];
    this.parentNode = null;
    const self = this;
    this.classList = {
      _classes: new Set(),
      add(...cls) { cls.filter(Boolean).forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.filter(Boolean).forEach(c => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
      toggle(c) { if (this.contains(c)) this.remove(c); else this.add(c); }
    };
    this.style = {
      setProperty: (k, v) => { this.style[k] = v; },
      getPropertyValue: (k) => { return this.style[k] || ''; },
      removeProperty: (k) => { delete this.style[k]; }
    };
    this.dataset = {};
    this._innerHTML = '';
    this._textContent = '';
    this.value = '';
    this.checked = false;
    this.src = '';
    this.volume = 1;
    this.currentTime = 0;
  }
  get className() {
    return Array.from(this.classList._classes).join(' ');
  }
  set className(val) {
    this.classList._classes.clear();
    String(val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = String(val || '');
    this.children = [];
    if (!this._innerHTML) return;
    const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9-]+)([^>]*)\/?>/g;
    let m;
    while ((m = tagRegex.exec(this._innerHTML)) !== null) {
      const tag = m[1] || m[4];
      const attrs = m[2] || m[5] || '';
      const inner = m[3] || '';
      const child = new MockElement(tag);
      child._rawAttrs = attrs;
      const idMatch = attrs.match(/\bid=["']([^"']+)["']/);
      if (idMatch) child.id = idMatch[1];
      const clsMatch = attrs.match(/\bclass=["']([^"']+)["']/);
      if (clsMatch) child.className = clsMatch[1];
      if (inner) child.innerHTML = inner;
      this.appendChild(child);
    }
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val ?? '');
    if (this._textContent === '') {
      this.children = [];
      this._innerHTML = '';
    }
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get outerHTML() {
    const attrs = this._rawAttrs || (this.id ? ` id="${this.id}"` : '') + (this.className ? ` class="${this.className}"` : '');
    return `<${this.tagName.toLowerCase()}${attrs}>${this._innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  appendChild(child) {
    if (!child) return child;
    if (child.parentNode && child.parentNode !== this) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    if (!this.children.includes(child)) {
      this.children.push(child);
    }
    if (child.id) {
      elementsById.set(child.id, child);
    }
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    if (child && child.id && elementsById.get(child.id) === child) {
      elementsById.delete(child.id);
    }
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
    if (this.id && elementsById.get(this.id) === this) {
      elementsById.delete(this.id);
    }
  }
  _matches(sel) {
    if (!sel) return false;
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }
  querySelectorAll(sel) {
    const results = [];
    const visit = (node) => {
      for (const ch of node.children || []) {
        if (ch._matches && ch._matches(sel)) results.push(ch);
        visit(ch);
      }
    };
    visit(this);
    return results;
  }
  closest(sel) {
    if (this._matches(sel)) return this;
    if (this.parentNode && this.parentNode.closest) {
      return this.parentNode.closest(sel);
    }
    return null;
  }
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  removeAttribute(k) { delete this[k]; }
  addEventListener() {}
  removeEventListener() {}
  cloneNode() { return new MockElement(this.tagName); }
}

const elementsById = new Map();

const mockDocument = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => {
    const found = mockDocument.body.querySelector(`#${id}`);
    if (found) return found;
    if (!elementsById.has(id)) {
      const el = new MockElement();
      el.id = id;
      elementsById.set(id, el);
    }
    return elementsById.get(id);
  },
  querySelector: (sel) => mockDocument.body.querySelector(sel) || new MockElement(),
  querySelectorAll: (sel) => mockDocument.body.querySelectorAll(sel),
  addEventListener: () => {},
  removeEventListener: () => {},
  body: new MockElement('body'),
  head: new MockElement('head'),
  documentElement: new MockElement('html')
};

class MockBroadcastChannel {
  constructor(name) { this.name = name; }
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const mockStorage = {
  _data: {},
  getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

global.window = global;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = mockDocument;
global.localStorage = mockStorage;
global.BroadcastChannel = MockBroadcastChannel;
global.Audio = class {
  constructor() {
    this.src = '';
    this.volume = 1;
    this.currentTime = 0;
  }
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
};
global.speechSynthesis = {
  getVoices() { return [{ name: 'Google Bahasa Indonesia', lang: 'id-ID' }]; },
  speak() {},
  cancel() {},
  speaking: false,
  onvoiceschanged: null
};
global.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
    this.voice = null;
    this.lang = '';
    this.volume = 1;
    this.rate = 1;
    this.pitch = 1;
    this.onend = null;
    this.onerror = null;
  }
};
global.navigator = { userAgent: 'NodeTestRunner' };
global.location = { href: 'http://localhost:8765/', search: '', pathname: '/' };
global.requestAnimationFrame = (cb) => { if (typeof cb === 'function') cb(); return 1; };

// Load modules
const rootDir = path.resolve(__dirname, '..');
const scripts = [
  'js/tts.js',
  'js/overlay.js',
  'js/connectors/kick.js',
  'js/connectors/youtube.js',
  'js/connectors/tiktok.js',
  'js/connectors/tikfinity.js',
  'js/viewcount.js',
  'js/alerts.js',
  'js/running_text.js',
  'js/chalert.js',
  'js/app.js',
  'tests/tests.js'
];

for (const script of scripts) {
  const fullPath = path.join(rootDir, script);
  const code = fs.readFileSync(fullPath, 'utf-8');
  try {
    vm.runInThisContext(code);
  } catch (err) {
    console.error(`Error loading ${script}:`, err);
    process.exit(1);
  }
}

if (typeof window.runAllTests === 'function') {
  const res = window.runAllTests();
  if (res.failed > 0) {
    console.error(`\nTest suite finished with ${res.failed} failures.`);
    process.exit(1);
  } else {
    console.log(`\nAll ${res.passed} client tests passed successfully!`);
    process.exit(0);
  }
} else {
  console.error('runAllTests is not defined');
  process.exit(1);
}
