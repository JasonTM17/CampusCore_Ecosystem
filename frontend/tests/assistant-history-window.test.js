const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const moduleCache = new Map();

function load(relativePath) {
  if (moduleCache.has(relativePath)) return moduleCache.get(relativePath);
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const dependency = (name) => {
    if (name === '@/lib/assistant-history-window') {
      return load('src/lib/assistant-history-window.ts');
    }
    throw new Error(`Unexpected module import in history-window test loader: ${name}`);
  };
  Function('require', 'module', 'exports', output)(
    dependency,
    moduleRecord,
    moduleRecord.exports,
  );
  moduleCache.set(relativePath, moduleRecord.exports);
  return moduleRecord.exports;
}

function exchange(index, prefix = 'e') {
  return [
    { id: `u-${prefix}${index}`, role: 'user', content: `question ${index}` },
    {
      id: `a-${prefix}${index}`,
      role: 'assistant',
      content: `answer ${index}`,
      citations: [],
    },
  ];
}

function transcript(count, prefix = 'e') {
  const messages = [];
  for (let index = 0; index < count; index += 1) {
    messages.push(...exchange(index, prefix));
  }
  return messages;
}

function ids(messages) {
  return messages.map((message) => message.id);
}

test('admitLiveExchange reserves two slots and evicts the oldest full exchange', () => {
  const { admitLiveExchange, ASSISTANT_HISTORY_WINDOW_SIZE } = load(
    'src/lib/assistant-history-window.ts',
  );
  const current = transcript(50);
  assert.equal(current.length, ASSISTANT_HISTORY_WINDOW_SIZE);

  const admitted = admitLiveExchange(current);

  assert.equal(admitted.messages.length, 98, 'two slots stay free for the new exchange');
  assert.deepEqual(ids(admitted.evicted), ['u-e0', 'a-e0']);
  assert.equal(admitted.messages.at(-1).id, 'a-e49', 'the live tail is intact');
  // The caller appends the user + assistant pair afterwards; the result is 100.
  assert.equal(admitted.messages.length + 2, ASSISTANT_HISTORY_WINDOW_SIZE);
});

test('admitLiveExchange preserves feedback-attached messages and the latest retryable turn', () => {
  const { admitLiveExchange } = load('src/lib/assistant-history-window.ts');
  const current = transcript(60);
  // Exchange 3 has an in-flight feedback save; exchange 4 has a saved rating.
  current[7] = { ...current[7], feedbackPending: true };
  current[9] = { ...current[9], feedback: 'UP' };

  const admitted = admitLiveExchange(current);

  assert.ok(admitted.messages.length <= 100);
  assert.ok(admitted.messages.some((message) => message.id === 'a-e3'));
  assert.ok(admitted.messages.some((message) => message.id === 'a-e4'));
  assert.equal(admitted.messages[0].id, 'u-e3', 'the protected pair is the oldest retained');
  assert.equal(
    admitted.messages.some((message) => message.id === 'a-e2'),
    false,
    'unprotected exchanges before the protected pair are evicted',
  );
  assert.equal(admitted.messages.at(-1).id, 'a-e59', 'latest turn preserved');
  assert.equal(admitted.messages.at(-2).id, 'u-e59', 'latest prompt preserved');
});

test('fitHistoryWindow replays more than 300 messages to the 100-message bound', () => {
  const { fitHistoryWindow, ASSISTANT_HISTORY_WINDOW_SIZE } = load(
    'src/lib/assistant-history-window.ts',
  );
  const replayed = transcript(160);
  assert.equal(replayed.length, 320);

  const fitted = fitHistoryWindow(replayed);

  assert.equal(fitted.messages.length, ASSISTANT_HISTORY_WINDOW_SIZE);
  assert.equal(fitted.evicted.length, 220);
  assert.equal(fitted.messages.at(-1).id, 'a-e159');
});

test('prependHistoryPage keeps the older page and evicts the newest end', () => {
  const { prependHistoryPage, previewEvictedIds } = load(
    'src/lib/assistant-history-window.ts',
  );
  const current = transcript(50);
  const older = transcript(25, 'o');

  const evictedIds = previewEvictedIds(current, older.length);
  const page = prependHistoryPage(current, older);

  assert.equal(page.messages.length, 100);
  assert.equal(page.messages[0].id, 'u-o0', 'the requested older page is visible');
  assert.equal(page.messages.some((message) => message.id === 'a-e49'), false);
  assert.equal(page.messages.at(-1).id, 'a-e24', 'the newest end leaves the window');
  assert.equal(page.messages.some((message) => message.id === 'u-e24'), true);
  assert.deepEqual(
    page.evicted.map((message) => message.id).sort(),
    evictedIds.slice().sort(),
    'the preview matches the ids the reducer actually drops',
  );
});

