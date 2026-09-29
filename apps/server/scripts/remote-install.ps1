# Remote install Stella Kiosk - zip + SMB (C$) copy, WinRM only for expand/start.
param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$PackageDir,
  [string]$KioskId = "",
  [int]$HealthPort = 47821,
  [int]$UiPort = 47820,
  [string]$AppVersion = "0.1.0",
  [string]$DeployUser = "",
  [string]$DeployPassword = "",
  [string]$ConfigJson = "",
  [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Stage([string]$Name) {
  [Console]::Out.WriteLine("STAGE:$Name")
  [Console]::Out.Flush()
}

function ConvertTo-NetUser([string]$User) {
  if ($User -match '^(.+)@(.+)$') {
    return "$($Matches[2])\$($Matches[1])"
  }
  return $User
}

if (-not $KioskId) { $KioskId = $Hostname.ToLower() }
$Hostname = $Hostname.Trim()

if (-not (Test-Path $PackageDir)) {
  throw "Package not found: $PackageDir. Run: pnpm pack:kiosk-deploy"
}

$agentSrc = Join-Path $PackageDir "agent.mjs"
$uiSrc = Join-Path $PackageDir "ui"
$localInstall = Join-Path $PackageDir "install-local.ps1"
$packageZip = Join-Path $PackageDir "package.zip"
if (-not (Test-Path $agentSrc)) { throw "Missing agent.mjs in package" }
if (-not (Test-Path (Join-Path $uiSrc "index.html"))) { throw "Missing ui/index.html in package" }
if (-not (Test-Path $localInstall)) { throw "Missing install-local.ps1 in package" }

function New-PackageZip {
  if (Test-Path $packageZip) { return $packageZip }
  Write-Host "Building package.zip..."
  $zipStage = Join-Path $env:TEMP ("stella-zip-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force -Path $zipStage | Out-Null
  Copy-Item $agentSrc $zipStage -Force
  Copy-Item $localInstall $zipStage -Force
  Copy-Item $uiSrc (Join-Path $zipStage "ui") -Recurse -Force
  $runtimeSrc = Join-Path $PackageDir "runtime"
  if (Test-Path (Join-Path $runtimeSrc "node.exe")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $zipStage "runtime") | Out-Null
    Copy-Item (Join-Path $runtimeSrc "node.exe") (Join-Path $zipStage "runtime\node.exe") -Force
  }
  Compress-Archive -Path (Join-Path $zipStage "*") -DestinationPath $packageZip -Force
  Remove-Item $zipStage -Recurse -Force -ErrorAction SilentlyContinue
  return $packageZip
}

function Write-KioskConfig([string]$TargetRoot) {
  Write-Stage "configuring"
  if ($ConfigJson -and $ConfigJson.Trim().Length -gt 2) {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Join-Path $TargetRoot "kiosk.json"), $ConfigJson.Trim(), $utf8)
    return
  }
  $cfgObj = [ordered]@{
    hostname             = $Hostname.ToLower()
    kioskId              = $KioskId.ToLower()
    serverUrl            = $ServerUrl.TrimEnd("/")
    syncIntervalSec      = 300
    idleTimeoutSec       = 600
    heartbeatIntervalSec = 30
    healthPort           = $HealthPort
    uiPort               = $UiPort
    appVersion           = $AppVersion
    kioskType            = "exhibit"
  }
  # UTF8 without BOM — Node JSON.parse rejects EF BB BF
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText((Join-Path $TargetRoot "kiosk.json"), ($cfgObj | ConvertTo-Json), $utf8)
}

function Expand-PackageTo([string]$TargetRoot, [string]$ZipPath) {
  Write-Stage "copying"
  New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
  $tmpZip = Join-Path $TargetRoot "_package.zip"
  Copy-Item $ZipPath $tmpZip -Force
  Write-Host "Extracting package..."
  Expand-Archive -Path $tmpZip -DestinationPath $TargetRoot -Force
  Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
}

