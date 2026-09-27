param(
    [string]$SourcePng = "$PSScriptRoot\..\build\icon.png",
    [string]$OutputIco = "$PSScriptRoot\..\build\icon.ico"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $SourcePng)) {
    Write-Error "Source PNG not found: $SourcePng"
    exit 1
}

$src = [System.Drawing.Bitmap]::FromFile($SourcePng)
$sizes = @(16, 24, 32, 48, 64, 256)
$entries = @()

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $size, $size)
    $g.Dispose()

    if ($size -eq 256) {
        # 256x256 is stored as PNG
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $data = $ms.ToArray()
        $ms.Dispose()
    } else {
        # Sizes <= 64 are stored as standard uncompressed Windows DIB (BMP format)
        $ms = New-Object System.IO.MemoryStream
        $bw = New-Object System.IO.BinaryWriter($ms)

        $andRowBytes = [Math]::Ceiling($size / 32.0) * 4
        $andMaskSize = $andRowBytes * $size
        $xorSize = $size * $size * 4
        $imageSize = 40 + $xorSize + $andMaskSize

        # BITMAPINFOHEADER (40 bytes)
        $bw.Write([uint32]40)              # biSize
        $bw.Write([int32]$size)             # biWidth
        $bw.Write([int32]($size * 2))       # biHeight (doubled for XOR + AND)
        $bw.Write([uint16]1)                # biPlanes
        $bw.Write([uint16]32)               # biBitCount (32bpp BGRA)
        $bw.Write([uint32]0)                # biCompression (BI_RGB)
        $bw.Write([uint32]($xorSize + $andMaskSize)) # biSizeImage
        $bw.Write([int32]0)                 # biXPelsPerMeter
        $bw.Write([int32]0)                 # biYPelsPerMeter
        $bw.Write([uint32]0)                # biClrUsed
        $bw.Write([uint32]0)                # biClrImportant

        # Lock bits to read BGRA bottom-to-top
        $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
        $dataLock = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $stride = [Math]::Abs($dataLock.Stride)
        $pixelBuffer = New-Object byte[] ($stride * $size)
        [System.Runtime.InteropServices.Marshal]::Copy($dataLock.Scan0, $pixelBuffer, 0, $pixelBuffer.Length)
        $bmp.UnlockBits($dataLock)

        # Write rows bottom to top (standard BMP order)
        for ($y = $size - 1; $y -ge 0; $y--) {
            $rowOffset = $y * $stride
            $bw.Write($pixelBuffer, $rowOffset, ($size * 4))
        }

        # Write 1-bit AND mask (all zeroes for 32bpp alpha)
        $andMask = New-Object byte[] $andMaskSize
        $bw.Write($andMask)

        $data = $ms.ToArray()
        $bw.Dispose()
        $ms.Dispose()
    }
    $bmp.Dispose()

    $entries += [PSCustomObject]@{
        Width = $size
        Height = $size
        Data = $data
    }
}
$src.Dispose()

# Build final ICO file
$finalMs = New-Object System.IO.MemoryStream
$finalBw = New-Object System.IO.BinaryWriter($finalMs)

# ICO header
$finalBw.Write([uint16]0)
$finalBw.Write([uint16]1) # 1 = Icon
$finalBw.Write([uint16]$entries.Count)

$offset = 6 + ($entries.Count * 16)
foreach ($e in $entries) {
    $w = if ($e.Width -ge 256) { 0 } else { [byte]$e.Width }
    $h = if ($e.Height -ge 256) { 0 } else { [byte]$e.Height }
    $finalBw.Write([byte]$w)
    $finalBw.Write([byte]$h)
    $finalBw.Write([byte]0)   # Colors
    $finalBw.Write([byte]0)   # Reserved
    $finalBw.Write([uint16]1) # Planes
    $finalBw.Write([uint16]32)# Bpp
    $finalBw.Write([uint32]$e.Data.Length)
    $finalBw.Write([uint32]$offset)
    $offset += $e.Data.Length
}

foreach ($e in $entries) {
    $finalBw.Write($e.Data)
}

[System.IO.File]::WriteAllBytes($OutputIco, $finalMs.ToArray())
$finalBw.Dispose()
$finalMs.Dispose()

Write-Host "Standard Windows DIB ICO generated at $OutputIco"
