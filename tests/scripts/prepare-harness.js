const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = path.resolve(root, '../../webrtc-client-sdk/dist');
const vendorDir = path.join(root, 'harness', 'vendor');

if (!fs.existsSync(path.join(distDir, 'exotelsdk.js'))) {
  console.error(
    '[parity] Missing SDK bundle at webrtc-client-sdk/dist/exotelsdk.js\n' +
      '         Run: cd webrtc-client-sdk && npm install && npm run build'
  );
  process.exit(1);
}

fs.mkdirSync(vendorDir, { recursive: true });

for (const name of fs.readdirSync(distDir)) {
  const src = path.join(distDir, name);
  if (!fs.statSync(src).isFile()) continue;
  fs.copyFileSync(src, path.join(vendorDir, name));
}

console.log('[parity] Copied SDK dist → harness/vendor/');
