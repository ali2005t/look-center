; LOOK CASHIER Installer Script
; This script creates a Windows installer for LOOK CASHIER application

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; ======================
; General Settings
; ======================
Name "LOOK CASHIER v2.0.0"
OutFile "LOOK-CASHIER-Setup-v2.0.0.exe"
InstallDir "$PROGRAMFILES\LOOK CASHIER"
InstallDirRegKey HKLM "Software\LOOK CASHIER" "InstallLocation"
RequestExecutionLevel admin

; ======================
; MUI Settings
; ======================
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "Arabic"
!insertmacro MUI_LANGUAGE "English"

; ======================
; Installation Section
; ======================
Section "Install"
  SetOutPath "$INSTDIR"
  
  ; Copy all application files
  File /r "LOOK-CASHIER-win32-ia32\*.*"
  
  ; Create start menu shortcuts
  CreateDirectory "$SMPROGRAMS\LOOK CASHIER"
  CreateShortcut "$SMPROGRAMS\LOOK CASHIER\LOOK CASHIER.lnk" "$INSTDIR\LOOK-CASHIER.exe"
  CreateShortcut "$SMPROGRAMS\LOOK CASHIER\Uninstall.lnk" "$INSTDIR\uninstall.exe"
  
  ; Create desktop shortcut
  CreateShortcut "$DESKTOP\LOOK CASHIER.lnk" "$INSTDIR\LOOK-CASHIER.exe"
  
  ; Write installation info to registry
  WriteRegStr HKLM "Software\LOOK CASHIER" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\LOOK CASHIER" "Version" "2.0.0"
  WriteRegStr HKLM "Software\LOOK CASHIER" "Publisher" "ENG.LOL"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LOOK CASHIER" "DisplayName" "LOOK CASHIER v2.0.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LOOK CASHIER" "DisplayVersion" "2.0.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LOOK CASHIER" "Publisher" "ENG.LOL"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LOOK CASHIER" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LOOK CASHIER" "InstallLocation" "$INSTDIR"
  
  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; ======================
; Uninstall Section
; ======================
Section "Uninstall"
  RMDir /r "$INSTDIR"
  RMDir /r "$SMPROGRAMS\LOOK CASHIER"
  Delete "$DESKTOP\LOOK CASHIER.lnk"
  DeleteRegKey HKLM "Software\LOOK CASHIER"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\LOOK CASHIER"
SectionEnd

; ======================
; Functions
; ======================
Function .onInit
  ; Set language based on system language
  StrCpy $0 ${LANG_ARABIC}
  StrCpy $1 ${LANG_ENGLISH}
FunctionEnd
