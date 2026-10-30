import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('shared list exposes native header/empty/footer/refresh/paging/key contract', () => {
  const wrapper = read('src/components/perf/performance-list.tsx');
  assert.match(wrapper, /extends Omit<FlatListProps<T>/);
  for (const slot of ['header', 'footer', 'empty']) assert.match(wrapper, new RegExp(slot + '\\?: ReactElement'));
  assert.match(wrapper, /ListHeaderComponent=\{header\}/);
  assert.match(wrapper, /ListFooterComponent=\{footer\}/);
  assert.match(wrapper, /ListEmptyComponent=\{empty\}/);
  assert.match(wrapper, /\.\.\.props/);
  assert.match(wrapper, /bottomNavigationHeight/);
  const list = read('src/components/ui/data-list.tsx');
  for (const prop of ['keyExtractor', 'onEndReached', 'refreshControl']) assert.match(list, new RegExp(prop + '='));
  assert.doesNotMatch(wrapper, /getItemLayout=/, 'variable-height bilingual rows cannot use guessed heights');
});

test('font loading does not prevent session mount; splash follows readiness', () => {
  const boot = read('app/_layout.tsx');
  assert.match(boot, /SplashScreen\.preventAutoHideAsync\(\)/);
  assert.match(boot, /fontsReady && booted && localeReady/);
  assert.match(boot, /SplashScreen\.hideAsync\(\)/);
  assert.doesNotMatch(boot, /if \(!fontsLoaded\)/);
  assert.doesNotMatch(boot, /from '@expo-google-fonts\/be-vietnam-pro';/);
});

test('unread count and unread paged feed cannot share a cache/request identity', () => {
  const screen = read('src/screens/student/NotificationsScreen.tsx');
  assert.match(screen, /key: `content\.notifications\.\$\{tab\}`/);
  assert.match(screen, /useContentQuery<number>\('content\.notifications\.unread-count'/);
  assert.match(read('src/hooks/use-dashboard-prefetch.ts'), /'content\.notifications\.unread-count'/);
});
