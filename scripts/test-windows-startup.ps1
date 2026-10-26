param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:CI -ne 'true') { throw 'This installer smoke test requires a disposable CI runner.' }
if (Get-Process -Name 's-light-notes' -ErrorAction SilentlyContinue) { throw 'An app instance is already running.' }
if (Get-NetTCPConnection -State Listen -LocalPort 8385 -ErrorAction SilentlyContinue) { throw 'The test engine port is occupied.' }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class SlightWindow {
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
function Find-Control($root, $id) {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
}
function Click-Control($root, $id) {
    $control = Find-Control $root $id
    if (!$control) { throw "Missing UI control: $id" }
    $pattern = $null
    if ($control.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
    } elseif ($control.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        $pattern.Toggle()
    } else { throw "No Invoke/Toggle pattern for $id" }
}
function Contains-AccessibleText($root, $text) {
    $pattern = $null
    if ($root.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
        if ($pattern.DocumentRange.GetText(-1).Contains($text)) { return $true }
    }
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $text)
    return $null -ne $root.FindFirst([Windows.Automation.TreeScope]::Subtree, $condition)
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
$settingsDirectory = Join-Path $env:APPDATA 'com.slightnotes.v2'
[IO.Directory]::CreateDirectory($settingsDirectory) | Out-Null
$settingsPath = Join-Path $settingsDirectory 'sticky-settings.json'
if (Test-Path $settingsPath) { throw 'Refusing to overwrite pre-existing sticky settings.' }
[IO.File]::WriteAllText($settingsPath, '{"shortcut":"Control+Alt+N","placements":{}}')
$qaDirectory = Join-Path (Get-Location) 'release/qa'
[IO.Directory]::CreateDirectory($qaDirectory) | Out-Null
$report = @{ passed = $false; environment = 'Disposable Windows CI VM; installed NSIS; UI Automation'; installerSha256 = (Get-FileHash $Installer -Algorithm SHA256).Hash.ToLower() }
$other = $null
$debugListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$debugListener.Start()
$debugPort = $debugListener.LocalEndpoint.Port
$debugListener.Stop()
$oldBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort --remote-debugging-address=127.0.0.1"
$app = Start-Process -FilePath (Join-Path $installDir 's-light-notes.exe') -WindowStyle Normal -PassThru
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $oldBrowserArguments
try {
    & node --experimental-websocket scripts/test-windows-cache.mjs $debugPort
    if ($LASTEXITCODE -ne 0) { throw 'Installed native cache migration check failed.' }
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
    Click-Control $window 'btn-open-sticky'
    $sticky = Wait-Until 'the native sticky window' {
        $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $app.Id)
        $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)
        foreach ($candidate in $windows) { if (Find-Control $candidate 'sticky-pin') { return $candidate } }
    }
    Wait-Until 'the existing note loading in the sticky editor' {
        Contains-AccessibleText (Find-Control $sticky 'note-editor') $text
    } | Out-Null
    Click-Control $sticky 'sticky-pin'
    Wait-Until 'the sticky HWND becoming topmost' {
        ([SlightWindow]::GetWindowLong([IntPtr]$sticky.Current.NativeWindowHandle, -20) -band 8) -ne 0
    } | Out-Null
    Click-Control $sticky 'sticky-pin'
    Wait-Until 'the sticky HWND leaving topmost' {
        ([SlightWindow]::GetWindowLong([IntPtr]$sticky.Current.NativeWindowHandle, -20) -band 8) -eq 0
    } | Out-Null
    (Find-Control $sticky 'note-editor').SetFocus()
    [Windows.Forms.SendKeys]::SendWait('^{END}')
    [Windows.Forms.SendKeys]::SendWait(' sticky-edited')
    [Windows.Forms.SendKeys]::SendWait('^s')
    Wait-Until 'the sticky edit reaching Markdown' {
        @(Get-ChildItem (Join-Path $documents 's-light-notes') -Filter '*.md' | Where-Object {
            [IO.File]::ReadAllText($_.FullName).Trim() -eq "$text sticky-edited"
        }).Count -eq 1
    } | Out-Null
    Click-Control $sticky 'sticky-close'
    Wait-Until 'the sticky window closing' {
        try { $null = $sticky.Current.Name; return $false } catch { return $true }
    } | Out-Null
    # A separate guest application owns focus while the OS dispatches the binding.
    $other = Start-Process notepad.exe -PassThru
    Wait-Until 'the other guest application window' { $other.Refresh(); $other.MainWindowHandle -ne 0 } | Out-Null
    [SlightWindow]::SetForegroundWindow($other.MainWindowHandle) | Out-Null
    [Windows.Forms.SendKeys]::SendWait('^%n')
    $shortcutSticky = Wait-Until 'the global shortcut creating a sticky from another app' {
        $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $app.Id)
        $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)
        foreach ($candidate in $windows) { if (Find-Control $candidate 'sticky-pin') { return $candidate } }
    }
    Click-Control $shortcutSticky 'sticky-close'
    Wait-Until 'the shortcut sticky closing' {
        try { $null = $shortcutSticky.Current.Name; return $false } catch { return $true }
    } | Out-Null
    [SlightWindow]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle) | Out-Null
    $editor.SetFocus()
    [Windows.Forms.SendKeys]::SendWait('%{F4}')
    if (!$app.WaitForExit(15000)) { throw 'The app did not finish a normal close.' }
    Wait-Until 'managed engine shutdown' {
        !(Get-NetTCPConnection -State Listen -LocalPort 8385 -ErrorAction SilentlyContinue)
    } | Out-Null
    $report.passed = $true
    $report.checks = @('real legacy worker/cache recovery preserves data', 'native storage', 'engine', 'editor save', 'sticky edit', 'native topmost toggle', 'global shortcut from Notepad', 'normal close and engine stop')
    Write-Output 'Windows installed app: storage, editor, sticky, topmost, global shortcut and shutdown passed.'
} catch {
    $report.error = $_.Exception.Message
    $report.location = $_.ScriptStackTrace
    throw
} finally {
    if (!$app.HasExited) { & taskkill.exe /T /F /PID $app.Id | Out-Null }
    if ($other -and !$other.HasExited) { Stop-Process -Id $other.Id -Force }
    $report | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $qaDirectory 'windows-installed.json')
}
