// Lets Metro bundle the shared contracts package that lives outside this folder.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const shared = path.resolve(__dirname, "../shared");
config.watchFolders = [shared];
config.resolver.extraNodeModules = { "@cm/shared": shared };
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
