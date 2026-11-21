; NightShift Coder - Windows installer (per-user, no admin rights needed).
; Built by scripts/build-windows.sh with: makensis -DSRC=<packaged app dir> -DOUT=<setup.exe> -DVERSION=<x.y.z>
Unicode true
!include "MUI2.nsh"

!define APPNAME "NightShift Coder"
!define EXE "NightShift Coder.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NightShiftCoder"

Name "${APPNAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\NightShiftCoder" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ICON "${SRC}\resources\app\electron\icon.ico"
!define MUI_UNICON "${SRC}\resources\app\electron\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open NightShift Coder now"
!define MUI_WELCOMEPAGE_TEXT "This installs NightShift Coder, the offline coding bot.$\r$\n$\r$\nIt adds NightShift Coder to your Start Menu and Desktop. No administrator rights are needed."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "NightShift Coder"

Section "Install"
  ; Close a running copy so files can be replaced.
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\app\electron\icon.ico" 0
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\app\electron\icon.ico" 0
  WriteRegStr HKCU "Software\NightShiftCoder" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "NightShift Coder"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\resources\app\electron\icon.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.NightShift Coder"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NightShift Coder"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\NightShiftCoder"
  RMDir /r "$INSTDIR"
SectionEnd