test('prependHistoryPage deduplicates overlapping ids before applying the bound', () => {
  const { prependHistoryPage } = load('src/lib/assistant-history-window.ts');
  const current = exchange(0);
  const page = [...exchange(-1, 'o'), ...exchange(0)];

  const result = prependHistoryPage(current, page);

  assert.deepEqual(ids(result.messages), [
    'u-o-1',
    'a-o-1',
    'u-e0',
    'a-e0',
  ]);
  assert.equal(result.messages.filter((message) => message.id === 'a-e0').length, 1);
});

test('canNavigateHistory blocks streaming, reconciliation, loading and evicted feedback writes', () => {
  const { canNavigateHistory } = load('src/lib/assistant-history-window.ts');

  assert.equal(canNavigateHistory({ isSending: false }), true);
  assert.equal(canNavigateHistory({ isSending: true }), false);
  assert.equal(canNavigateHistory({ isSending: false, isReconciling: true }), false);
  assert.equal(canNavigateHistory({ isSending: false, loading: true }), false);
  assert.equal(
    canNavigateHistory({
      isSending: false,
      feedbackPendingIds: ['a-1'],
      evictedIds: ['u-0', 'a-1'],
    }),
    false,
    'a feedback write that the page would evict must block navigation',
  );
  assert.equal(
    canNavigateHistory({
      isSending: false,
      feedbackPendingIds: ['a-1'],
      evictedIds: ['u-0', 'a-0'],
    }),
    true,
    'an unrelated in-flight write does not block older paging',
  );
});

test('rebaseCursor never reuses a stale cursor and takes the latest page boundary', () => {
  const { rebaseCursor } = load('src/lib/assistant-history-window.ts');

  assert.deepEqual(rebaseCursor({ cursor: 'old', stale: false }), {
    cursor: 'old',
    needsLatestPage: false,
    rebased: false,
    reason: 'current',
  });
  assert.deepEqual(rebaseCursor({ cursor: 'old', stale: true }), {
    cursor: undefined,
    needsLatestPage: true,
    rebased: false,
    reason: 'refresh-latest',
  });
  assert.deepEqual(
    rebaseCursor({
      cursor: 'old',
      stale: true,
      latestPage: { items: [], nextCursor: 'fresh' },
    }),
    {
      cursor: 'fresh',
      needsLatestPage: false,
      rebased: true,
      reason: 'latest-page',
    },
  );
  assert.deepEqual(
    rebaseCursor({
      cursor: 'old',
      stale: true,
      latestPage: { items: [], nextCursor: undefined },
    }),
    {
      cursor: undefined,
      needsLatestPage: false,
      rebased: true,
      reason: 'latest-page',
    },
  );
});

test('history responses are fenced by conversation, scope and generation', () => {
  const { isCurrentHistoryResponse } = load('src/lib/assistant-history-window.ts');
  const current = { conversationId: 'c1', scope: 'academic', generation: 4 };

  assert.equal(isCurrentHistoryResponse({ ...current }, current), true);
  assert.equal(
    isCurrentHistoryResponse({ ...current, conversationId: 'c0' }, current),
    false,
  );
  assert.equal(
    isCurrentHistoryResponse({ ...current, scope: 'specialized' }, current),
    false,
  );
  assert.equal(
    isCurrentHistoryResponse({ ...current, generation: 3 }, current),
    false,
  );
});

test('appendConversationPage bounds the newest-first sidebar at 100 without duplicates', () => {
  const { appendConversationPage } = load('src/lib/assistant-history-window.ts');
  const conversations = (count, prefix = 'c') =>
    Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }));

  const full = appendConversationPage(conversations(100), conversations(20, 'n'));
  assert.equal(full.items.length, 100);
  assert.equal(full.truncated, true);

  const deduplicated = appendConversationPage(
    conversations(2),
    [{ id: 'c1' }, { id: 'n1' }],
  );
  assert.deepEqual(deduplicated.items.map((item) => item.id), ['c0', 'c1', 'n1']);
  assert.equal(deduplicated.truncated, false);
});

test('reducer replay fits >300 messages and still reserves admission slots', () => {
  const { assistantReducer } = load('src/components/assistant/assistant-reducer.ts');

  let state = assistantReducer(
    { messages: [], windowEvictionCount: 0 },
    { type: 'reset', messages: transcript(160) },
  );
  assert.equal(state.messages.length, 100, 'replay is bounded on reset');
  assert.equal(state.windowEvictionCount, 0);

  state = assistantReducer(state, {
    type: 'user',
    message: { id: 'new-u', role: 'user', content: 'new question' },
  });
  state = assistantReducer(state, {
    type: 'assistant-start',
    message: { id: 'new-a', role: 'assistant', content: '', pending: true },
  });

  assert.equal(state.messages.length, 100);
  assert.ok(state.windowEvictionCount > 0, 'live eviction is reported to the panel');
  assert.equal(state.messages.at(-1).id, 'new-a');
});

