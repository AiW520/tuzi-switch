param([switch]$Worker, [string]$Lab, [switch]$ExpectStandard)
$ErrorActionPreference = 'Stop'

if ($Worker) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $elevated = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($ExpectStandard -and $elevated) { throw 'Test requires a non-administrator token' }
    $encoded = [IO.File]::ReadAllText((Join-Path $Lab 'script.base64'))
    $results = @()
    $names = @('new directory', ([string][char]0x5154 + [char]0x5B50 + ' space & quote'' dollar$'), 'repeat', 'repeat')
    foreach ($name in $names) {
        $directory = Join-Path $Lab $name
        [IO.Directory]::CreateDirectory($directory) | Out-Null
        $info = [Diagnostics.ProcessStartInfo]::new()
        $info.FileName = Join-Path $PSHOME 'powershell.exe'
        $info.Arguments = '-NoProfile -NonInteractive -EncodedCommand ' + $encoded
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.EnvironmentVariables['TUZI_CLAUDE_PRIVATE_DIR'] = $directory
        $process = [Diagnostics.Process]::new()
        $process.StartInfo = $info
        $process.Start() | Out-Null
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'ACL probe timed out' }
        $results += @{ case=$name; exitCode=$process.ExitCode; stdout=$stdout.Result; stderr=$stderr.Result }
        $process.Dispose()
    }
    $report = @{ elevated=$elevated; os=[Environment]::OSVersion.VersionString; powershell=$PSVersionTable.PSVersion.ToString(); cases=$results }
    $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $Lab 'result.json')
    exit 0
}

# Disposable hosted runner only. No application profile, credentials or CA is used.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This orchestrator creates a disposable local test user; use only on a GitHub-hosted runner'
}
$source = Get-Content -Raw 'src-tauri/vendor/claude-local/src/backend.rs'
$match = [regex]::Match($source, '(?s)let script = r#"(\$ErrorActionPreference = ''Stop''.*?Unexpected private directory access.*?\n)"#;')
if (-not $match.Success) { throw 'Production ACL script not found' }
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($match.Groups[1].Value))
$root = Join-Path $env:RUNNER_TEMP ('tuzi-acl-' + [guid]::NewGuid().ToString('N'))
$account = 'TuziAclProbe'
$password = ConvertTo-SecureString ('aA1!' + [guid]::NewGuid().ToString('N')) -AsPlainText -Force
New-Item -ItemType Directory -Path $root | Out-Null
New-Item -ItemType Directory -Force -Path 'acl-results' | Out-Null
try {
    New-LocalUser -Name $account -Password $password -AccountNeverExpires | Out-Null
    Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $account
    $sid = (Get-LocalUser $account).SID.Value
    & icacls.exe $root /grant "*${sid}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant disposable test workspace access' }
    foreach ($mode in @('elevated', 'standard')) {
        $labPath = Join-Path $root $mode
        New-Item -ItemType Directory -Path $labPath | Out-Null
        [IO.File]::WriteAllText((Join-Path $labPath 'script.base64'), $encoded)
        Copy-Item $PSCommandPath (Join-Path $labPath 'worker.ps1')
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $labPath 'worker.ps1') + '" -Worker -Lab "' + $labPath + '"'
        $parameters = @{ FilePath=(Join-Path $PSHOME 'powershell.exe'); ArgumentList=$arguments; PassThru=$true }
        if ($mode -eq 'standard') {
            $parameters.Credential = [Management.Automation.PSCredential]::new("$env:COMPUTERNAME\$account", $password)
            $parameters.LoadUserProfile = $true
            $parameters.ArgumentList += ' -ExpectStandard'
        }
        $process = Start-Process @parameters
        if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'Test worker timed out' }
        if ($process.ExitCode -ne 0) { throw "Test worker failed: $mode" }
        Copy-Item (Join-Path $labPath 'result.json') "acl-results/$mode.json"
        Get-Content "acl-results/$mode.json"
    }
} finally {
    Remove-LocalUser -Name $account -ErrorAction SilentlyContinue
    # The runner is ephemeral; private test directories may intentionally deny
    # administrator access. Never take ownership or weaken ACLs for cleanup.
}
