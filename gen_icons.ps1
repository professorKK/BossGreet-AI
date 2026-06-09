Add-Type -AssemblyName System.Drawing

function Resize-Icon {
    param([string]$src, [int]$size, [string]$path)

    $img = [System.Drawing.Image]::FromFile($src)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $img.Dispose()
    Write-Host "Created $path ($size x $size)"
}

$src = "d:/shareKK/bossAI/zhaoPin.png"
Resize-Icon -src $src -size 16  -path "d:/shareKK/bossAI/icons/icon16.png"
Resize-Icon -src $src -size 48  -path "d:/shareKK/bossAI/icons/icon48.png"
Resize-Icon -src $src -size 128 -path "d:/shareKK/bossAI/icons/icon128.png"
Write-Host "All icons updated from zhaoPin.png!"
