// Stage a nightly build for the rolling `nightly` GitHub pre-release.
//   node scripts/release-nightly.cjs <version> <stageDir> ["notes"]
// Renames the installer to a STABLE filename so the updater URL never changes across
// nightlies, and builds latest.json pointing at it. Then publish IN PLACE with:
//   gh release upload nightly <stageDir>/* --clobber --repo contextmirror/voice-mirror
// (Create the `nightly` prerelease once: gh release create nightly --prerelease ...)
// This keeps the public Releases page to ONE rolling nightly entry + the real stable line.
const fs = require('fs');
const path = require('path');

const VERSION = process.argv[2]; // e.g. 0.13.0-nightly.3
const STAGE = process.argv[3] || 'release-nightly';
const NOTES = process.argv[4] || 'Rolling nightly build for dogfooding — the latest fixes from dev.';

const NSIS = 'src-tauri/target/release/bundle/nsis';
const SRC_EXE = path.join(NSIS, `Voice Mirror_${VERSION}_x64-setup.exe`);
const SRC_SIG = SRC_EXE + '.sig';
const STABLE_EXE = 'voice-mirror-nightly-setup.exe'; // constant name → constant download URL

if (!fs.existsSync(SRC_EXE) || !fs.existsSync(SRC_SIG)) {
  console.error('Missing nightly installer or .sig:', SRC_EXE);
  process.exit(1);
}
fs.mkdirSync(STAGE, { recursive: true });
fs.copyFileSync(SRC_EXE, path.join(STAGE, STABLE_EXE));
fs.copyFileSync(SRC_SIG, path.join(STAGE, STABLE_EXE + '.sig'));

const sig = fs.readFileSync(SRC_SIG, 'utf8').trim();
const manifest = {
  version: VERSION,
  notes: NOTES,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: sig,
      url: `https://github.com/contextmirror/voice-mirror/releases/download/nightly/${STABLE_EXE}`,
    },
  },
};
fs.writeFileSync(path.join(STAGE, 'latest.json'), JSON.stringify(manifest, null, 2));
console.log('Staged nightly', VERSION, '→', STAGE);
console.log(fs.readdirSync(STAGE).map((f) => ' - ' + f).join('\n'));
