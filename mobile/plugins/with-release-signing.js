const { withAppBuildGradle } = require('expo/config-plugins');

const START = '// @generated begin campuscore-release-signing';
const END = '// @generated end campuscore-release-signing';

const signing = `${START}
def campuscoreStorePath = System.getenv('CAMPUSCORE_RELEASE_STORE_FILE')
def campuscoreStoreFile = campuscoreStorePath ? rootProject.file(campuscoreStorePath) : rootProject.file('campusute-release.keystore')
def campuscoreStorePassword = System.getenv('CAMPUSCORE_RELEASE_STORE_PASSWORD')
def campuscoreKeyPassword = System.getenv('CAMPUSCORE_RELEASE_KEY_PASSWORD')
def campuscoreKeyAlias = System.getenv('CAMPUSCORE_RELEASE_KEY_ALIAS')

// Always override the template's release identity; debug retains its own config.
android {
    signingConfigs {
        campuscoreRelease {
            storeFile campuscoreStoreFile
            storePassword campuscoreStorePassword
            keyAlias campuscoreKeyAlias
            keyPassword campuscoreKeyPassword
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.campuscoreRelease
        }
    }
}

gradle.taskGraph.whenReady { taskGraph ->
    if (taskGraph.allTasks.any { task -> task.project == project && task.name.toLowerCase(java.util.Locale.ROOT).contains('release') }) {
        def required = [
            'CAMPUSCORE_RELEASE_STORE_PASSWORD': campuscoreStorePassword,
            'CAMPUSCORE_RELEASE_KEY_PASSWORD': campuscoreKeyPassword,
            'CAMPUSCORE_RELEASE_KEY_ALIAS': campuscoreKeyAlias
        ]
        if (required.any { name, value -> value == null || value.trim().isEmpty() } || !campuscoreStoreFile.isFile()) {
            throw new GradleException('Release signing requires an operator keystore (CAMPUSCORE_RELEASE_STORE_FILE or android/campusute-release.keystore) and CAMPUSCORE_RELEASE_STORE_PASSWORD, CAMPUSCORE_RELEASE_KEY_PASSWORD, CAMPUSCORE_RELEASE_KEY_ALIAS. Debug signing is never used for release.')
        }
        if (campuscoreKeyAlias.equalsIgnoreCase('androiddebugkey') || campuscoreStoreFile.name.equalsIgnoreCase('debug.keystore')) {
            throw new GradleException('Release signing requires an operator keystore, not the Android debug identity.')
        }
        if (android.buildTypes.release.signingConfig != android.signingConfigs.campuscoreRelease) {
            throw new GradleException('Release signing configuration was overridden; refusing to build.')
        }
    }
}
${END}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error('Release signing guard requires a Groovy app build.gradle');
    }
    const contents = modConfig.modResults.contents;
    const start = contents.indexOf(START);
    const end = contents.indexOf(END);
    if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) {
      throw new Error('Release signing guard markers are incomplete');
    }
    const base = start < 0 ? contents : contents.slice(0, start) + contents.slice(end + END.length).replace(/^\r?\n/, '');
    modConfig.modResults.contents = `${base.trimEnd()}\n\n${signing}`;
    return modConfig;
  });
};
