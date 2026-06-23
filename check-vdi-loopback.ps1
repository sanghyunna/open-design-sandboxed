#!/usr/bin/env pwsh
#Requires -Version 5.1
<#
.SYNOPSIS
    Diagnose Open Design loopback/proxy behavior on a Windows VDI.

.EXAMPLE
    .\check-vdi-loopback.ps1
#>
[CmdletBinding()]
param(
    [int[]]$Ports = @(),
    [string[]]$Urls = @(),
    [string[]]$Roots = @(),
    [int]$MaxLogAgeHours = 24,
    [int]$TimeoutMs = 1000,
    [string]$OutputPath
)

$ErrorActionPreference = "Continue"
$Lines = New-Object System.Collections.Generic.List[string]
$DiscoveredPorts = New-Object System.Collections.Generic.HashSet[int]
$DiscoveredUrls = New-Object System.Collections.Generic.HashSet[string]
$TcpOpenPorts = New-Object System.Collections.Generic.HashSet[int]
$SelfLoopbackOk = $false
$CurlDefaultFailures = 0
$CurlNoProxySuccesses = 0
$LocalhostOnlyFailures = 0

function Write-ReportLine {
    param([string]$Line = "")
    $script:Lines.Add($Line) | Out-Null
    Write-Host $Line
}

function Show-Value {
    param([object]$Value)
    if ($null -eq $Value) { return "<unset>" }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return "<unset>" }
    return $text
}

function Add-Port {
    param([Nullable[int]]$Port)
    if ($null -ne $Port -and $Port -gt 0) {
        $script:DiscoveredPorts.Add([int]$Port) | Out-Null
    }
}

function Add-Url {
    param([string]$Url)
    if ([string]::IsNullOrWhiteSpace($Url)) { return }
    try {
        $uri = [Uri]$Url
        if ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") { return }
        $script:DiscoveredUrls.Add($uri.AbsoluteUri) | Out-Null
        Add-Port $uri.Port
    } catch {
        return
    }
}

function Test-TcpPort {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$TimeoutMs
    )
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return [pscustomobject]@{ Ok = $false; Detail = "timeout ${TimeoutMs}ms" }
        }
        $client.EndConnect($async)
        return [pscustomobject]@{ Ok = $true; Detail = "connected" }
    } catch {
        return [pscustomobject]@{ Ok = $false; Detail = $_.Exception.Message }
    } finally {
        $client.Close()
    }
}

function Test-CurlUrl {
    param(
        [string]$Url,
        [switch]$NoProxy
    )
    if ($null -eq (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ Ok = $false; Detail = "curl.exe not found" }
    }
    $seconds = [Math]::Max(1, [Math]::Ceiling($TimeoutMs / 1000))
    $args = @(
        "--silent",
        "--show-error",
        "--output",
        "NUL",
        "--write-out",
        "http=%{http_code} remote=%{remote_ip}:%{remote_port} time=%{time_total}",
        "--max-time",
        "$seconds"
    )
    if ($NoProxy) {
        $args += @("--noproxy", "*")
    }
    $args += $Url
    $output = & curl.exe @args 2>&1
    return [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0); Detail = (($output | Out-String).Trim()) }
}

function Add-CandidateFilesFromNamespaceRoot {
    param(
        [string]$NamespaceRoot,
        [System.Collections.Generic.List[string]]$Files
    )
    if (-not (Test-Path $NamespaceRoot)) { return }
    Get-ChildItem -Path $NamespaceRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $logs = Join-Path $_.FullName "logs"
        $runtime = Join-Path $_.FullName "runtime"
        if (Test-Path $logs) {
            Get-ChildItem -Path $logs -Filter "latest.log" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                $Files.Add($_.FullName) | Out-Null
            }
        }
        if (Test-Path $runtime) {
            Get-ChildItem -Path $runtime -Filter "*.json" -ErrorAction SilentlyContinue | ForEach-Object {
                $Files.Add($_.FullName) | Out-Null
            }
        }
    }
}

