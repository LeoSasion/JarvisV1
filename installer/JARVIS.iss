#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif

#ifndef MyNumericVersion
  #define MyNumericVersion "0.1.0"
#endif

#ifndef SourceDir
  #error SourceDir must point to a completed JARVIS publish directory.
#endif

#ifndef OutputDir
  #define OutputDir "."
#endif

#define AppName "JARVIS Night Shell"
#define AppExeName "Jarvis.Host.exe"
#define StartupKey "Software\Microsoft\Windows\CurrentVersion\Run"
#define StartupValue "JARVIS Night Shell"

[Setup]
AppId={{3D127645-F2E2-4F10-A50F-A4E4B71CE06E}
AppName={#AppName}
AppVersion={#MyAppVersion}
AppVerName={#AppName} {#MyAppVersion}
AppPublisher=JARVIS
DefaultDirName={localappdata}\Programs\JARVIS
DefaultGroupName=JARVIS
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=JARVIS-Setup-{#MyAppVersion}-win-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
SetupLogging=yes
VersionInfoVersion={#MyNumericVersion}.0
VersionInfoProductName={#AppName}
VersionInfoDescription=JARVIS Windows desktop shell installer

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "autostart"; Description: "Start JARVIS when I sign in to Windows"; GroupDescription: "Startup:"; Flags: unchecked

[InstallDelete]
Type: filesandordirs; Name: "{app}\frontend"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "{#StartupKey}"; ValueType: string; ValueName: "{#StartupValue}"; ValueData: """{app}\{#AppExeName}"" --startup"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RegDeleteValue(HKCU, '{#StartupKey}', '{#StartupValue}');
end;
