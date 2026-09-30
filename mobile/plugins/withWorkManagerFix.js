// react-native-android-widget uses androidx.work 2.8.1, while another library
// still pulls in work-runtime-ktx 2.7.1. From 2.8 the ktx classes live in
// work-runtime itself, so both copies clash ("Duplicate class
// androidx.work.OneTimeWorkRequestKt"). Pinning ktx to 2.8.1 (an empty shell)
// resolves it.
const { withAppBuildGradle } = require('expo/config-plugins');

const LINE = "    implementation 'androidx.work:work-runtime-ktx:2.8.1' // paylog-workmanager-fix";

module.exports = function withWorkManagerFix(config) {
  return withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (!gradle.includes('paylog-workmanager-fix')) {
      cfg.modResults.contents = gradle.replace(/dependencies\s*\{/, (m) => `${m}\n${LINE}`);
    }
    return cfg;
  });
};
