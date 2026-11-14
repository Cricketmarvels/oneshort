// Expo config: app.json plus anything that depends on the build environment.
// Google Sign-In's config plugin needs the iOS URL scheme from the iOS OAuth client, so it is only added when
// GOOGLE_IOS_URL_SCHEME is set (EAS secret / local .env). Without it the app builds exactly as before and the
// Google button stays hidden (see src/lib/google.ts).
const base = require("./app.json");

module.exports = () => {
  const expo = { ...base.expo, plugins: [...base.expo.plugins] };
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  if (iosUrlScheme) expo.plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme }]);
  return { expo };
};
