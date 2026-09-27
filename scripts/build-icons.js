const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(projectRoot, 'assets');
const buildDir = path.join(projectRoot, 'build');
const srcAssetsDir = path.join(projectRoot, 'src', 'assets');
const srcDir = path.join(projectRoot, 'src');

[assetsDir, buildDir, srcAssetsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Candidate source images located within the repository
const candidateSources = [
  path.join(assetsDir, 'icon-source.jpg'),
  path.join(assetsDir, 'icon-source.png'),
  path.join(projectRoot, 'apex_telemetry_icon.jpg'),
  path.join(assetsDir, 'icon.png'),
  path.join(buildDir, 'icon.png')
];

const sourceImage = candidateSources.find(p => fs.existsSync(p));

if (!sourceImage) {
  console.error('No valid icon source image found in repository. Looked for:', candidateSources);
  process.exit(1);
}

console.log(`Building application icons from repository source: ${path.relative(projectRoot, sourceImage)}`);

// Resize into PNG variants using PowerShell System.Drawing
const psScript = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile('${sourceImage.replace(/'/g, "''")}')

function Save-Resized($bmp, $target, $w, $h) {
  $targetBmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($targetBmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($bmp, 0, 0, $w, $h)
  $g.Dispose()
  $targetBmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $targetBmp.Dispose()
  Write-Host "Created: $target"
}

Save-Resized $src '${path.join(buildDir, 'icon.png').replace(/'/g, "''")}' 512 512
Save-Resized $src '${path.join(assetsDir, 'icon.png').replace(/'/g, "''")}' 512 512
Save-Resized $src '${path.join(srcAssetsDir, 'icon.png').replace(/'/g, "''")}' 512 512
Save-Resized $src '${path.join(srcAssetsDir, 'icon-64.png').replace(/'/g, "''")}' 64 64
Save-Resized $src '${path.join(srcAssetsDir, 'icon-32.png').replace(/'/g, "''")}' 32 32
$src.Dispose()
`;

execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { stdio: 'inherit' });

// Generate compliant Windows ICO with standard uncompressed DIBs
console.log('Generating standard Windows DIB ICO...');
const createIcoScript = path.join(__dirname, 'create-standard-ico.ps1');
execFileSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  createIcoScript,
  '-SourcePng',
  path.join(buildDir, 'icon.png'),
  '-OutputIco',
  path.join(buildDir, 'icon.ico')
], { stdio: 'inherit' });

// Synchronize root and src convenience copies
fs.copyFileSync(path.join(buildDir, 'icon.ico'), path.join(projectRoot, 'icon.ico'));
fs.copyFileSync(path.join(buildDir, 'icon.png'), path.join(projectRoot, 'icon.png'));
fs.copyFileSync(path.join(buildDir, 'icon.png'), path.join(projectRoot, 'apex_telemetry_icon.png'));
fs.copyFileSync(path.join(srcAssetsDir, 'icon-64.png'), path.join(srcDir, 'icon-64.png'));
fs.copyFileSync(path.join(srcAssetsDir, 'icon-32.png'), path.join(srcDir, 'icon-32.png'));
fs.copyFileSync(path.join(srcAssetsDir, 'icon.png'), path.join(srcDir, 'icon.png'));
console.log('Successfully built and synchronized all icon assets.');
