import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const pluginPath = './plugins/with-release-signing';

test('every profile installs a committed release signing guard', () => {
  assert.ok(config.plugins.includes(pluginPath), 'release signing plugin must be registered for every profile');
});

test('generated release signing overrides the template debug identity and rejects missing credentials', async () => {
  assert.ok(config.plugins.includes(pluginPath), 'release signing plugin must be registered for every profile');
  const plugin = require('../plugins/with-release-signing.js');
  const template = `android {
    signingConfigs { debug { storeFile file('debug.keystore') } }
    buildTypes {
        debug { signingConfig signingConfigs.debug }
        release { signingConfig signingConfigs.debug }
    }
}
`;
  const mod = plugin({ mods: {} }).mods.android.appBuildGradle;
  const result = await mod({ modResults: { language: 'groovy', contents: template } });
  const generated = result.modResults.contents;
  assert.ok(generated.startsWith(template), 'debug build configuration must stay intact');
  assert.match(generated, /release\s*\{\s*signingConfig signingConfigs\.campuscoreRelease\s*\}/);
  assert.match(generated, /gradle\.taskGraph\.whenReady/);
  assert.match(generated, /task\.project == project.*task\.name\.toLowerCase\(.*\)\.contains\('release'\)/);
  for (const variable of ['CAMPUSCORE_RELEASE_STORE_PASSWORD', 'CAMPUSCORE_RELEASE_KEY_PASSWORD', 'CAMPUSCORE_RELEASE_KEY_ALIAS']) {
    assert.ok(generated.includes(`System.getenv('${variable}')`));
    assert.ok(generated.includes(`'${variable}':`), 'all credentials must be checked before release execution');
  }
  assert.match(generated, /\.isFile\(\)/);
  assert.match(generated, /throw new GradleException\('Release signing requires/);
  assert.doesNotMatch(generated.slice(template.length), /signingConfigs\.debug|campusute-release-store/);
  const repeated = await mod({ modResults: { language: 'groovy', contents: generated } });
  assert.equal(repeated.modResults.contents, generated, 'prebuild guard injection must be idempotent');
  await assert.rejects(mod({ modResults: { language: 'kotlin', contents: '' } }), /Groovy/);
});

test('Android config blocks the unused overlay permission', () => {
  assert.ok(config.android.blockedPermissions?.includes('android.permission.SYSTEM_ALERT_WINDOW'));
});
