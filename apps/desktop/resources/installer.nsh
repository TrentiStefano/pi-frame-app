!macro RefreshAppShortcut shortcutPath
  ${if} ${FileExists} "${shortcutPath}"
    Delete "${shortcutPath}"
    CreateShortCut "${shortcutPath}" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "${shortcutPath}" "${APP_ID}"
  ${endIf}
!macroend

!macro customInstall
  !insertmacro RefreshAppShortcut "$newStartMenuLink"
  !insertmacro RefreshAppShortcut "$newDesktopLink"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