function Install-ToRoot([string]$TargetRoot) {
  $zip = New-PackageZip
  Expand-PackageTo $TargetRoot $zip
  Write-KioskConfig $TargetRoot

  Write-Stage "installing"
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $TargetRoot "install-local.ps1") -InstallRoot $TargetRoot -UiPort $UiPort -HealthPort $HealthPort 2>&1
  $code = $LASTEXITCODE
  $text = ($out | Out-String).Trim()
  if ($code -ne 0 -and $null -ne $code) { throw "install-local failed (exit $code): $text" }
  if ($text -notmatch "OK installed") { throw "install-local failed: $text" }
  Write-Stage "starting"
  return $text
}

$cn = $env:COMPUTERNAME
if (-not $cn) { $cn = $env:HOSTNAME }
if (-not $cn) { $cn = [System.Net.Dns]::GetHostName() }
$localName = $cn.ToLower()
$isLocal = $LocalOnly -or ($Hostname.ToLower() -eq $localName) -or ($Hostname -eq "localhost") -or ($Hostname -eq "127.0.0.1")

if ($isLocal) {
  Write-Stage "connecting"
  Write-Host "Local install on $localName ..."
  $result = Install-ToRoot (Join-Path $env:ProgramData "StellaKiosk")
  Write-Stage "done"
  Write-Output "INSTALL_OK: $result"
  exit 0
}

$cred = $null
$netUser = $null
if ($DeployUser -and $DeployPassword) {
  if ($DeployUser -match '^(DOMAIN\\|domain\\)') {
    throw "DEPLOY_USER looks like a placeholder. Use user@domain"
  }
  $sec = ConvertTo-SecureString $DeployPassword -AsPlainText -Force
  $cred = New-Object System.Management.Automation.PSCredential ($DeployUser, $sec)
  $netUser = ConvertTo-NetUser $DeployUser
}

$sessionParams = @{
  ComputerName   = $Hostname
  ErrorAction    = "Stop"
}
if ($cred) { $sessionParams.Credential = $cred }
# PSWSMan on Linux/macOS: New-PSSessionOption lacks OpenTimeout/OperationTimeout/IdleTimeout
if ($IsWindows) {
  $sessionParams.SessionOption = (New-PSSessionOption -OperationTimeout 0 -IdleTimeout 600000 -OpenTimeout 120000)
} else {
  $sessionParams.Authentication = "Negotiate"
}

Write-Stage "connecting"
Write-Host "Connecting via WinRM to $Hostname as $DeployUser ..."
try {
  $session = New-PSSession @sessionParams
} catch {
  throw "WinRM connect failed to '$Hostname': $($_.Exception.Message)"
}

