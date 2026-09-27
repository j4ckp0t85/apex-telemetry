const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const targets = [
  path.join(root, 'release'),
  path.join(root, 'native', 'bin')
];

for (const target of targets) {
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      console.log(`Removed: ${path.relative(root, target)}`);
    }
  } catch (err) {
    console.error(`Failed to remove ${target}:`, err.message);
    process.exitCode = 1;
  }
}
