# sfx-gen installer for Windows: prebuilt sa3.cpp, the model weights, and the Claude Code plugin.
# Nothing is compiled on your machine.
#
#   irm https://raw.githubusercontent.com/nkapila6/sfx-gen/main/install.ps1 | iex
#
# Env overrides: SA3_VERSION, SA3_HOME, SFX_MODEL (small-sfx | small-music | medium), SFX_ENCODING.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # the progress bar makes Invoke-WebRequest crawl

function Say($m) { Write-Host "$([char]0x276F) " -ForegroundColor Green -NoNewline; Write-Host $m }
function Note($m) { Write-Host "  $m" -ForegroundColor DarkGray }
function Die($m) { Write-Host "x $m" -ForegroundColor Red; throw $m }

# Wrapped in a function so a half-downloaded script never runs.
function Install-SfxGen {
  $ver = if ($env:SA3_VERSION) { $env:SA3_VERSION } else { 'v0.1.3' }
  $sa3Home = if ($env:SA3_HOME) { $env:SA3_HOME } else { Join-Path $HOME '.claude\sa3' }
  $model = if ($env:SFX_MODEL) { $env:SFX_MODEL } else { 'small-sfx' }
  $encoding = if ($env:SFX_ENCODING) { $env:SFX_ENCODING } else { 'q5_k_m' }
  $repo = 'nkapila6/sfx-gen'
  $releases = "https://github.com/betweentwomidnights/sa3.cpp/releases/download/$ver"

  if (-not [Environment]::Is64BitOperatingSystem) { Die 'sa3.cpp only ships 64-bit Windows builds' }
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Die "missing 'claude'. Install Claude Code and run this again" }

  # the mod looks for sa3-generate.exe under <sa3_dir>\build\bin and weights under <sa3_dir>\models
  $bin = Join-Path $sa3Home 'build\bin'
  $exe = Join-Path $bin 'sa3-generate.exe'
  $info = Join-Path $bin 'BUILD-INFO.json'

  if ((Test-Path $exe) -and (Test-Path $info) -and ((Get-Content $info -Raw) -match [regex]::Escape("`"$ver`""))) {
    Say "sa3.cpp $ver already installed"
  } else {
    # core is the CPU build; ggml picks the right CPU variant dll at runtime
    $zip = "sa3-$ver-windows-x64-core.zip"
    Say "downloading sa3.cpp $ver (prebuilt, about 5 MB)"
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("sfx-gen-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$releases/$zip" -OutFile (Join-Path $tmp $zip)
      Invoke-WebRequest -UseBasicParsing -Uri "$releases/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')
      $want = (Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { $_ -match " $([regex]::Escape($zip))$" }) -split '\s+' | Select-Object -First 1
      $got = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $zip)).Hash
      if (-not $want -or $got -ne $want.ToUpper()) { Die "checksum mismatch on $zip, not installing it" }
      if (Test-Path $bin) { Remove-Item -Recurse -Force $bin }
      New-Item -ItemType Directory -Force -Path $bin | Out-Null
      Expand-Archive -Path (Join-Path $tmp $zip) -DestinationPath $bin -Force
      Note "verified and unpacked to $bin"
    } finally {
      Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
  }

  # The Windows zip has no models script, so mirror what models.sh fetches.
  $size, $same = if ($model -eq 'medium') { '1.5B', 'same-l' } else { '0.5B', 'same-s' }
  $enc = $encoding.ToUpper()
  $base = "stable-audio-3-$model"
  $files = @(
    @("thepatch/$base-GGUF", "$base-dit-$size-v1.0-$enc.gguf"),
    @("thepatch/$base-GGUF", "$base-$same-v1.0-$enc.gguf"),
    @("thepatch/$base-GGUF", "$base-conditioner-v1.0-F32.gguf"),
    @('thepatch/t5gemma-b-b-ul2-GGUF', 't5gemma-b-b-ul2-encoder-0.3B-v1.0-F16.gguf'),
    @('thepatch/t5gemma-b-b-ul2-GGUF', 't5gemma-b-b-ul2-v1.0-vocab.gguf')
  )
  $models = Join-Path $sa3Home 'models'
  New-Item -ItemType Directory -Force -Path $models | Out-Null
  Say "fetching $model weights ($encoding). About 1 GB the first time, skipped after"
  foreach ($f in $files) {
    $dst = Join-Path $models $f[1]
    if (Test-Path $dst) { Note "[skip] $($f[1])"; continue }
    Note "[download] $($f[1])"
    $part = "$dst.part"
    # curl.exe ships with Windows 10+ and can resume, unlike Invoke-WebRequest
    & curl.exe -fL --retry 3 --continue-at - -o $part "https://huggingface.co/$($f[0])/resolve/main/$($f[1])"
    if ($LASTEXITCODE -ne 0) { Die "download failed: $($f[1])" }
    Move-Item -Force $part $dst
  }

  Say 'smoke test: generating a 1s clip'
  $probe = Join-Path ([IO.Path]::GetTempPath()) 'sfx-gen-probe.wav'
  & $exe --model $model --encoding $encoding --models-dir $models --prompt 'a short click' --duration 1 --out $probe *> $null
  if ($LASTEXITCODE -ne 0) { Die "sa3-generate failed. Run it by hand to see why: $exe --help" }
  Remove-Item -Force $probe -ErrorAction SilentlyContinue
  Note 'ok'

  Say 'installing the sfx-gen plugin'
  claude plugin marketplace add $repo *> $null
  if ($LASTEXITCODE -ne 0) { claude plugin marketplace update sfx-gen *> $null }
  $sa3Dir = $sa3Home -replace '\\', '/'
  if ((claude plugin list 2>$null) -match 'sfx-gen@sfx-gen') {
    claude plugin update sfx-gen@sfx-gen *> $null
    "{`"sa3_dir`":`"$sa3Dir`",`"model`":`"$model`",`"encoding`":`"$encoding`"}" | claude plugin configure sfx-gen@sfx-gen --values-stdin *> $null
  } else {
    claude plugin install sfx-gen@sfx-gen --config "sa3_dir=$sa3Dir" --config "model=$model" --config "encoding=$encoding" *> $null
  }
  if ($LASTEXITCODE -ne 0) { Die 'claude plugin install failed. Try: claude plugin install sfx-gen@sfx-gen' }

  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Note 'optional: winget install ffmpeg for the mp3 share button' }
  Write-Host ''
  Say 'done. Start a new claude session and try:'
  Note '/sfx a whoosh across the screen'
  Note '/sfx-notify error a blood-curdling scream'
}

Install-SfxGen