$share = $null
$mappedDrive = $null
$installOk = $false
try {
  $remoteRoot = "C:\ProgramData\StellaKiosk"
  $zip = New-PackageZip
  $zipMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)

  Invoke-Command -Session $session -ScriptBlock {
    param($root)
    New-Item -ItemType Directory -Force -Path $root | Out-Null
  } -ArgumentList $remoteRoot

  Write-Stage "copying"
  # Do not use Join-Path for Windows paths when this script runs on Linux (pwsh/PSWSMan)
  $remoteZip = "$remoteRoot\_package.zip"
  $copied = $false

  # Resolve reachable SMB targets: LAN IP (via WinRM), FQDN, short name
  $remoteIp = $null
  try {
    $remoteIp = Invoke-Command -Session $session -ScriptBlock {
      $cfg = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } |
        Select-Object -First 1
      if ($cfg -and $cfg.IPv4Address) { return [string]$cfg.IPv4Address.IPAddress }
      $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
        Select-Object -First 1
      if ($a) { return [string]$a.IPAddress }
      return $null
    }
  } catch {
    Write-Host "Could not read remote IP: $($_.Exception.Message)"
  }

  $domainSuffix = $null
  if ($DeployUser -match '@(.+)$') { $domainSuffix = $Matches[1].Trim() }

  $smbTargets = @()
  if ($remoteIp) { $smbTargets += $remoteIp }
  # Only append suffix if Hostname is a short name (no dots)
  if ($domainSuffix -and ($Hostname -notmatch '\.')) { $smbTargets += "$Hostname.$domainSuffix" }
  $smbTargets += $Hostname
  $smbTargets = $smbTargets | Select-Object -Unique

  function Copy-PackageViaCifs([string]$TargetHost) {
    # Debian/Linux path: mount.cifs is fast; PS New-PSDrive SMB and WinRM Copy-Item are slow/unreliable
    if (-not (Get-Command mount -ErrorAction SilentlyContinue)) { throw "mount not found" }
    $mnt = Join-Path ([System.IO.Path]::GetTempPath()) ("stella-cifs-" + [guid]::NewGuid().ToString("n"))
    New-Item -ItemType Directory -Force -Path $mnt | Out-Null
    $credFile = Join-Path ([System.IO.Path]::GetTempPath()) ("stella-smbcred-" + [guid]::NewGuid().ToString("n"))
    try {
      $smbUser = $DeployUser
      $smbDomain = ""
      if ($DeployUser -match '^(.+)@(.+)$') {
        $smbUser = $Matches[1]
        $smbDomain = (($Matches[2] -split '\.')[0]).ToUpper()
      } elseif ($DeployUser -match '^([^\\]+)\\(.+)$') {
        $smbDomain = $Matches[1]
        $smbUser = $Matches[2]
      }
      $credLines = @("username=$smbUser", "password=$DeployPassword")
      if ($smbDomain) { $credLines += "domain=$smbDomain" }
      Set-Content -Path $credFile -Value ($credLines -join "`n") -Encoding ascii
      Write-Host "Trying CIFS //$TargetHost/C$ ..."
      & mount -t cifs "//${TargetHost}/C$" $mnt -o "credentials=$credFile,vers=3.0,uid=0,gid=0" 2>&1 | Out-String | Write-Host
      if ($LASTEXITCODE -ne 0) { throw "mount.cifs exit $LASTEXITCODE" }
      $dest = Join-Path $mnt "ProgramData/StellaKiosk"
      New-Item -ItemType Directory -Force -Path $dest | Out-Null
      Copy-Item -Path $zip -Destination (Join-Path $dest "_package.zip") -Force -ErrorAction Stop
      $script:share = "cifs://$TargetHost/C$"
    } finally {
      try { & umount $mnt 2>$null } catch {}
      Remove-Item -Force -Recurse -ErrorAction SilentlyContinue $mnt, $credFile
    }
  }

  function Copy-PackageViaSmb([string]$TargetHost) {
    if ($IsLinux) {
      Copy-PackageViaCifs $TargetHost
      return
    }
    $rootShare = "\\$TargetHost\C$"
    $destDir = "\\$TargetHost\C$\ProgramData\StellaKiosk"
    $destZip = "$destDir\_package.zip"
    Write-Host "Trying SMB $rootShare ..."

    if ($cred) {
      # Prefer PSDrive (works better with UPN/domain creds than bare net use on some hosts)
      $driveName = "Stella" + [guid]::NewGuid().ToString("n").Substring(0, 6)
      New-PSDrive -Name $driveName -PSProvider FileSystem -Root $rootShare -Credential $cred -ErrorAction Stop | Out-Null
      $script:mappedDrive = $driveName
      $script:share = $rootShare
      New-Item -ItemType Directory -Force -Path "${driveName}:\ProgramData\StellaKiosk" -ErrorAction Stop | Out-Null
      Copy-Item -Path $zip -Destination "${driveName}:\ProgramData\StellaKiosk\_package.zip" -Force -ErrorAction Stop
    } else {
      New-Item -ItemType Directory -Force -Path $destDir -ErrorAction Stop | Out-Null
      Copy-Item -Path $zip -Destination $destZip -Force -ErrorAction Stop
      $script:share = $rootShare
    }
  }

  $smbErrors = @()
  foreach ($t in $smbTargets) {
    try {
      Copy-PackageViaSmb $t
      Write-Host "SMB copy done via $t ($zipMb MB)."
      $copied = $true
      break
    } catch {
      $smbErrors += "$t : $($_.Exception.Message)"
      Write-Host "SMB failed for $t : $($_.Exception.Message)"
      if ($mappedDrive) {
        Remove-PSDrive -Name $mappedDrive -Force -ErrorAction SilentlyContinue
        $mappedDrive = $null
      }
      $share = $null
    }
  }

  if (-not $copied) {
    Write-Host ("SMB unavailable (" + ($smbErrors -join "; ") + "). Falling back to WinRM zip copy...")
    Write-Host "Copying package.zip ($zipMb MB) via WinRM (may take a few minutes)..."
    Copy-Item -Path $zip -Destination $remoteZip -ToSession $session -Force
    Write-Host "WinRM zip copy done."
    $copied = $true
  }

  if (-not $copied) { throw "Failed to copy package.zip to remote host" }

  Write-Host "Stopping previous agent (if any) so files can be replaced..."
  Invoke-Command -Session $session -ScriptBlock {
    param($root)
    foreach ($t in @("StellaKioskAgent", "StellaKioskUI")) {
      try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
      try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    }
    # Kill node processes running our agent (locks runtime\node.exe)
    $agent = Join-Path $root "agent.mjs"
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    Start-Sleep -Seconds 1
  } -ArgumentList $remoteRoot

  Write-Host "Extracting on remote..."
  Invoke-Command -Session $session -ScriptBlock {
    param($root)
    $ErrorActionPreference = "Stop"
    $z = Join-Path $root "_package.zip"
    if (-not (Test-Path $z)) { throw "Zip not found on remote: $z" }
    # Clear previous payload except keep folder
    foreach ($name in @("agent.mjs", "install-local.ps1", "ui", "runtime", "version.json", "VERSION", "MANIFEST.txt", "update.zip")) {
      $p = Join-Path $root $name
      if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Expand-Archive -Path $z -DestinationPath $root -Force
    Remove-Item $z -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Join-Path $root "games") | Out-Null
    if (-not (Test-Path (Join-Path $root "agent.mjs"))) {
      throw "Extract failed: agent.mjs missing under $root"
    }
  } -ArgumentList $remoteRoot

  Write-Stage "configuring"
  if ($ConfigJson -and $ConfigJson.Trim().Length -gt 2) {
    $cfg = $ConfigJson.Trim()
  } else {
    $cfgObj = [ordered]@{
      hostname             = $Hostname.ToLower()
      kioskId              = $KioskId.ToLower()
      serverUrl            = $ServerUrl.TrimEnd("/")
      syncIntervalSec      = 300
      idleTimeoutSec       = 600
      heartbeatIntervalSec = 30
      healthPort           = $HealthPort
      uiPort               = $UiPort
      appVersion           = $AppVersion
      kioskType            = "exhibit"
    }
    $cfg = $cfgObj | ConvertTo-Json
  }
  Invoke-Command -Session $session -ScriptBlock {
    param($root, $json)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Join-Path $root "kiosk.json"), $json, $utf8)
  } -ArgumentList $remoteRoot, $cfg

  Write-Stage "installing"
  Write-Host "Running local installer on remote host (timeout 8 min)..."
  $installJob = Invoke-Command -Session $session -ScriptBlock {
    param($root, $uiPort, $healthPort)
    $ErrorActionPreference = "Stop"
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "install-local.ps1") -InstallRoot $root -UiPort $uiPort -HealthPort $healthPort -RemoteInvoke 2>&1
    $code = $LASTEXITCODE
    $text = ($out | Out-String).Trim()
    if ($code -ne 0 -and $null -ne $code) { throw "exit $code : $text" }
    if ($text -notmatch "OK installed") { throw $text }
    return $text
  } -ArgumentList $remoteRoot, $UiPort, $HealthPort -AsJob

  if (-not (Wait-Job $installJob -Timeout 480)) {
    Stop-Job $installJob -Force -ErrorAction SilentlyContinue
    Remove-Job $installJob -Force -ErrorAction SilentlyContinue
    throw "install-local timed out after 8 minutes on remote host. Check WinRM, disk space, or log on to kiosk and run install-local.ps1 manually."
  }
  try {
    $result = Receive-Job $installJob -ErrorAction Stop
  } finally {
    Remove-Job $installJob -Force -ErrorAction SilentlyContinue
  }

  Write-Stage "starting"
  Write-Host "Ensuring Edge UI on interactive desktop..."
  $uiKick = Invoke-Command -Session $session -ScriptBlock {
    param($Port)
    $ErrorActionPreference = "Continue"
    $root = Join-Path $env:ProgramData "StellaKiosk"
    Remove-Item -Path (Join-Path $root "STOPPED") -Force -ErrorAction SilentlyContinue
    Remove-Item -Path (Join-Path $root "SOFTWARE_DISABLED") -Force -ErrorAction SilentlyContinue
    try {
      Set-Content -Path (Join-Path $root "LAUNCH_UI") -Value ([string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Encoding ascii -Force
    } catch {}

    $edge = @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $edge) { return "no-edge; LAUNCH_UI set for agent" }

    $proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) { return "no-explorer (log on to kiosk PC); LAUNCH_UI set" }
    $owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction SilentlyContinue
    if (-not $owner -or [string]::IsNullOrWhiteSpace($owner.User)) { return "no-console-user; LAUNCH_UI set" }
    $user = if ($owner.Domain) { "$($owner.Domain)\$($owner.User)" } else { $owner.User }

    $profile = Join-Path $root "edge-profile"
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $bust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $uiArgs = "--user-data-dir=`"$profile`" --kiosk http://127.0.0.1:$Port/?nocache=$bust --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble --noerrdialogs --check-for-update-interval=31536000 --disable-features=msEdgeSidebar,TranslateUI,InfiniteSessionRestore,msVisualSearch --disable-pinch --overscroll-history-navigation=0 --disk-cache-size=1"
    $once = "StellaKioskStartNow"
    $job = Start-Job -ScriptBlock {
      param($EdgePath, $Args, $Once, $User)
      $action = New-ScheduledTaskAction -Execute $EdgePath -Argument $Args
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
      $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
      Unregister-ScheduledTask -TaskName $Once -Confirm:$false -ErrorAction SilentlyContinue
      Register-ScheduledTask -TaskName $Once -Action $action -Principal $principal -Settings $settings -Force | Out-Null
      Start-ScheduledTask -TaskName $Once -ErrorAction Stop
      return "Edge started as $User"
    } -ArgumentList $edge, $uiArgs, $once, $user

    if (-not (Wait-Job $job -Timeout 8)) {
      Stop-Job $job -ErrorAction SilentlyContinue
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      return "Edge kick deferred for $user; agent LAUNCH_UI set"
    }
    try {
      $msg = Receive-Job $job -ErrorAction Stop
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      return $msg
    } catch {
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      return "Edge kick failed: $($_.Exception.Message); agent LAUNCH_UI set"
    }
  } -ArgumentList $UiPort
  Write-Host "UI kick: $uiKick"

  Write-Stage "done"
  Write-Output "INSTALL_OK: $result | UI: $uiKick"
  $installOk = $true
}
finally {
  # Never let cleanup spoil a successful install (ErrorAction Stop + native cmd noise)
  try {
    if ($mappedDrive) {
      Remove-PSDrive -Name $mappedDrive -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  try {
    if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
  } catch {}
}

# Cleanup after finally must not spoil success exit code
if ($installOk) { exit 0 }
