# Draws the Sweep icons with System.Drawing. Rerun after a theme change:
#   pwsh icons/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$dir = $PSScriptRoot

function Draw-Icon([int]$size, [string]$path, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 512.0

  $fog = [System.Drawing.Color]::FromArgb(35, 42, 51)     # #232a33
  $fog2 = [System.Drawing.Color]::FromArgb(40, 48, 58)    # #28303a
  $paper = [System.Drawing.Color]::FromArgb(239, 230, 208) # #efe6d0
  $ink = [System.Drawing.Color]::FromArgb(51, 86, 143)    # digit blue
  $red = [System.Drawing.Color]::FromArgb(201, 64, 46)    # flag
  $pole = [System.Drawing.Color]::FromArgb(74, 63, 45)

  $g.Clear($fog)
  # fog checker grain
  $b2 = New-Object System.Drawing.SolidBrush($fog2)
  $cell = 64 * $s
  for ($y = 0; $y -lt 8; $y++) { for ($x = 0; $x -lt 8; $x++) {
    if ((($x + $y) % 2) -eq 1) { $g.FillRectangle($b2, [float]($x * $cell), [float]($y * $cell), [float]$cell, [float]$cell) }
  } }

  # revealed paper patch: a 3x3-ish swept clearing, offset to lower-left
  # maskable keeps everything inside the 80% safe zone
  $inset = if ($maskable) { 90 * $s } else { 40 * $s }
  $pb = New-Object System.Drawing.SolidBrush($paper)
  $patch = @(
    @(1,1),@(2,1),@(3,1),
    @(1,2),@(2,2),@(3,2),@(4,2),
    @(1,3),@(2,3),@(3,3),@(4,3),
    @(2,4),@(3,4)
  )
  $u = (512 - 2 * ($inset / $s)) / 6 * $s   # patch grid unit
  $ox = $inset; $oy = $inset
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(46, 90, 78, 54), [float](2 * $s))
  foreach ($c in $patch) {
    $px = $ox + $c[0] * $u; $py = $oy + $c[1] * $u
    $g.FillRectangle($pb, [float]$px, [float]$py, [float]($u + 1), [float]($u + 1))
    $g.DrawRectangle($pen, [float]$px, [float]$py, [float]$u, [float]$u)
  }
  # a "1" digit on one revealed cell
  $font = New-Object System.Drawing.Font('Georgia', [float]($u * 0.62 / $s * $s), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $ib = New-Object System.Drawing.SolidBrush($ink)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $g.DrawString('1', $font, $ib, (New-Object System.Drawing.RectangleF([float]($ox + 1 * $u), [float]($oy + 2 * $u), [float]$u, [float]$u)), $fmt)
  $g.DrawString('2', $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(59, 122, 72))), (New-Object System.Drawing.RectangleF([float]($ox + 3 * $u), [float]($oy + 3 * $u), [float]$u, [float]$u)), $fmt)

  # flag on a covered cell, upper right of the patch
  $fx = $ox + 4.35 * $u; $fy = $oy + 0.4 * $u
  $poleW = [float](7 * $s * ($u / (72 * $s)))
  $pp = New-Object System.Drawing.Pen($pole, [float]($u * 0.09))
  $g.DrawLine($pp, [float]($fx), [float]($fy + 1.15 * $u), [float]($fx), [float]($fy))
  $rb = New-Object System.Drawing.SolidBrush($red)
  $tri = @(
    (New-Object System.Drawing.PointF([float]$fx, [float]$fy)),
    (New-Object System.Drawing.PointF([float]($fx + 0.85 * $u), [float]($fy + 0.28 * $u))),
    (New-Object System.Drawing.PointF([float]$fx, [float]($fy + 0.56 * $u)))
  )
  $g.FillPolygon($rb, $tri)

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $path"
}

Draw-Icon 192 (Join-Path $dir 'icon-192.png') $false
Draw-Icon 512 (Join-Path $dir 'icon-512.png') $false
Draw-Icon 512 (Join-Path $dir 'icon-512-maskable.png') $true
Draw-Icon 180 (Join-Path $dir 'apple-touch-icon.png') $false
