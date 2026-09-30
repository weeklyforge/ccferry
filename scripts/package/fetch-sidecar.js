#!/usr/bin/env node
// Fetch the agent SDK's native claude(.exe) sidecar for a platform.
// Usage: fetch-sidecar.js <platform> <output-path>
// The host platform's binary is copied from node_modules; anything else is
// pulled from the npm registry tarball (no install side effects).
const { execFileSync } = require('node:child_process');
const { existsSync, copyFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { mkdirSync } = require('node:fs');

const [platform, out] = process.argv.slice(2);
if (!platform || !out) {
  console.error('usage: fetch-sidecar.js <platform> <output-path>');
  process.exit(1);
}

const repo = join(__dirname, '..', '..');
const sdkDir = join(repo, 'packages', 'client', 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
const sdkVersion = require(join(sdkDir, 'package.json')).version;
const binname = platform.startsWith('win32') ? 'claude.exe' : 'claude';
const hostPlatform =
  process.platform === 'win32'
    ? 'win32-x64'
    : process.platform === 'darwin'
      ? process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
      : process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';

mkdirSync(dirname(out), { recursive: true });

if (platform === hostPlatform) {
  // resolve the SDK entry, then walk to its pnpm sibling platform package
  const main = execFileSync(
    process.execPath,
    ['-e', "console.log(require.resolve('@anthropic-ai/claude-agent-sdk'))"],
    { cwd: join(repo, 'packages', 'client'), encoding: 'utf8' },
  ).trim();
  const src = join(dirname(dirname(main)), `claude-agent-sdk-${platform}`, binname);
  if (!existsSync(src)) throw new Error(`host sidecar not found at ${src}`);
  copyFileSync(src, out);
  console.log(`sidecar: copied host binary for ${platform}`);
  process.exit(0);
}

const tarball = execFileSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['view', `@anthropic-ai/claude-agent-sdk-${platform}@${sdkVersion}`, 'dist.tarball'],
  // .cmd shims on Windows are not directly spawnable
  { encoding: 'utf8', shell: process.platform === 'win32' },
).trim();
const tmp = mkdtempSync(join(tmpdir(), 'sidecar-'));
const tgz = join(tmp, 'sidecar.tgz');
console.log(`sidecar: fetching ${platform} from ${tarball}`);
(async () => {
  const res = await fetch(tarball);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  require('node:fs').writeFileSync(tgz, buf);
  const tar = process.platform === 'win32' ? 'tar' : 'tar';
  execFileSync(tar, ['-xzf', tgz, '-C', tmp, 'package'], { stdio: 'inherit' });
  copyFileSync(join(tmp, 'package', binname), out);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`sidecar: wrote ${out}`);
})();
