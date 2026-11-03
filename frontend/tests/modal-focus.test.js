const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createRuntime,
  loadMessages,
  loadTs,
} = require('./dashboard-shell-harness');

const messages = loadMessages('vi');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

/**
 * Minimal DOM: tracks focus and ancestry, enough for the dialog's focus
 * management (contains/activeElement/focus) and ref attachment by the mount
 * walk below.
 */
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.props = {};
    this.style = {};
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  contains(node) {
    for (let current = node; current; current = current.parent) {
      if (current === this) return true;
    }
    return false;
  }

  focus() {
    global.document.activeElement = this;
  }
}

function installDom() {
  const created = [];
  const documentStub = {
    activeElement: null,
    body: new FakeNode('body'),
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) {
      const element = new FakeNode(tag);
      created.push(element);
      return element;
    },
    created,
  };
  global.document = documentStub;
  global.window = { document: documentStub };
  global.HTMLElement = FakeNode;
  return documentStub;
}

/**
 * Walks the rendered element tree the way a commit would: builds DOM nodes,
 * attaches ref objects, and fires a child `autoFocus` once mounted (React's
 * own autoFocus behaviour). Function components that return null (stubbed
 * icons) disappear.
 */
function mountTree(node, documentStub) {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') {
    return new FakeNode('#text');
  }
  if (Array.isArray(node)) {
    const fragment = new FakeNode('#fragment');
    for (const child of node) {
      const mounted = mountTree(child, documentStub);
      if (mounted) fragment.appendChild(mounted);
    }
    return fragment;
  }
  if (!React.isValidElement(node)) return null;
  if (typeof node.type === 'function') {
    return mountTree(node.type(node.props), documentStub);
  }
  const element = documentStub.createElement(node.type);
  Object.assign(element.props, node.props);
  const children = mountTree(node.props.children, documentStub);
  if (children) element.appendChild(children);
  const ref = node.ref ?? node.props.ref;
  if (ref && typeof ref === 'object') ref.current = element;
  if (node.props.autoFocus) element.focus();
  return element;
}

function loadModal() {
  const runtime = createRuntime();
  const moduleExports = loadTs(
    'src/components/ui/modal.tsx',
    {
      react: { ...runtime.fakeReact, useId: () => 'modal-test-id' },
      'react/jsx-runtime': require('react/jsx-runtime'),
      'react-dom': { createPortal: (children) => children },
      'lucide-react': iconStub,
      '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
      '@/components/ui/button': { Button: () => null },
      '@/i18n': { useI18n: () => ({ messages }) },
    },
    { cache: false },
  );
  return { runtime, Modal: moduleExports.Modal };
}

/**
 * The Modal renders nothing until its mount effect flips `mounted`; the open
 * effect (previous-focus capture + the scheduled focus callback) runs during
 * that same first pass, exactly as it does in a real commit.
 */
function renderOpen(runtime, Modal, props) {
  runtime.runEffects(runtime.render(Modal, props).effects);
  const rendered = runtime.render(Modal, props);
  runtime.runEffects(rendered.effects);
  return rendered.tree;
}

test('a dialog keeps focus on the field that claimed it with autoFocus', () => {
  const documentStub = installDom();
  const rafCallbacks = [];
  global.requestAnimationFrame = (callback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };

  const { runtime, Modal } = loadModal();
  const tree = renderOpen(runtime, Modal, {
    isOpen: true,
    onClose: () => {},
    title: 'Return for rework',
    children: React.createElement('textarea', {
      id: 'announcement-return-reason',
      autoFocus: true,
    }),
  });
  const root = mountTree(tree, documentStub);
  documentStub.body.appendChild(root);

  const textarea = documentStub.created.find((element) => element.tagName === 'TEXTAREA');
  assert.ok(textarea, 'the dialog mounts the reason field');
  assert.equal(
    documentStub.activeElement,
    textarea,
    'autoFocus focuses the field while the portal mounts',
  );

  for (const callback of rafCallbacks.splice(0)) callback();
  assert.equal(
    documentStub.activeElement,
    textarea,
    'the deferred focus pass must not move focus off the field',
  );
});

test('a dialog without an autoFocus field still lands on the close button', () => {
  const documentStub = installDom();
  const rafCallbacks = [];
  global.requestAnimationFrame = (callback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };

  const { runtime, Modal } = loadModal();
  const tree = renderOpen(runtime, Modal, {
    isOpen: true,
    onClose: () => {},
    title: 'Details',
    children: React.createElement('p', null, 'Body'),
  });
  const root = mountTree(tree, documentStub);
  documentStub.body.appendChild(root);

  const closeButton = documentStub.created.find((element) => element.tagName === 'BUTTON');
  assert.ok(closeButton, 'the header close button exists');
  for (const callback of rafCallbacks.splice(0)) callback();
  assert.equal(
    documentStub.activeElement,
    closeButton,
    'with no claimed field the close button keeps its initial focus',
  );
});
