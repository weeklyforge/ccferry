# ccferry app icon generator (GDI+, no external deps).
# Renders three launcher-icon concepts at 1024x1024 plus Android adaptive
# layers (foreground glyph on transparent, background gradient full-bleed).
# Usage: pwsh -File scripts/icon-gen.ps1 [-OutDir <dir>]
param(
  [string]$OutDir = "apps/mobile/design/icon-concepts"
)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, 2*$r, 2*$r, 180, 90)
  $p.AddArc($x + $w - 2*$r, $y, 2*$r, 2*$r, 270, 90)
  $p.AddArc($x + $w - 2*$r, $y + $h - 2*$r, 2*$r, 2*$r, 0, 90)
  $p.AddArc($x, $y + $h - 2*$r, 2*$r, 2*$r, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-GradientBrush([string]$hex1, [string]$hex2) {
  $rect = New-Object System.Drawing.Rectangle(0, 0, 1024, 1024)
  $c1 = [System.Drawing.ColorTranslator]::FromHtml($hex1)
  $c2 = [System.Drawing.ColorTranslator]::FromHtml($hex2)
  return New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 65)
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $path"
}

# ---- shared geometry ----------------------------------------------------

# Classic origami paper boat, front view. Points are in a 1024-box.
$sailBig   = @([System.Drawing.PointF]::new(512,268), [System.Drawing.PointF]::new(292,646), [System.Drawing.PointF]::new(732,646))
$sailInner = @([System.Drawing.PointF]::new(512,408), [System.Drawing.PointF]::new(404,646), [System.Drawing.PointF]::new(620,646))
$hull      = @([System.Drawing.PointF]::new(232,668), [System.Drawing.PointF]::new(792,668), [System.Drawing.PointF]::new(688,806), [System.Drawing.PointF]::new(336,806))

function Draw-Boat([System.Drawing.Graphics]$g) {
  # waves behind the hull
  $wavePen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#7DD3FC')), 22
  $wavePen.StartCap = 'Round'; $wavePen.EndCap = 'Round'
  $g.DrawArc($wavePen, 262, 760, 240, 150, 200, 110)
  $g.DrawArc($wavePen, 540, 772, 230, 150, 205, 105)
  # hull + sails
  $white = [System.Drawing.Brushes]::White
  $fold  = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#C7D7F0'))
  $g.FillPolygon($white, $hull)
  $g.FillPolygon($white, $sailBig)
  $g.FillPolygon($fold, $sailInner)
  $wavePen.Dispose(); $fold.Dispose()
}

# ---- concept A: paper boat on sky gradient ------------------------------

$bmp = New-Object System.Drawing.Bitmap(1024, 1024)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.FillRectangle((New-GradientBrush '#0EA5E9' '#1D4ED8'), 0, 0, 1024, 1024)
Draw-Boat $g
$g.Dispose()
Save-Png $bmp "$OutDir/icon-a-boat.png"

# ---- concept B: terminal hex --------------------------------------------

$bmp = New-Object System.Drawing.Bitmap(1024, 1024)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.FillRectangle((New-GradientBrush '#0B1220' '#16233B'), 0, 0, 1024, 1024)
# hexagon (pointy-top), centered
$hex = New-Object System.Drawing.Drawing2D.GraphicsPath
$cx = 512.0; $cy = 512.0; $R = 330.0
$pts = @()
foreach ($deg in 270, 330, 30, 90, 150, 210) {
  $rad = $deg * [math]::PI / 180
  $pts += [System.Drawing.PointF]::new($cx + $R * [math]::Cos($rad), $cy + $R * [math]::Sin($rad))
}
$hexPolygon = $pts
$hexBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#1E293B'))
$hexPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#38BDF8')), 26
$g.FillPolygon($hexBrush, $hexPolygon)
$g.DrawPolygon($hexPen, $hexPolygon)
# prompt glyph >_ drawn as explicit segments (DrawLines binds unreliably via PS interop)
$glyphPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White), 52
$glyphPen.StartCap = 'Round'; $glyphPen.EndCap = 'Round'; $glyphPen.LineJoin = 'Round'
$g.DrawLine($glyphPen, 426, 396, 566, 532)
$g.DrawLine($glyphPen, 566, 532, 426, 668)
$g.DrawLine($glyphPen, 612, 668, 716, 668)
$glyphPen.Dispose()
$g.Dispose()
Save-Png $bmp "$OutDir/icon-b-hex.png"

# ---- concept C: lifebuoy over waves --------------------------------------

$bmp = New-Object System.Drawing.Bitmap(1024, 1024)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.FillRectangle((New-GradientBrush '#2563EB' '#7C3AED'), 0, 0, 1024, 1024)
# white ring
$buoyPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White), 96
$g.DrawEllipse($buoyPen, 512 - 250, 512 - 250 - 40, 500, 500)
# four rope notches in the gradient color at N/E/S/W
$notchPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#5B54D6')), 96
foreach ($deg in 0, 90, 180, 270) {
  $rad = $deg * [math]::PI / 180
  $cxn = 512 + 250 * [math]::Cos($rad)
  $cyn = 472 + 250 * [math]::Sin($rad)
  $g.DrawLine($notchPen, [float]($cxn - 40 * [math]::Sin($rad)), [float]($cyn + 40 * [math]::Cos($rad)), [float]($cxn + 40 * [math]::Sin($rad)), [float]($cyn - 40 * [math]::Cos($rad)))
}
$notchPen.Dispose(); $buoyPen.Dispose()
# waterline
$wavePen3 = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#A5F3FC')), 40
$wavePen3.StartCap = 'Round'; $wavePen3.EndCap = 'Round'
$g.DrawArc($wavePen3, 292, 800, 260, 170, 195, 115)
$g.DrawArc($wavePen3, 556, 810, 250, 170, 200, 110)
$wavePen3.Dispose()
$g.Dispose()
Save-Png $bmp "$OutDir/icon-c-buoy.png"

# ---- adaptive layers for concept A (the default pick) -------------------

# background: the same gradient, full bleed
$bmp = New-Object System.Drawing.Bitmap(1024, 1024)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.FillRectangle((New-GradientBrush '#0EA5E9' '#1D4ED8'), 0, 0, 1024, 1024)
$g.Dispose()
Save-Png $bmp "$OutDir/adaptive-bg.png"

# foreground: boat scaled to ~62% inside the safe zone, transparent margins
$fg = New-Object System.Drawing.Bitmap(1024, 1024)
$g = [System.Drawing.Graphics]::FromImage($fg)
$g.SmoothingMode = 'AntiAlias'
$scale = 0.62
$g.TranslateTransform(512, 512)
$g.ScaleTransform($scale, $scale)
$g.TranslateTransform(-512, -512)
Draw-Boat $g
$g.ResetTransform()
$g.Dispose()
Save-Png $fg "$OutDir/adaptive-fg.png"

Write-Host "done -> $OutDir"
