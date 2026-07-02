// Stage a Voice Mirror release for GitHub: rename the NSIS installer + .sig to a
// space-free name (predictable download URL) and build latest.json for the updater.
//   node scripts/make-release.cjs <version> <stageDir> ["release notes"]
const fs = require('fs');
const path = require('path');

const VERSION = process.argv[2] || '0.12.0';
const STAGE = process.argv[3] || `release-${VERSION}`;
const NOTES =
  process.argv[4] ||
  'First auto-updating build. Adds the in-app updater, the console-flicker fix, fully-wired title-bar menus + Command Palette, the Get-Started tutorial, and stability fixes.';

const NSIS = 'src-tauri/target/release/bundle/nsis';
const SRC_EXE = path.join(NSIS, `Voice Mirror_${VERSION}_x64-setup.exe`);
const SRC_SIG = SRC_EXE + '.sig';
const CLEAN_EXE = `voice-mirror_${VERSION}_x64-setup.exe`;

if (!fs.existsSync(SRC_EXE) || !fs.existsSync(SRC_SIG)) {
  console.error('Missing installer or .sig:', SRC_EXE);
  process.exit(1);
}

fs.mkdirSync(STAGE, { recursive: true });
fs.copyFileSync(SRC_EXE, path.join(STAGE, CLEAN_EXE));
fs.copyFileSync(SRC_SIG, path.join(STAGE, CLEAN_EXE + '.sig'));

const sig = fs.readFileSync(SRC_SIG, 'utf8').trim();
const manifest = {
  version: VERSION,
  notes: NOTES,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: sig,
      url: `https://github.com/contextmirror/voice-mirror/releases/download/v${VERSION}/${CLEAN_EXE}`,
    },
  },
};
fs.writeFileSync(path.join(STAGE, 'latest.json'), JSON.stringify(manifest, null, 2));

console.log('Staged release v' + VERSION + ' →', STAGE);
console.log(fs.readdirSync(STAGE).map((f) => ' - ' + f).join('\n'));
