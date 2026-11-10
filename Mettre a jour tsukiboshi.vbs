' tsukiboshi : mise a jour en un double-clic, sans aucune fenetre.
' Lance maj\maj.ps1 avec PowerShell en mode cache (pas d'invite de commande).
' Un petit message s'affiche a la fin : "a jour", "mise a jour faite" ou la raison d'un echec.
Option Explicit
Dim fso, sh, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\maj\maj.ps1""", 0, False
