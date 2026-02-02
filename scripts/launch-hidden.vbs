' Voice Mirror - Hidden window launcher for Windows
' Launches the Electron app without showing a console window.
' Used by the desktop shortcut created during setup.

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = projectDir

' Find node.exe
nodeExe = "node.exe"

' Launch scripts/launch.js with hidden window (vbHide = 0)
shell.Run """" & nodeExe & """ """ & scriptDir & "\launch.js""", 0, False