test('streaming tail, retry identity and feedback survive evictions', () => {
  const {
    assistantReducer,
    initialState,
  } = load('src/components/assistant/assistant-reducer.ts');

  let state = assistantReducer(initialState, {
    type: 'reset',
    conversationId: 'conv-1',
    messages: transcript(50),
  });

  state = assistantReducer(state, {
    type: 'user',
    message: { id: 'tail-u', role: 'user', content: 'tail question' },
  });
  state = assistantReducer(state, {
    type: 'assistant-start',
    message: { id: 'tail-a', role: 'assistant', content: '', pending: true },
  });
  state = assistantReducer(state, { type: 'delta', text: 'str' });
  state = assistantReducer(state, {
    type: 'citation',
    citation: { id: 'cit-1', title: 'Source', excerpt: 'x', source: 'y' },
  });
  state = assistantReducer(state, {
    type: 'complete',
    reply: {
      messageId: 'server-tail-a',
      content: 'streamed answer',
      reasonCode: 'ANSWERED',
      degraded: false,
    },
  });

  let tail = state.messages.at(-1);
  assert.equal(tail.id, 'server-tail-a', 'server id replaces the optimistic id');
  assert.equal(tail.content, 'streamed answer');
  assert.equal(tail.pending, false);
  assert.equal(tail.citations.length, 1);

  // Retry rewrites the settled tail in place: the identity and window stay put.
  state = assistantReducer(state, { type: 'retry-start', prompt: 'tail question' });
  tail = state.messages.at(-1);
  assert.equal(tail.id, 'server-tail-a');
  assert.equal(tail.content, '');
  assert.equal(tail.pending, true);
  assert.deepEqual(tail.citations, []);
  assert.equal(state.messages.length, 100);

  state = assistantReducer(state, {
    type: 'complete',
    reply: { messageId: 'server-tail-a', content: 'retried answer', reasonCode: 'ANSWERED' },
  });
  state = assistantReducer(state, { type: 'feedback-start', messageId: 'server-tail-a' });
  state = assistantReducer(state, {
    type: 'feedback-saved',
    messageId: 'server-tail-a',
    rating: 'UP',
  });

  // Admit another exchange; the oldest exchange is evicted, never the tail.
  state = assistantReducer(state, {
    type: 'user',
    message: { id: 'next-u', role: 'user', content: 'next' },
  });
  state = assistantReducer(state, {
    type: 'assistant-start',
    message: { id: 'next-a', role: 'assistant', content: '', pending: true },
  });

  const feedbackTail = state.messages.find(
    (message) => message.id === 'server-tail-a',
  );
  assert.ok(feedbackTail, 'feedback-attached tail survives live eviction');
  assert.equal(feedbackTail.feedback, 'UP');
  assert.equal(state.messages.length, 100);
});

test('an older feedback-attached message is preserved by live eviction', () => {
  const {
    assistantReducer,
    initialState,
  } = load('src/components/assistant/assistant-reducer.ts');

  let state = assistantReducer(initialState, {
    type: 'reset',
    messages: transcript(50),
  });
  state = assistantReducer(state, {
    type: 'feedback-saved',
    messageId: 'a-e0',
    rating: 'DOWN',
  });

  state = assistantReducer(state, {
    type: 'user',
    message: { id: 'live-u', role: 'user', content: 'live' },
  });
  state = assistantReducer(state, {
    type: 'assistant-start',
    message: { id: 'live-a', role: 'assistant', content: '', pending: true },
  });

  assert.ok(state.messages.some((message) => message.id === 'a-e0'));
  assert.equal(
    state.messages.find((message) => message.id === 'a-e0').feedback,
    'DOWN',
  );
});

test('prepend reducer action evicts from the newest end for older-history browsing', () => {
  const {
    assistantReducer,
    initialState,
  } = load('src/components/assistant/assistant-reducer.ts');

  let state = assistantReducer(initialState, {
    type: 'reset',
    messages: transcript(50),
  });
  state = assistantReducer(state, {
    type: 'prepend',
    messages: transcript(25, 'o'),
  });

  assert.equal(state.messages.length, 100);
  assert.ok(state.messages.some((message) => message.id === 'u-o0'));
  assert.equal(
    state.messages.some((message) => message.id === 'a-e49'),
    false,
    'the newest end leaves the window while browsing older pages',
  );
  assert.equal(state.windowEvictionCount, 0, 'browsing is not a live eviction');
});
