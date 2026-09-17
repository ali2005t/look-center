[Setup]
AppName=LOOK CASHIER
AppVersion=2.0.0
AppPublisher=ENG.LOL
AppPublisherURL=https://englol.com
AppSupportURL=https://englol.com
AppUpdatesURL=https://englol.com
DefaultDirName={pf}\LOOK CASHIER
DefaultGroupName=LOOK CASHIER
OutputBaseFilename=LOOK-CASHIER-Setup-v2.0.0
OutputDir=.
Compression=lzma
SolidCompression=yes
VersionInfoVersion=2.0.0.0
VersionInfoCompany=ENG.LOL
VersionInfoDescription=School Management System
VersionInfoCopyright=Copyright © 2025 ENG.LOL
UninstallDisplayIcon={app}\LOOK-CASHIER.exe
PrivilegesRequired=admin
AllowNoIcons=yes
AllowUNCPath=no
ArchitecturesAllowed=x86 x64
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "LOOK-CASHIER-win32-ia32\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\LOOK CASHIER"; Filename: "{app}\LOOK-CASHIER.exe"
Name: "{group}\{cm:UninstallProgram,LOOK CASHIER}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\LOOK CASHIER"; Filename: "{app}\LOOK-CASHIER.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\LOOK-CASHIER.exe"; Description: "{cm:LaunchProgram,LOOK CASHIER}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: dirifempty; Name: "{app}"
Type: dirifempty; Name: "{group}"
Type: files; Name: "{app}\*"
