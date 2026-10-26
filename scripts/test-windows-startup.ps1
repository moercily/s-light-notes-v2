param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:CI -ne 'true') { throw 'This installer smoke test requires a disposable CI runner.' }
if (Get-Process -Name 's-light-notes' -ErrorAction SilentlyContinue) { throw 'An app instance is already running.' }
if (Get-NetTCPConnection -State Listen -LocalPort 8385 -ErrorAction SilentlyContinue) { throw 'The test engine port is occupied.' }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
function Find-Control($root, $id) {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
}
function Wait-Until($description, [scriptblock]$probe, $seconds = 45) {
    $deadline = (Get-Date).AddSeconds($seconds)
    do {
        $value = & $probe
        if ($value) { return $value }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $description"
}

$documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, [Environment+SpecialFolderOption]::DoNotVerify)
[IO.Directory]::CreateDirectory($documents) | Out-Null
$installDir = Join-Path $env:RUNNER_TEMP 'slight-windows-startup'
if (Test-Path $installDir) { throw 'The isolated install directory already exists.' }
$setup = Start-Process -FilePath (Resolve-Path $Installer) -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
$app = Start-Process -FilePath (Join-Path $installDir 's-light-notes.exe') -WindowStyle Normal -PassThru
try {
    $window = Wait-Until 'the application window' {
        $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $app.Id)
        [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $condition)
    }
    Wait-Until 'native storage initialization' {
        (Find-Control $window 'btn-export') -and (Find-Control $window 'btn-open-sticky')
    } | Out-Null
    Wait-Until 'the managed loopback engine' {
        Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort 8385 -ErrorAction SilentlyContinue
    } | Out-Null
    (Find-Control $window 'btn-new-note').GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $editor = Wait-Until 'the editable note' { Find-Control $window 'note-editor' }
    $editor.SetFocus()
    $text = 'QA-Windows-native-startup'
    [Windows.Forms.Clipboard]::SetText($text)
    [Windows.Forms.SendKeys]::SendWait('^v')
    [Windows.Forms.SendKeys]::SendWait('^s')
    $note = Join-Path (Join-Path $documents 's-light-notes') ($text + '.md')
    Wait-Until 'the saved Markdown' {
        (Test-Path $note) -and ([IO.File]::ReadAllText($note).Trim() -eq $text)
    } | Out-Null
    [Windows.Forms.SendKeys]::SendWait('%{F4}')
    if (!$app.WaitForExit(15000)) { throw 'The app did not finish a normal close.' }
    Wait-Until 'managed engine shutdown' {
        !(Get-NetTCPConnection -State Listen -LocalPort 8385 -ErrorAction SilentlyContinue)
    } | Out-Null
    Write-Output 'Windows installed app: native storage, engine, editor save and normal close passed.'
} finally {
    if (!$app.HasExited) { & taskkill.exe /T /F /PID $app.Id | Out-Null }
}
