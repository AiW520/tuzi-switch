param([switch]$Worker, [string]$Lab, [switch]$ExpectStandard, [switch]$RequireSuccess)
$ErrorActionPreference = 'Stop'

if ($Worker) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $elevated = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($ExpectStandard -and $elevated) { throw 'Test requires a non-administrator token' }
    $encoded = [IO.File]::ReadAllText((Join-Path $Lab 'script.base64'))
    $results = @()
    $names = @('new directory', ([string][char]0x5154 + [char]0x5B50 + ' space & quote'' dollar$'), 'repeat', 'repeat', 'repeat')
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
        $timedOut = -not $process.WaitForExit(60000)
        if ($timedOut) { $process.Kill(); $process.WaitForExit() }
        $entry = @{ case=$name; exitCode=$process.ExitCode; timedOut=$timedOut; stdout=$stdout.Result; stderr=$stderr.Result }
        if ($RequireSuccess -and $process.ExitCode -eq 0) {
            # Independently verify both allowed principals and child inheritance.
            $child = Join-Path $directory 'synthetic.txt'
            [IO.File]::WriteAllText($child, 'SYNTHETIC ACL TEST')
            $security = [IO.File]::GetAccessControl($child)
            $rules = @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
            $allowed = @($identity.User.Value, 'S-1-5-18')
            $entry.childPrivate = ($rules.Count -eq 2)
            foreach ($rule in $rules) {
                if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin $allowed -or
                    $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { $entry.childPrivate = $false }
            }
        }
        $results += $entry
        $process.Dispose()
    }
    $report = @{ elevated=$elevated; os=[Environment]::OSVersion.VersionString; powershell=$PSVersionTable.PSVersion.ToString(); cases=$results }
    $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $Lab 'result.json')
    if ($RequireSuccess -and @($results | Where-Object { $_.exitCode -ne 0 -or -not $_.childPrivate }).Count) { exit 1 }
    exit 0
}

# Disposable hosted runner only. No application profile, credentials or CA is used.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This orchestrator creates a disposable local test user; use only on a GitHub-hosted runner'
}
$source = (git show be5bd7bb2f61cdc289504837bbacc181a24b3d3a:src-tauri/vendor/claude-local/src/backend.rs) -join "`n"
$match = [regex]::Match($source, '(?s)let script = r#"(\$ErrorActionPreference = ''Stop''.*?Unexpected private directory access.*?\n)"#;')
if (-not $match.Success) { throw 'Production ACL script not found' }
$scripts = @{
    baseline = $match.Groups[1].Value
    fixed = [IO.File]::ReadAllText((Join-Path $pwd 'src-tauri/vendor/claude-local/src/private_dir_windows.ps1'))
}
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
    foreach ($variant in @('baseline', 'fixed')) {
      $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($scripts[$variant]))
      foreach ($mode in @('elevated', 'standard')) {
        $labPath = Join-Path $root "$variant-$mode"
        New-Item -ItemType Directory -Path $labPath | Out-Null
        [IO.File]::WriteAllText((Join-Path $labPath 'script.base64'), $encoded)
        Copy-Item $PSCommandPath (Join-Path $labPath 'worker.ps1')
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $labPath 'worker.ps1') + '" -Worker -Lab "' + $labPath + '"'
        $parameters = @{ FilePath=(Join-Path $PSHOME 'powershell.exe'); ArgumentList=$arguments; PassThru=$true; RedirectStandardOutput=(Join-Path $labPath 'worker.stdout'); RedirectStandardError=(Join-Path $labPath 'worker.stderr') }
        if ($mode -eq 'standard') {
            $parameters.Credential = [Management.Automation.PSCredential]::new("$env:COMPUTERNAME\$account", $password)
            $parameters.LoadUserProfile = $true
            $parameters.ArgumentList += ' -ExpectStandard'
        }
        if ($variant -eq 'fixed') { $parameters.ArgumentList += ' -RequireSuccess' }
        $process = Start-Process @parameters
        $process.Handle | Out-Null
        if (-not $process.WaitForExit(300000)) { $process.Kill(); throw 'Test worker timed out' }
        Get-Content (Join-Path $labPath 'worker.stdout')
        Get-Content (Join-Path $labPath 'worker.stderr')
        if (Test-Path (Join-Path $labPath 'result.json')) {
            Copy-Item (Join-Path $labPath 'result.json') "acl-results/$variant-$mode.json"
            Get-Content "acl-results/$variant-$mode.json"
        }
        if ($process.ExitCode -ne 0) { throw "Test worker failed: $variant-$mode (exit=$($process.ExitCode))" }
      }
    }
} finally {
    Remove-LocalUser -Name $account -ErrorAction SilentlyContinue
    # The runner is ephemeral; private test directories may intentionally deny
    # administrator access. Never take ownership or weaken ACLs for cleanup.
}