function Discover-UrlsFromFiles {
    $files = New-Object System.Collections.Generic.List[string]
    $recentFiles = New-Object System.Collections.Generic.List[string]
    $rootsToCheck = New-Object System.Collections.Generic.List[string]
    foreach ($root in $Roots) { if (-not [string]::IsNullOrWhiteSpace($root)) { $rootsToCheck.Add($root) | Out-Null } }
    $rootsToCheck.Add($PSScriptRoot) | Out-Null
    $rootsToCheck.Add((Get-Location).Path) | Out-Null
    if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $rootsToCheck.Add((Join-Path $env:APPDATA "Open Design")) | Out-Null
        $rootsToCheck.Add((Join-Path $env:APPDATA "Open Design Beta")) | Out-Null
        $rootsToCheck.Add((Join-Path $env:APPDATA "Open Design Preview")) | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $rootsToCheck.Add((Join-Path $env:LOCALAPPDATA "Open Design")) | Out-Null
        $rootsToCheck.Add((Join-Path $env:LOCALAPPDATA "Open Design Beta")) | Out-Null
        $rootsToCheck.Add((Join-Path $env:LOCALAPPDATA "Open Design Preview")) | Out-Null
    }

    foreach ($root in ($rootsToCheck | Select-Object -Unique)) {
        if (-not (Test-Path $root)) { continue }
        Add-CandidateFilesFromNamespaceRoot (Join-Path $root "OpenDesignData\namespaces") $files
        Add-CandidateFilesFromNamespaceRoot (Join-Path $root "namespaces") $files
        if (Test-Path (Join-Path $root "logs")) {
            $parent = Split-Path -Parent $root
            if ($parent) { Add-CandidateFilesFromNamespaceRoot $parent $files }
        }
    }

    $cutoff = (Get-Date).AddHours(-1 * [Math]::Max(1, $MaxLogAgeHours))
    foreach ($file in ($files | Select-Object -Unique)) {
        try {
            $item = Get-Item -Path $file -ErrorAction Stop
            if ($item.LastWriteTime -ge $cutoff) {
                $recentFiles.Add($file) | Out-Null
            }
        } catch {
            continue
        }
    }

    $pattern = 'http://(?:127\.0\.0\.1|localhost|\[::1\]):(?<port>\d+)'
    foreach ($file in ($recentFiles | Select-Object -Unique)) {
        try {
            $text = (Get-Content -Path $file -Tail 400 -ErrorAction Stop) -join "`n"
            foreach ($match in [regex]::Matches($text, $pattern)) {
                Add-Url $match.Value
                Add-Port ([int]$match.Groups["port"].Value)
            }
        } catch {
            continue
        }
    }
    return ($recentFiles | Select-Object -Unique)
}

function Discover-ListeningPorts {
    if ($null -eq (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return }
    try {
        Get-NetTCPConnection -State Listen -ErrorAction Stop |
            Where-Object { $_.LocalAddress -in @("127.0.0.1", "::1", "0.0.0.0", "::") } |
            ForEach-Object {
                $processName = ""
                try {
                    $processName = (Get-Process -Id $_.OwningProcess -ErrorAction Stop).ProcessName
                } catch {
                    $processName = "pid:$($_.OwningProcess)"
                }
                if ($processName -match "Open|Design|node|electron") {
                    Add-Port ([int]$_.LocalPort)
                    Write-ReportLine ("listener: {0}:{1} pid={2} process={3}" -f $_.LocalAddress, $_.LocalPort, $_.OwningProcess, $processName)
                }
            }
    } catch {
        Write-ReportLine ("listener discovery failed: {0}" -f $_.Exception.Message)
    }
}

Write-ReportLine "=== Open Design VDI loopback diagnostic ==="
Write-ReportLine ("Time      : {0:o}" -f (Get-Date))
Write-ReportLine ("Computer  : {0}" -f $env:COMPUTERNAME)
Write-ReportLine ("User      : {0}" -f $env:USERNAME)
Write-ReportLine ("PS        : {0}" -f $PSVersionTable.PSVersion)
Write-ReportLine ("Script dir: {0}" -f $PSScriptRoot)
Write-ReportLine ""

Write-ReportLine "== Proxy environment =="
foreach ($name in @("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY", "http_proxy", "https_proxy", "no_proxy")) {
    Write-ReportLine ("{0}={1}" -f $name, (Show-Value ([Environment]::GetEnvironmentVariable($name))))
}
Write-ReportLine ""

Write-ReportLine "== localhost DNS =="
try {
    [System.Net.Dns]::GetHostAddresses("localhost") | ForEach-Object {
        Write-ReportLine ("localhost -> {0} ({1})" -f $_.IPAddressToString, $_.AddressFamily)
    }
} catch {
    Write-ReportLine ("localhost lookup failed: {0}" -f $_.Exception.Message)
}
Write-ReportLine ""

Write-ReportLine "== Self loopback TCP test =="
$listener = $null
try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    $selfPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    Write-ReportLine ("self listener: 127.0.0.1:{0}" -f $selfPort)
    foreach ($hostName in @("127.0.0.1", "localhost")) {
        $result = Test-TcpPort $hostName $selfPort $TimeoutMs
        Write-ReportLine ("self tcp {0}:{1} -> {2} ({3})" -f $hostName, $selfPort, $(if ($result.Ok) { "OK" } else { "FAIL" }), $result.Detail)
        if ($hostName -eq "127.0.0.1" -and $result.Ok) {
            $SelfLoopbackOk = $true
        }
    }
} catch {
    Write-ReportLine ("self loopback test failed: {0}" -f $_.Exception.Message)
} finally {
    if ($listener -ne $null) { $listener.Stop() }
}
Write-ReportLine ""

Write-ReportLine "== Open Design URL/port discovery =="
foreach ($url in $Urls) { Add-Url $url }
foreach ($port in $Ports) { Add-Port $port }
$explicitTargets = ($Urls.Count -gt 0 -or $Ports.Count -gt 0)
if ($explicitTargets) {
    Write-ReportLine "explicit -Ports/-Urls supplied; skipped log file discovery."
} else {
    $files = Discover-UrlsFromFiles
    if ($files.Count -gt 0) {
        Write-ReportLine ("scanned recent files (last {0}h):" -f $MaxLogAgeHours)
        foreach ($file in $files) { Write-ReportLine ("- {0}" -f $file) }
    } else {
        Write-ReportLine ("scanned recent files (last {0}h): <none found>" -f $MaxLogAgeHours)
    }
}
Discover-ListeningPorts
if ($DiscoveredUrls.Count -eq 0 -and $DiscoveredPorts.Count -eq 0) {
    Write-ReportLine "No Open Design URLs/ports found. Start Open Design, wait for the splash to finish or fail, then run this script again."
}
Write-ReportLine ""

