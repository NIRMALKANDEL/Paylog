// Signs Android release builds with your own private key instead of the
// public debug key from the template.
//
// The key and its passwords never live in this project: put them in
// ~/.gradle/gradle.properties (see BUILD.md):
//   PAYLOG_UPLOAD_STORE_FILE=C:/Users/you/.paylog/paylog-release.jks
//   PAYLOG_UPLOAD_KEY_ALIAS=paylog
//   PAYLOG_UPLOAD_STORE_PASSWORD=...
//   PAYLOG_UPLOAD_KEY_PASSWORD=...
// Without them, release builds fall back to the debug key (fine for local testing only).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// paylog-release-signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        ${MARKER}
        release {
            if (project.hasProperty('PAYLOG_UPLOAD_STORE_FILE')) {
                storeFile file(PAYLOG_UPLOAD_STORE_FILE)
                storePassword PAYLOG_UPLOAD_STORE_PASSWORD
                keyAlias PAYLOG_UPLOAD_KEY_ALIAS
                keyPassword PAYLOG_UPLOAD_KEY_PASSWORD
            }
        }`,
    );
    // In the release build type, use the private key when it is configured.
    gradle = gradle.replace(
      /(release\s*\{[^{}]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('PAYLOG_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
