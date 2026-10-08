# Puts a "D7 Program" shortcut on the desktop that starts launcher\D7-Program.bat
# Run: powershell -ExecutionPolicy Bypass -File launcher\create-desktop-shortcut.ps1
# To change the icon: put an .ico file at launcher\icon.ico (it wins over the app's own icon) and run this again, or right-click the shortcut > Properties > Change Icon.
$bat = Join-Path $PSScriptRoot "D7-Program.bat"
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop "D7 Program.lnk"))
$link.TargetPath = $bat
$link.WorkingDirectory = $PSScriptRoot
$link.WindowStyle = 1
$link.Description = "D7 Program: the latest work, or the stable version from GitHub"
$own = Join-Path $PSScriptRoot "icon.ico"
$app = Join-Path (Split-Path $PSScriptRoot) "app\favicon.ico"
if (Test-Path $own) { $link.IconLocation = $own }
elseif (Test-Path $app) { $link.IconLocation = $app }
else { $link.IconLocation = "$env:SystemRoot\System32\shell32.dll,13" }
$link.Save()
Write-Output "Shortcut made: $($link.FullName) (icon: $($link.IconLocation))"
