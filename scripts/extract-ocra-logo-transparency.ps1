param(
  [string]$InputPath = (Join-Path $PSScriptRoot '..\assets\ocra-eireann-logo-2026.png'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\assets\ocra-eireann-logo-2026-transparent-v2.png')
)

Add-Type -AssemblyName System.Drawing

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$source = [System.Drawing.Bitmap]::FromFile($resolvedInput)
$working = [System.Drawing.Bitmap]::new(
  $source.Width,
  $source.Height,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)

$background = [double[]](27, 62, 47)
$targets = @(
  [double[]](243, 242, 236),
  [double[]](255, 255, 255),
  [double[]](15, 123, 63),
  [double[]](244, 82, 11)
)

$minX = $source.Width
$minY = $source.Height
$maxX = -1
$maxY = -1

try {
  for ($y = 0; $y -lt $source.Height; $y++) {
    for ($x = 0; $x -lt $source.Width; $x++) {
      $pixel = $source.GetPixel($x, $y)

      # The supplied backdrop and its faint watermark remain below this range;
      # the anti-aliased logo edge begins above it.
      if ([Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B)) -lt 85) {
        $working.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
        continue
      }

      $observed = [double[]]($pixel.R, $pixel.G, $pixel.B)
      $bestTarget = $null
      $bestAlpha = 0.0
      $bestError = [double]::PositiveInfinity

      foreach ($target in $targets) {
        $dot = 0.0
        $lengthSquared = 0.0
        for ($channel = 0; $channel -lt 3; $channel++) {
          $observedDelta = $observed[$channel] - $background[$channel]
          $targetDelta = $target[$channel] - $background[$channel]
          $dot += $observedDelta * $targetDelta
          $lengthSquared += $targetDelta * $targetDelta
        }

        $alpha = [Math]::Max(0.0, [Math]::Min(1.0, $dot / $lengthSquared))
        $error = 0.0
        for ($channel = 0; $channel -lt 3; $channel++) {
          $predicted = $background[$channel] + $alpha * ($target[$channel] - $background[$channel])
          $difference = $observed[$channel] - $predicted
          $error += $difference * $difference
        }

        if ($error -lt $bestError) {
          $bestError = $error
          $bestAlpha = $alpha
          $bestTarget = $target
        }
      }

      if ($bestAlpha -lt 0.04 -or $bestError -gt 300) {
        $working.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
        continue
      }

      $alphaByte = [Math]::Max(0, [Math]::Min(255, [Math]::Round(255 * $bestAlpha)))
      $colour = [System.Drawing.Color]::FromArgb(
        $alphaByte,
        [int]$bestTarget[0],
        [int]$bestTarget[1],
        [int]$bestTarget[2]
      )
      $working.SetPixel($x, $y, $colour)

      if ($alphaByte -gt 8) {
        $minX = [Math]::Min($minX, $x)
        $minY = [Math]::Min($minY, $y)
        $maxX = [Math]::Max($maxX, $x)
        $maxY = [Math]::Max($maxY, $y)
      }
    }
  }

  if ($maxX -lt $minX -or $maxY -lt $minY) {
    throw 'No foreground logo pixels were found.'
  }

  $padding = 6
  $cropX = [Math]::Max(0, $minX - $padding)
  $cropY = [Math]::Max(0, $minY - $padding)
  $cropRight = [Math]::Min($source.Width - 1, $maxX + $padding)
  $cropBottom = [Math]::Min($source.Height - 1, $maxY + $padding)
  $cropWidth = $cropRight - $cropX + 1
  $cropHeight = $cropBottom - $cropY + 1

  $cropped = [System.Drawing.Bitmap]::new(
    $cropWidth,
    $cropHeight,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($cropped)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $sourceRectangle = [System.Drawing.Rectangle]::new($cropX, $cropY, $cropWidth, $cropHeight)
      $destinationRectangle = [System.Drawing.Rectangle]::new(0, 0, $cropWidth, $cropHeight)
      $graphics.DrawImage($working, $destinationRectangle, $sourceRectangle, [System.Drawing.GraphicsUnit]::Pixel)
    } finally {
      $graphics.Dispose()
    }
    $cropped.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $cropped.Dispose()
  }
} finally {
  $working.Dispose()
  $source.Dispose()
}

$verified = [System.Drawing.Bitmap]::FromFile($resolvedOutput)
try {
  $transparentCorners = @(
    $verified.GetPixel(0, 0).A,
    $verified.GetPixel($verified.Width - 1, 0).A,
    $verified.GetPixel(0, $verified.Height - 1).A,
    $verified.GetPixel($verified.Width - 1, $verified.Height - 1).A
  )
  [pscustomobject]@{
    OutputPath = $resolvedOutput
    Width = $verified.Width
    Height = $verified.Height
    PixelFormat = $verified.PixelFormat
    TransparentCornerAlpha = ($transparentCorners -join ',')
  }
} finally {
  $verified.Dispose()
}