Write-ReportLine "== Port tests =="
foreach ($port in ($DiscoveredPorts | Sort-Object)) {
    $ipv4Ok = $false
    $localhostOk = $false
    foreach ($hostName in @("127.0.0.1", "localhost")) {
        $result = Test-TcpPort $hostName $port $TimeoutMs
        Write-ReportLine ("tcp {0}:{1} -> {2} ({3})" -f $hostName, $port, $(if ($result.Ok) { "OK" } else { "FAIL" }), $result.Detail)
        if ($hostName -eq "127.0.0.1" -and $result.Ok) {
            $ipv4Ok = $true
            $TcpOpenPorts.Add([int]$port) | Out-Null
        }
        if ($hostName -eq "localhost" -and $result.Ok) {
            $localhostOk = $true
        }
    }
    if ($ipv4Ok -and -not $localhostOk) {
        $LocalhostOnlyFailures += 1
    }
}
Write-ReportLine ""

Write-ReportLine "== HTTP curl tests =="
if ($TcpOpenPorts.Count -eq 0) {
    Write-ReportLine "No TCP-open 127.0.0.1 ports found; skipping curl tests."
}
foreach ($port in ($TcpOpenPorts | Sort-Object)) {
    Add-Url ("http://127.0.0.1:{0}/" -f $port)
    Add-Url ("http://localhost:{0}/" -f $port)
}
foreach ($url in ($DiscoveredUrls | Sort-Object)) {
    try {
        $urlPort = ([Uri]$url).Port
        if (-not $TcpOpenPorts.Contains([int]$urlPort)) {
            Write-ReportLine ("curl skipped {0} -> tcp 127.0.0.1:{1} is closed" -f $url, $urlPort)
            continue
        }
    } catch {
        Write-ReportLine ("curl skipped {0} -> invalid URL" -f $url)
        continue
    }
    $default = Test-CurlUrl $url
    Write-ReportLine ("curl default {0} -> {1} ({2})" -f $url, $(if ($default.Ok) { "OK" } else { "FAIL" }), $default.Detail)
    $noProxy = Test-CurlUrl $url -NoProxy
    Write-ReportLine ("curl noproxy {0} -> {1} ({2})" -f $url, $(if ($noProxy.Ok) { "OK" } else { "FAIL" }), $noProxy.Detail)
    if (-not $default.Ok) {
        $CurlDefaultFailures += 1
    }
    if ($noProxy.Ok) {
        $CurlNoProxySuccesses += 1
    }
}
Write-ReportLine ""

Write-ReportLine "== Result =="
if (-not $SelfLoopbackOk) {
    Write-ReportLine "RESULT: basic 127.0.0.1 loopback TCP failed. VDI/firewall is blocking loopback TCP."
} elseif ($TcpOpenPorts.Count -eq 0) {
    Write-ReportLine "RESULT: basic loopback works, but no running Open Design HTTP port was found. Start Open Design, wait for the splash to finish or fail, then run this script again."
} elseif ($CurlDefaultFailures -gt 0 -and $CurlNoProxySuccesses -gt 0) {
    Write-ReportLine "RESULT: TCP works and curl --noproxy works, but default curl has failures. This points to proxy/NO_PROXY handling."
} elseif ($LocalhostOnlyFailures -gt 0) {
    Write-ReportLine "RESULT: 127.0.0.1 works but localhost has failures. This points to localhost/IPv6 handling."
} else {
    Write-ReportLine "RESULT: loopback TCP and HTTP checks passed for discovered Open Design ports. If the app UI still fails, capture the app log with this report."
}
Write-ReportLine ""

Write-ReportLine "== How to read this =="
Write-ReportLine "- self tcp 127.0.0.1 FAIL: VDI/firewall is blocking basic loopback TCP."
Write-ReportLine "- self OK, app port tcp FAIL: app is not running, port discovery is wrong, or only that process is blocked."
Write-ReportLine "- tcp OK, curl default FAIL, curl noproxy OK: proxy/NO_PROXY problem; small env patch may be enough."
Write-ReportLine "- 127.0.0.1 OK, localhost FAIL: localhost/IPv6 mismatch; small host patch may be enough."
Write-ReportLine "- 127.0.0.1 app port FAIL even while app is running: likely real loopback TCP block; use packaged pipe transport."

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputPath = Join-Path (Get-Location) "vdi-loopback-report-$stamp.txt"
}
try {
    Set-Content -Path $OutputPath -Value $Lines -Encoding UTF8
    Write-Host ""
    Write-Host "Report written: $OutputPath" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Warning ("Could not write report: {0}" -f $_.Exception.Message)
}
