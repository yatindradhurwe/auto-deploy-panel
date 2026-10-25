#!/usr/bin/env bash
# Installs Expo and the React Native packages this app uses, at the versions its Expo SDK ships with
# (expo/bundledNativeModules.json). Plain npm installs: `expo install` can move its own CLI while running.
set -euo pipefail
cd "$(dirname "$0")/.."
export CI=1
npm install --no-audit --no-fund --loglevel=error
node -e '
  const fs = require("fs")
  const versions = require("expo/bundledNativeModules.json")
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  for (const name of require("./autodeploy.config.json").nativePackages) {
    if (!versions[name]) throw new Error(name + " is not part of this Expo SDK")
    pkg.dependencies[name] = versions[name]
  }
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
'
npm install --no-audit --no-fund --loglevel=error
