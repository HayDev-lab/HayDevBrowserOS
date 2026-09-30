# App icon (badge variant): transparent square + dark disc + white mark.
# Used for icon.ico / icon.png / store logos. Hero+topbar+favicon use the
# pure transparent mark (logo-mark.png) per spec "без фона".
Add-Type -AssemblyName System.Drawing

$mark = [System.Drawing.Image]::FromFile("D:\Projects\BrowserHayDev\electron-app\resources\brand\logo-mark.png")
$size = 880
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# dark disc
$discBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 8, 16, 26))
$g.FillEllipse($discBrush, 6, 6, ($size - 12), ($size - 12))
# teal ring
$ringColor = [System.Drawing.Color]::FromArgb(220, 0, 255, 209)
$ringPen = New-Object System.Drawing.Pen $ringColor, 10
$g.DrawEllipse($ringPen, 8, 8, ($size - 16), ($size - 16))
# white mark inside (80% of the disc)
$inner = [int]($size * 0.78)
$off = [int](($size - $inner) / 2)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($mark, $off, $off, $inner, $inner)

$g.Dispose()
$bmp.Save("D:\Projects\BrowserHayDev\electron-app\resources\brand\icon-badge.png", [System.Drawing.Imaging.ImageFormat]::Png)
foreach ($s in 512, 256, 128, 64, 48, 32, 16) {
  $r2 = New-Object System.Drawing.Bitmap $s, $s
  $g2 = [System.Drawing.Graphics]::FromImage($r2)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g2.DrawImage($bmp, 0, 0, $s, $s)
  $g2.Dispose()
  $r2.Save(("D:\Projects\BrowserHayDev\electron-app\resources\brand\badge-$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $r2.Dispose()
}
$bmp.Dispose(); $mark.Dispose()
Write-Output "badge icon set written"
