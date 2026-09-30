// Extends app.json. Real builds only talk to the server over HTTPS; a local
// test build (PAYLOG_ALLOW_HTTP=1) may also reach a backend on this computer.
module.exports = ({ config }) => {
  if (process.env.PAYLOG_ALLOW_HTTP === "1") {
    config.plugins = config.plugins.map((plugin) =>
      Array.isArray(plugin) && plugin[0] === "expo-build-properties"
        ? [plugin[0], { ...plugin[1], android: { ...plugin[1].android, usesCleartextTraffic: true } }]
        : plugin,
    );
  }
  return config;
};
