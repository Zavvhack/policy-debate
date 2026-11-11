// Gathers the installers Tauri built into one folder with clear, space-free names.
//
//   node scripts/collect-artifacts.mjs <platform> [bundle-dir] [out-dir]
//
// platform is linux, windows or macos. Used by the release workflow; you can
// also run it after `npm run tauri build` to find your installers quickly.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [platform, bundleDirArg, outArg] = process.argv.slice(2);
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const out = outArg ?? 'release';
mkdirSync(out, { recursive: true });

function findBundleDir() {
  if (bundleDirArg) return bundleDirArg;
  // A plain build puts bundles in target/release/bundle; a cross-target build in target/<triple>/release/bundle.
  const target = 'src-tauri/target';
  const candidates = [join(target, 'release', 'bundle')];
  for (const name of existsSync(target) ? readdirSync(target) : []) candidates.push(join(target, name, 'release', 'bundle'));
  const found = candidates.filter((c) => existsSync(c));
  if (!found.length) throw new Error('No bundle folder found. Run `npm run tauri build` first.');
  // Prefer the most recently written one.
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** Every file under a folder (one level of sub-folders is enough for Tauri's layout). */
function filesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      for (const inner of readdirSync(full)) if (statSync(join(full, inner)).isFile()) out.push(join(full, inner));
    } else out.push(full);
  }
  return out;
}

const RULES = {
  linux: [
    [/\.AppImage$/, `policy-debate_${version}_linux_x86_64.AppImage`],
    [/\.deb$/, `policy-debate_${version}_linux_amd64.deb`],
    [/\.rpm$/, `policy-debate_${version}_linux_x86_64.rpm`],
  ],
  windows: [
    [/-setup\.exe$/, `policy-debate_${version}_windows_x64-setup.exe`],
    [/\.msi$/, `policy-debate_${version}_windows_x64.msi`],
  ],
  macos: [[/\.dmg$/, `policy-debate_${version}_macos_universal.dmg`]],
};

const rules = RULES[platform];
if (!rules) throw new Error('Usage: node scripts/collect-artifacts.mjs <linux|windows|macos> [bundle-dir] [out-dir]');
const bundleDir = findBundleDir();
const files = filesIn(bundleDir);
const missing = [];
for (const [pattern, name] of rules) {
  const hit = files.find((f) => pattern.test(f));
  if (!hit) {
    missing.push(String(pattern));
    continue;
  }
  copyFileSync(hit, join(out, name));
  console.log(`${name}  (${(statSync(hit).size / 1024 / 1024).toFixed(1)} MB)  <-  ${hit}`);
}
if (missing.length) {
  console.error(`Expected installers were not found in ${bundleDir}: ${missing.join(', ')}`);
  process.exit(1);
}
