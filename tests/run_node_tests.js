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
    this.children = [];
    this.classList = {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
      toggle(c) { if (this.contains(c)) this.remove(c); else this.add(c); }
    };
    this.style = {
      setProperty: (k, v) => { this.style[k] = v; },
      getPropertyValue: (k) => { return this.style[k] || ''; },
      removeProperty: (k) => { delete this.style[k]; }
    };
    this.dataset = {};
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
  }
  get outerHTML() {
    return `<${this.tagName.toLowerCase()}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  querySelector() { return new MockElement(); }
  querySelectorAll() { return []; }
  closest(sel) {
    if (sel && sel.startsWith('.') && this.classList.contains(sel.slice(1))) {
      return this;
    }
    if (this.parentNode && this.parentNode.closest) {
      return this.parentNode.closest(sel);
    }
    return null;
  }
  addEventListener() {}
  removeEventListener() {}
  cloneNode() { return new MockElement(this.tagName); }
}

const elementsById = new Map();

const mockDocument = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => {
    if (!elementsById.has(id)) {
      elementsById.set(id, new MockElement());
    }
    return elementsById.get(id);
  },
  querySelector: () => new MockElement(),
  querySelectorAll: () => [],
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
