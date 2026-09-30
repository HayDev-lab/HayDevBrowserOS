# Make the logo mark background-free: black -> transparent (alpha from
# luminance), then regenerate the full size set + previews.
param(
  [string]$Src = "C:\Users\Admin\Desktop\9cb620b8-eb3f-4183-8af5-93226c080b68.png"
)
Add-Type -AssemblyName System.Drawing

$srcImg = [System.Drawing.Image]::FromFile($Src)
$rect = New-Object System.Drawing.Rectangle(150, 10, 880, 855)
$bmp = New-Object System.Drawing.Bitmap 880, 855
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($srcImg, (New-Object System.Drawing.Rectangle(0, 0, 880, 855)), $rect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$srcImg.Dispose()

# alpha from luminance: black -> transparent, bright art -> opaque
$bd = $bmp.LockBits(
  (New-Object System.Drawing.Rectangle(0, 0, 880, 855)),
  [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$bytes = New-Object byte[] ($bd.Stride * $bd.Height)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
for ($i = 0; $i -lt $bytes.Length; $i += 4) {
  $b = $bytes[$i]; $gg = $bytes[$i + 1]; $r = $bytes[$i + 2]
  $lum = [Math]::Max($r, [Math]::Max($gg, $b))
  $a = [Math]::Max(0, [Math]::Min(255, (($lum - 22) * 255 / 68)))
  $bytes[$i + 3] = [byte]$a
}
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $bd.Scan0, $bytes.Length)
$bmp.UnlockBits($bd)

$bmp.Save("D:\Projects\BrowserHayDev\electron-app\resources\brand\logo-mark.png", [System.Drawing.Imaging.ImageFormat]::Png)
foreach ($s in 512, 256, 128, 64, 48, 32, 16) {
  $r2 = New-Object System.Drawing.Bitmap $s, $s
  $g2 = [System.Drawing.Graphics]::FromImage($r2)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $s, $s)
  $g2.Dispose()
  $r2.Save(("D:\Projects\BrowserHayDev\electron-app\resources\brand\logo-$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $r2.Dispose()
}
$bmp.Dispose()
Write-Output "transparent brand set written"
