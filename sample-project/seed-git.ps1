# seed-git.ps1
# Rebuilds the git histories behind the two ReleaseGuard sample repos and the
# PR diff files consumed by the /api/presets endpoint. Idempotent: re-running
# wipes .git and starts over.
#
# The working tree on disk holds the FINAL (main-branch) state of every file.
# The script writes temporary "v1" variants, commits them as backdated history,
# then restores the finals. Every commit carries an explicit author + date so
# the ownership check sees: Marcus Lee (flawed) last touched pricing 18 months
# ago and has no commits in the last year, while recent work belongs to Priya.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File sample-project\seed-git.ps1

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$flawed = Join-Path $root 'flawed'
$clean = Join-Path $root 'clean'
$diffs = Join-Path $root 'diffs'

function Read-Utf8([string]$p) { [System.IO.File]::ReadAllText($p) }
function Write-Utf8([string]$p, [string]$t) { [System.IO.File]::WriteAllText($p, $t, $utf8) }
function Eol([string]$text) { if ($text.Contains("`r`n")) { "`r`n" } else { "`n" } }

function Invoke-Git([string]$repo, [string[]]$argv) {
  Push-Location $repo
  try {
    & git @argv
    if ($LASTEXITCODE -ne 0) { throw "git $($argv -join ' ') failed in $repo" }
  } finally { Pop-Location }
}

function Commit-As([string]$repo, [string]$name, [string]$email, [string]$date, [string]$message, [string[]]$paths) {
  $env:GIT_AUTHOR_NAME = $name
  $env:GIT_AUTHOR_EMAIL = $email
  $env:GIT_COMMITTER_NAME = $name
  $env:GIT_COMMITTER_EMAIL = $email
  $env:GIT_AUTHOR_DATE = $date
  $env:GIT_COMMITTER_DATE = $date
  Invoke-Git $repo (@('add', '--') + $paths)
  Invoke-Git $repo @('commit', '-q', '-m', $message)
}

function Init-Repo([string]$repo) {
  $gitDir = Join-Path $repo '.git'
  if (Test-Path $gitDir) { Remove-Item -Recurse -Force $gitDir }
  Invoke-Git $repo @('init', '-q', '-b', 'main')
  Invoke-Git $repo @('config', 'core.autocrlf', 'false')
  Invoke-Git $repo @('config', 'commit.gpgsign', 'false')
}

# Insert a line right after the first line containing $needle.
function Insert-LineAfter([string]$text, [string]$needle, [string]$line, [string]$what) {
  $a = $text.IndexOf($needle)
  if ($a -lt 0) { throw "${what}: anchor '$needle' not found" }
  $n = $text.IndexOf("`n", $a)
  if ($n -lt 0) { throw "${what}: no newline after anchor" }
  $e = Eol $text
  return $text.Substring(0, $n + 1) + $line + $e + $text.Substring($n + 1)
}

# ---------------------------------------------------------------------------
# Flawed sample: stale owner, no tests for the touched modules, docs that lie,
# and a PR that silently turns formatMoney's number into a string.
# ---------------------------------------------------------------------------
Init-Repo $flawed

# v1 of format.js: no JSDoc, no input guard (the "Marcus Lee era" version).
$fmtPath = Join-Path $flawed 'src\format.js'
$fmtFinal = Read-Utf8 $fmtPath
$i = $fmtFinal.IndexOf('/**')
$j = $fmtFinal.IndexOf('function formatMoney')
if ($i -lt 0 -or $j -lt $i) { throw 'flawed format.js: JSDoc block not found' }
$fmtV1 = $fmtFinal.Substring(0, $i) + $fmtFinal.Substring($j)
$s = $fmtV1.IndexOf('  if (typeof amount')
$e = $fmtV1.IndexOf('  return Math.round')
if ($s -lt 0 -or $e -lt $s) { throw 'flawed format.js: input guard not found' }
$fmtV1 = $fmtV1.Substring(0, $s) + $fmtV1.Substring($e)
Write-Utf8 $fmtPath $fmtV1

Commit-As $flawed 'Marcus Lee' 'marcus@acme.dev' '2025-03-10T10:00:00 +0000' `
  'Initial order pricing service' @('package.json', 'README.md', 'src/pricing.js', 'src/format.js', 'src/receipt.js', 'src/invoice.js')

Commit-As $flawed 'Priya Sharma' 'priya@acme.dev' '2026-08-05T09:30:00 +0000' `
  'Add cart validation, tests and code owners' @('src/cart.js', 'tests/cart.test.js', 'CONTRIBUTING.md')

Write-Utf8 $fmtPath $fmtFinal
Commit-As $flawed 'Priya Sharma' 'priya@acme.dev' '2026-09-12T14:10:00 +0000' `
  'Guard formatMoney against non-numeric input' @('src/format.js')

# PR branch: the "cosmetic cleanup" that is not cosmetic.
Invoke-Git $flawed @('checkout', '-q', '-b', 'pr/breaking-pricing')
$fmt = Read-Utf8 $fmtPath
$fmtNew = $fmt.Replace('  return Math.round(amount * 100) / 100;', '  return amount.toFixed(2);')
if ($fmtNew -eq $fmt) { throw 'flawed PR: formatMoney body replacement failed' }
Write-Utf8 $fmtPath $fmtNew

$prcPath = Join-Path $flawed 'src\pricing.js'
$prc = Read-Utf8 $prcPath
$prc = Insert-LineAfter $prc '  FRIEND20: 20,' '  GIFT5: 5,' 'flawed PR pricing.js'
$prcNew = $prc.Replace('  return base * rate;', '  return Math.round(base * rate * 100) / 100;')
if ($prcNew -eq $prc) { throw 'flawed PR: applyTax replacement failed' }
Write-Utf8 $prcPath $prcNew

Commit-As $flawed 'Dana Fox' 'dana@acme.dev' '2026-09-25T16:45:00 +0000' `
  'Currency-safe formatting and tax rounding' @('src/format.js', 'src/pricing.js')
