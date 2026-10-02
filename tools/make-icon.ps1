Add-Type -AssemblyName System.Drawing

$size = 180
$bitmap = [System.Drawing.Bitmap]::new($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#0a2725'))

$gold = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#c99055'), 3)
$cream = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#e7c99d'), 3)
$graphics.DrawEllipse($gold, 25, 25, 130, 130)
$graphics.DrawBezier($cream, 42, 108, 65, 130, 111, 131, 138, 105)
$graphics.DrawBezier($cream, 39, 70, 66, 46, 111, 45, 143, 71)

$font = [System.Drawing.Font]::new('Georgia', 43, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#f1ddbc'))
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('LC', $font, $brush, [System.Drawing.RectangleF]::new(0, 0, $size, $size + 8), $format)

$output = Join-Path $PSScriptRoot '..\public\apple-touch-icon.png'
$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
$format.Dispose(); $brush.Dispose(); $font.Dispose(); $cream.Dispose(); $gold.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
