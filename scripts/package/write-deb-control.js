#!/usr/bin/env node
// Write the dpkg control file for a staged package.
// Usage: write-deb-control.js <product> <deb-arch> <version> <DEBIAN-dir>
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [product, arch, version, debianDir] = process.argv.slice(2);
if (!product || !arch || !version || !debianDir) {
  console.error('usage: write-deb-control.js <product> <deb-arch> <version> <DEBIAN-dir>');
  process.exit(1);
}

writeFileSync(
  join(debianDir, 'control'),
  `Package: ccferry-${product}
Version: ${version}
Section: net
Priority: optional
Architecture: ${arch}
${product === 'cloud' ? 'Depends: systemd\n' : ''}Maintainer: ccferry owner <fetao@localhost>
Description: ccferry ${product} (single-package build)
 Bun-compiled ccferry ${product} binary. See docs/deploy-daemon.md.
`,
);
console.log(`wrote ${join(debianDir, 'control')}`);
