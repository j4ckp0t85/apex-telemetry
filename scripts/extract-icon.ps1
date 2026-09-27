param(
    [string]$ReleaseDir = "$PSScriptRoot\..\release",
    [string]$OutputDir = "$PSScriptRoot\..\scratch"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

$exePath1 = Join-Path $ReleaseDir 'ApexTelemetry-Portable-1.0.0.exe'
$exePath2 = Join-Path $ReleaseDir 'win-unpacked\Apex Telemetry.exe'

if (Test-Path $exePath1) {
    $ico1 = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath1)
    $bmp1 = $ico1.ToBitmap()
    $outPath1 = Join-Path $OutputDir 'extracted_portable.png'
    $bmp1.Save($outPath1)
    $bmp1.Dispose()
    $ico1.Dispose()
    Write-Host "Extracted portable icon to $outPath1"
}

if (Test-Path $exePath2) {
    $ico2 = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath2)
    $bmp2 = $ico2.ToBitmap()
    $outPath2 = Join-Path $OutputDir 'extracted_unpacked.png'
    $bmp2.Save($outPath2)
    $bmp2.Dispose()
    $ico2.Dispose()
    Write-Host "Extracted unpacked icon to $outPath2"
}