Invoke-Git $flawed @('checkout', '-q', 'main')

# ---------------------------------------------------------------------------
# Clean sample: recent multi-author history, docs that match code, tests for
# every module, and a PR that adds a discount code safely.
# ---------------------------------------------------------------------------
Init-Repo $clean

$prcPath = Join-Path $clean 'src\pricing.js'
$prcFinal = Read-Utf8 $prcPath
$eol = Eol $prcFinal
$a = $prcFinal.IndexOf('  FRIEND20: 20,')
if ($a -lt 0) { throw 'clean pricing.js: FRIEND20 line not found' }
$n = $prcFinal.IndexOf("`n", $a)
$prcV1 = $prcFinal.Substring(0, $a) + $prcFinal.Substring($n + 1)   # v1: no FRIEND20
Write-Utf8 $prcPath $prcV1

$readmePath = Join-Path $clean 'README.md'
$readmeFinal = Read-Utf8 $readmePath
$s = $readmeFinal.IndexOf('## Module map')
$e = $readmeFinal.IndexOf('## Behavior')
if ($s -lt 0 -or $e -lt $s) { throw 'clean README: section markers not found' }
$readmeV1 = $readmeFinal.Substring(0, $s) + $readmeFinal.Substring($e)  # v1: no module map
Write-Utf8 $readmePath $readmeV1

$ptPath = Join-Path $clean 'tests\pricing.test.js'
$ptFinal = Read-Utf8 $ptPath
$s = $ptFinal.IndexOf("test('applyTax includes shipping")
if ($s -lt 0) { throw 'clean pricing tests: marker not found' }
$ptV1 = $ptFinal.Substring(0, $s)                       # v1: 2 of 3 tests
Write-Utf8 $ptPath $ptV1

Commit-As $clean 'Priya Sharma' 'priya@acme.dev' '2026-04-10T11:00:00 +0000' `
  'Initial orderly library' @('package.json', 'README.md', 'CONTRIBUTING.md', 'src/pricing.js', 'src/cart.js')

Commit-As $clean 'Sam Chen' 'sam@acme.dev' '2026-05-20T15:20:00 +0000' `
  'Add formatting, receipt and invoice modules' @('src/format.js', 'src/receipt.js', 'src/invoice.js')

Commit-As $clean 'Priya Sharma' 'priya@acme.dev' '2026-06-30T10:05:00 +0000' `
  'Cover every module with node:test suites' @('tests/cart.test.js', 'tests/format.test.js', 'tests/receipt.test.js', 'tests/invoice.test.js', 'tests/pricing.test.js')

# Restore the final state (this is what main must look like at the end).
Write-Utf8 $prcPath $prcFinal
Write-Utf8 $readmePath $readmeFinal
Write-Utf8 $ptPath $ptFinal
Commit-As $clean 'Sam Chen' 'sam@acme.dev' '2026-08-20T13:40:00 +0000' `
  'Add FRIEND20 discount, module map and tax test' @('src/pricing.js', 'README.md', 'tests/pricing.test.js')

# PR branch: adds GIFT5 with docs and a test - nothing else changes.
Invoke-Git $clean @('checkout', '-q', '-b', 'pr/gift5-discount')
$prc = Insert-LineAfter (Read-Utf8 $prcPath) '  FRIEND20: 20,' '  GIFT5: 5,' 'clean PR pricing.js'
Write-Utf8 $prcPath $prc

$readme = Read-Utf8 $readmePath
$readme = Insert-LineAfter $readme 'to the total, before tax.' '- `GIFT5` - 5% launch discount code (whole-number percentage, applied before tax).' 'clean PR README'
Write-Utf8 $readmePath $readme

$pt = Read-Utf8 $ptPath
$pt = $pt + $eol + "test('applyDiscount applies the GIFT5 code', () => {" + $eol +
  "  assert.strictEqual(applyDiscount(100, 'GIFT5'), 95);" + $eol + "});" + $eol
Write-Utf8 $ptPath $pt

Commit-As $clean 'Sam Chen' 'sam@acme.dev' '2026-09-24T11:15:00 +0000' `
  'Add GIFT5 discount code with docs and test' @('src/pricing.js', 'README.md', 'tests/pricing.test.js')
Invoke-Git $clean @('checkout', '-q', 'main')

# ---------------------------------------------------------------------------
# PR diff files consumed by the backend presets.
# ---------------------------------------------------------------------------
foreach ($pair in @(@($flawed, 'pr/breaking-pricing', 'flawed-pr.diff'), @($clean, 'pr/gift5-discount', 'clean-pr.diff'))) {
  $out = Join-Path $diffs $pair[2]
  if (Test-Path $out) { Remove-Item -Force $out }
  Invoke-Git $pair[0] @('diff', "main..$($pair[1])", "--output=$($out.Replace('\', '/'))")
  if (-not (Test-Path $out) -or (Get-Item $out).Length -eq 0) { throw "empty diff: $out" }
}

# Leave no commit identity behind for later commands.
foreach ($v in 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE') {
  Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}

Write-Output '=== flawed history ==='
Invoke-Git $flawed @('log', '--all', '--graph', '--date=short', '--format=%ad %an  %s')
Write-Output '=== clean history ==='
Invoke-Git $clean @('log', '--all', '--graph', '--date=short', '--format=%ad %an  %s')
Write-Output '=== working tree status (both must be clean) ==='
Invoke-Git $flawed @('status', '--porcelain')
Invoke-Git $clean @('status', '--porcelain')
Write-Output 'seed-git: OK'
