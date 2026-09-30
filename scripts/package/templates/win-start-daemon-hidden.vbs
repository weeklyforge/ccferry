' ccferry client hidden launcher: runs start-daemon.cmd from the install
' directory with no console window (logon tasks are interactive-only).
Dim shell, fso, dir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & fso.BuildPath(dir, "start-daemon.cmd") & """", 0, False
