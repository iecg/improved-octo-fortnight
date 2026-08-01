// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole workspace so edits to packages/* trigger a reload.
config.watchFolders = [workspaceRoot];

// 2. Resolve from the app first, then the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Hierarchical lookup stays ON, unlike the snippet in Expo's monorepo
//    guide. That guide targets pnpm/yarn, where every dependency is a direct
//    symlink; npm workspaces instead hoist most packages to the root but leave
//    version-conflicting ones nested (expo keeps its own @expo/metro-config,
//    for instance). Disabling the walk-up makes those nested transitive
//    dependencies unresolvable — expo-asset, reached via expo itself, fails
//    first. The duplicate-React risk it guards against does not apply here
//    because npm hoists a single react to the workspace root.

module.exports = withNativeWind(config, { input: './global.css' });
