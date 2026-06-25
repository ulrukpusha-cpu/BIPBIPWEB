# ============================================================
# BIPBIP — Update Pub Banner (Windows PowerShell)
# Uploade une image vers /uploads/ + met à jour pubBanners dans config.
#
# Usage:
#   .\update-banner.ps1 -Placement home1 -Image "C:\photo.jpg" `
#       -Text "Promo Noël -10%" -Url "https://bipbiprecharge.ci/promo" `
#       -ScrollSpeed 5
#
#   .\update-banner.ps1 -List               # affiche les bannières actuelles
#   .\update-banner.ps1 -Delete home2       # supprime une bannière
# ============================================================

param(
  [ValidateSet("home1", "home2", "actualites")]
  [string]$Placement,

  [string]$Image,         # chemin local Windows OU URL https://
  [string]$Text = "",
  [string]$Url  = "",
  [int]$ScrollSpeed = 5,

  [switch]$List,
  [string]$Delete,
  [switch]$DryRun
)

# ── Configuration (à adapter si nécessaire) ────────────────
$Api  = "https://bipbiprecharge.ci"
$Key  = $env:BBR_ADMIN_KEY  # lis depuis variable env, ou fallback hardcodé:
if (-not $Key) { $Key = "UQAuGWDe9CJqctQnKtNc5jd1MTYpIhas8qQLavQL33tU9wxRAsso" }

# ── Helpers ──────────────────────────────────────────────────
function Get-CurrentBanners {
  $cfg = Invoke-RestMethod -Uri "$Api/api/config" -Method GET
  if ($cfg.pubBanners) { return $cfg.pubBanners }
  return @()
}

function Save-Banners {
  param([array]$Banners)
  $body = @{ pubBanners = $Banners } | ConvertTo-Json -Depth 10
  if ($DryRun) {
    Write-Host "`n[DRY RUN] Body qui aurait été envoyé:" -ForegroundColor Yellow
    Write-Host $body
    return $null
  }
  $r = Invoke-RestMethod -Uri "$Api/api/admin/config" -Method PUT `
    -Headers @{ "X-Admin-Key" = $Key; "Content-Type" = "application/json" } `
    -Body $body
  return $r
}

function Show-Banners {
  $b = Get-CurrentBanners
  if ($b.Count -eq 0) {
    Write-Host "Aucune bannière configurée." -ForegroundColor Yellow
    return
  }
  Write-Host "`n┌─ Bannières publicitaires actuelles ─────────────────────" -ForegroundColor Cyan
  foreach ($x in $b) {
    Write-Host ""
    Write-Host "  📍 $($x.placement)" -ForegroundColor Green
    Write-Host "     image  : $($x.image)"
    if ($x.text)  { Write-Host "     texte  : $($x.text)" }
    if ($x.url)   { Write-Host "     URL    : $($x.url)" }
    Write-Host "     vitesse: $($x.scrollSpeed)"
  }
  Write-Host ""
}

function Upload-Image {
  param([string]$Path)
  if (-not (Test-Path $Path)) { throw "Image introuvable : $Path" }
  $size = "{0:N1}" -f ((Get-Item $Path).Length / 1KB)
  Write-Host "Upload de l'image ($size KB)..." -ForegroundColor Cyan

  $form = @{ image = Get-Item -Path $Path }
  $r = Invoke-RestMethod -Uri "$Api/api/admin/pub-banner-image" `
    -Method POST -Form $form `
    -Headers @{ "X-Admin-Key" = $Key }
  if (-not $r.success) { throw "Upload échoué : $($r | ConvertTo-Json)" }
  Write-Host "✓ Image uploadée → $($r.url)" -ForegroundColor Green
  return $r.url
}

# ── Dispatch ─────────────────────────────────────────────────

if ($List) {
  Show-Banners
  exit 0
}

if ($Delete) {
  if ($Delete -notin @("home1","home2","actualites")) {
    Write-Error "Placement invalide. Choisis: home1, home2, actualites"
    exit 1
  }
  $current = Get-CurrentBanners
  $filtered = @($current | Where-Object { $_.placement -ne $Delete })
  if ($filtered.Count -eq $current.Count) {
    Write-Host "Aucune bannière à supprimer pour placement '$Delete'." -ForegroundColor Yellow
    exit 0
  }
  Save-Banners -Banners $filtered | Out-Null
  Write-Host "✓ Bannière '$Delete' supprimée." -ForegroundColor Green
  Show-Banners
  exit 0
}

# Mode "ajouter / mettre à jour"
if (-not $Placement) {
  Write-Host @"
Usage:
  .\update-banner.ps1 -Placement <home1|home2|actualites> -Image <chemin|URL> [-Text "..."] [-Url "..."] [-ScrollSpeed 1-10]
  .\update-banner.ps1 -List
  .\update-banner.ps1 -Delete <home1|home2|actualites>

Exemples:
  .\update-banner.ps1 -Placement home1 -Image C:\promo.jpg -Text "Promo Noël" -Url https://bipbiprecharge.ci/promo
  .\update-banner.ps1 -Placement actualites -Image https://example.com/banner.png
  .\update-banner.ps1 -List
"@
  exit 0
}

if (-not $Image) { Write-Error "-Image requis (chemin local ou URL https://)"; exit 1 }

# Upload si chemin local, sinon utilise l'URL telle quelle
if ($Image -match "^https?://") {
  $imageUrl = $Image
  Write-Host "Image URL externe : $imageUrl" -ForegroundColor DarkGray
} else {
  $imageUrl = Upload-Image -Path $Image
}

# Récupère banners actuelles, remplace celle du placement
$current = Get-CurrentBanners
$updated = @()
$replaced = $false
foreach ($b in $current) {
  if ($b.placement -eq $Placement) {
    $newB = @{
      placement   = $Placement
      image       = $imageUrl
      text        = $Text
      scrollSpeed = [Math]::Max(1, [Math]::Min(10, $ScrollSpeed))
    }
    if ($Url) { $newB.url = $Url }
    $updated += $newB
    $replaced = $true
  } else {
    $updated += $b
  }
}
if (-not $replaced) {
  $newB = @{
    placement   = $Placement
    image       = $imageUrl
    text        = $Text
    scrollSpeed = [Math]::Max(1, [Math]::Min(10, $ScrollSpeed))
  }
  if ($Url) { $newB.url = $Url }
  $updated += $newB
}

$r = Save-Banners -Banners $updated
if ($r -and $r.success) {
  Write-Host "`n✓ Bannière '$Placement' enregistrée." -ForegroundColor Green
  Show-Banners
}
