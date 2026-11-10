# tsukiboshi : mise à jour sans fenêtre, lancée par « Mettre a jour tsukiboshi.vbs » (double-clic).
#   1. demande à GitHub la dernière version publiée (page Releases du projet) ;
#   2. si elle est plus récente : télécharge son zip dans un dossier temporaire et le décompresse ;
#   3. copie les nouveaux fichiers dans le dossier de l'extension (manifest.json en dernier) ;
#   4. supprime le dossier temporaire (zip compris).
# L'extension voit le nouveau manifest.json et se recharge toute seule. Tes données (historique, notes…)
# sont gardées par le navigateur : elles ne sont pas dans ce dossier et ne sont jamais touchées.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ext = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
function Say([string]$msg, [int]$icon = 64) { [void]$shell.Popup($msg, 10, 'tsukiboshi', $icon) }
$headers = @{ 'User-Agent' = 'tsukiboshi-maj'; 'Accept' = 'application/vnd.github+json' }
$tmp = Join-Path $env:TEMP ('tsukiboshi-maj-' + [guid]::NewGuid().ToString('N'))
try {
  $cur = (Get-Content (Join-Path $ext 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/NateagXiorcled/tsukiboshi/releases/latest' -Headers $headers -UseBasicParsing
  $new = ([string]$release.tag_name) -replace '^v', ''
  if ([version]$new -le [version]$cur) { Say "tsukiboshi est déjà à jour (version $cur)."; exit }
  $asset = $release.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
  $url = if ($asset) { $asset.browser_download_url } else { $release.zipball_url }
  if ($url -notmatch '^https://(github\.com|api\.github\.com|codeload\.github\.com)/') { throw "adresse de téléchargement inattendue ($url)" }
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'tsukiboshi.zip'
  Invoke-WebRequest -Uri $url -OutFile $zip -Headers @{ 'User-Agent' = 'tsukiboshi-maj' } -UseBasicParsing
  $out = Join-Path $tmp 'x'
  Expand-Archive -Path $zip -DestinationPath $out -Force
  # dossier de l'extension dans l'archive : celui qui contient manifest.json (le moins profond)
  $mf = Get-ChildItem $out -Recurse -Filter 'manifest.json' | Sort-Object { $_.FullName.Length } | Select-Object -First 1
  if (-not $mf) { throw "l'archive ne contient pas l'extension" }
  $m = Get-Content $mf.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($m.name -notmatch 'tsukiboshi') { throw "l'archive ne contient pas tsukiboshi" }
  $src = $mf.DirectoryName
  foreach ($f in Get-ChildItem $src -Recurse -File) {
    if ($f.FullName -eq $mf.FullName) { continue }
    $relPath = $f.FullName.Substring($src.Length).TrimStart('\', '/')
    $dst = Join-Path $ext $relPath
    New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
    Copy-Item -LiteralPath $f.FullName -Destination $dst -Force
  }
  # en dernier : c'est ce fichier qui déclenche le rechargement de l'extension
  Copy-Item -LiteralPath $mf.FullName -Destination (Join-Path $ext 'manifest.json') -Force
  Say "tsukiboshi est passé à la version $new.`nL'extension se recharge toute seule dans une minute environ. Tes données sont gardées."
} catch {
  Say ("La mise à jour n'a pas pu se faire : " + $_.Exception.Message + "`nTu peux toujours télécharger le zip sur GitHub (page Releases).") 48
} finally {
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
