#!/usr/bin/env node
/*
 * Settle - .zxp builder
 * Crit Studio
 *
 * Produces a signed Settle_0.2.2.zxp that installs through the aescripts ZXP
 * Installer or Anastasiy's Extension Manager on both macOS and Windows, with no
 * debug flag needed on the user's machine.
 *
 * Adobe's ZXPSignCmd only ships as a macOS and a Windows binary, so this has to
 * run on one of those two. It cannot run on Linux.
 *
 *   npm install zxp-sign-cmd
 *   node build-zxp.js
 *
 * The certificate it generates is self-signed. Installers accept it and warn
 * that the publisher is unverified, which is how most independent panels ship
 * before anyone buys a commercial code-signing certificate. Buy one later and
 * point CERT_PATH at it; nothing else here changes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Required lazily, after the platform and path checks below. A top-level
// require throws first if the dependency is missing, and buries the real
// problem under a module-resolution stack trace.
let zxp;

const ROOT = __dirname;
const SRC = path.join(ROOT, 'settle');
const OUT_DIR = path.join(ROOT, 'dist');
const STAGE = path.join(os.tmpdir(), 'settle-stage-' + Date.now());

const VERSION = '0.2.2';
const OUTPUT = path.join(OUT_DIR, `Settle_${VERSION}.zxp`);
const CERT_PATH = path.join(ROOT, 'cert.p12');
const CERT_PASSWORD = process.env.SETTLE_CERT_PASSWORD;

// Certificate metadata is safe to publish. The password is deliberately read
// from the environment so it never enters source control.
const CERT = {
  country: 'IN',
  province: 'Telangana',
  locality: 'Hyderabad',
  org: 'Crit Studio',
  orgUnit: 'Tools',
  name: 'Crit Studio',
  password: CERT_PASSWORD,
  validityDays: 3650,
  output: CERT_PATH
};

// Files that belong in the repo but not in a release build.
const EXCLUDE = new Set([
  '.debug', 'test_host.js', 'test_physics.js',
  'node_modules', '.DS_Store', '.git'
]);

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function fail(msg) {
  console.error('\n  ' + msg + '\n');
  process.exit(1);
}

(async () => {
  console.log(`\n  Settle ${VERSION} - zxp builder\n  ------------------------------\n`);

  if (process.platform === 'linux') {
    fail('ZXPSignCmd has no Linux build. Run this on macOS or Windows.');
  }
  if (!fs.existsSync(path.join(SRC, 'CSXS', 'manifest.xml'))) {
    fail(`No CSXS/manifest.xml under ${SRC}. Keep build-zxp.js next to the settle folder.`);
  }
  if (!CERT_PASSWORD) {
    fail('Set SETTLE_CERT_PASSWORD before building. Never commit the password or cert.p12.');
  }

  try {
    zxp = require('zxp-sign-cmd');
  } catch (e) {
    fail('Missing dependency. Run this first, in this folder:\n\n    npm install\n');
  }

  // The .debug file must not survive into a signed build. Leaving it in makes
  // the panel behave as a development extension on machines that install it.
  copyTree(SRC, STAGE);
  console.log('  Staged a clean copy without .debug or test files.');

  if (!fs.existsSync(CERT_PATH)) {
    console.log('  Generating a self-signed certificate...');
    await zxp.selfSignedCert(CERT);
    console.log(`  Wrote ${path.basename(CERT_PATH)}. Keep it. Reusing the same`);
    console.log('  certificate is what lets users update in place rather than');
    console.log('  uninstalling first.');
  } else {
    console.log('  Reusing the existing cert.p12.');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);

  console.log('  Signing...');
  try {
    await zxp.sign({
      input: STAGE,
      output: OUTPUT,
      cert: CERT_PATH,
      password: CERT_PASSWORD,
      // A timestamp keeps the package valid after the certificate expires.
      timestamp: 'http://timestamp.digicert.com'
    });
  } catch (err) {
    console.error('\n  Signing failed:\n');
    console.error(err.message || err);
    console.error('\n  If the timestamp server is unreachable, remove the');
    console.error('  timestamp line above and sign again. The package will work,');
    console.error('  but stops validating once the certificate expires.\n');
    process.exit(1);
  }

  const verify = await zxp.verify({ input: OUTPUT, info: true, skipChecks: true });
  const kb = (fs.statSync(OUTPUT).size / 1024).toFixed(0);

  fs.rmSync(STAGE, { recursive: true, force: true });

  console.log(`\n  Built ${path.relative(ROOT, OUTPUT)}  (${kb} KB)\n`);
  console.log(verify.trim().split('\n').map(l => '  ' + l).join('\n'));
  console.log('\n  Install it with the aescripts ZXP Installer or Anastasiy\'s');
  console.log('  Extension Manager. Both run on macOS and Windows and neither');
  console.log('  needs the CEP debug flag.\n');
})();
