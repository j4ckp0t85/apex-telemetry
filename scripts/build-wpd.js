const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
if (process.platform === 'win32') {
  const root = path.join(__dirname, '..');
  const output = path.join(root, 'native', 'bin');
  fs.mkdirSync(output, { recursive: true });
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const result = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+',
    '/reference:System.Web.Extensions.dll', `/out:${path.join(output, 'WpdReader.exe')}`, path.join(root, 'native', 'WpdReader.cs')],
  { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status;
}
