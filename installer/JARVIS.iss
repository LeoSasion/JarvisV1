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

#ifnexist SourceDir + "\AgentRuntime\pi.exe"
  #error SourceDir is missing the verified Pi Agent executable.
#endif

#ifnexist SourceDir + "\AgentRuntime\runtime.json"
  #error SourceDir is missing the embedded Pi Agent trust manifest.
#endif

#ifnexist SourceDir + "\AgentRuntime\LICENSE-Pi.txt"
  #error SourceDir is missing the Pi Agent license notice.
#endif

#ifnexist SourceDir + "\AgentRuntime\RUNTIME-SHA256SUMS.txt"
  #error SourceDir is missing the Pi Agent runtime tree receipt.
#endif

#ifnexist SourceDir + "\AgentRuntime\PROVENANCE.txt"
  #error SourceDir is missing the Pi Agent provenance notice.
#endif

#ifnexist SourceDir + "\LICENSE"
  #error SourceDir is missing the JARVIS license.
#endif

#ifnexist SourceDir + "\THIRD_PARTY_NOTICES.md"
  #error SourceDir is missing third-party notices.
#endif

#ifnexist SourceDir + "\SHA256SUMS.txt"
  #error SourceDir is missing the complete release checksum manifest.
#endif

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
MinVersion=10.0.17763
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
Type: filesandordirs; Name: "{app}\AgentRuntime"

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
const
  WebView2ClientKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2MachineClientKey = 'Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasWebView2Runtime(): Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKCU, WebView2ClientKey, 'pv', Version) and
      (Trim(Version) <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, WebView2MachineClientKey, 'pv', Version) and
      (Trim(Version) <> '') and (Version <> '0.0.0.0'));
end;

function InitializeSetup(): Boolean;
begin
  Result := HasWebView2Runtime();
  if not Result then
    MsgBox(
      'JARVIS requires Microsoft Edge WebView2 Runtime.' + #13#10 + #13#10 +
      'Install the Evergreen Runtime from Microsoft, then run this installer again. ' +
      'No Windows shell settings have been changed.',
      mbError,
      MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RegDeleteValue(HKCU, '{#StartupKey}', '{#StartupValue}');
end;
