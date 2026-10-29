; Instalador do Muquifo (Inno Setup 6). Gerado por scripts/empacotar.ps1 -Instalador,
; que passa /DAppVersion, /DSourceDir (a pasta montada) e /DOutputDir.
;
; Regras:
; - Instala em C:\Muquifo (fora de "Arquivos de Programas": o banco fica dentro
;   da pasta do software e precisa ser gravável).
; - Nunca mexe em dados\ (banco, senha, backups): nem ao atualizar nem ao desinstalar.
; - Atualizar desliga o Muquifo antes (ele faz backup ao desligar).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\release\Muquifo"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\release"
#endif

[Setup]
AppId={{FF4B2866-5519-4DB7-B772-27D49660C984}
AppName=Muquifo
AppVersion={#AppVersion}
AppVerName=Muquifo {#AppVersion}
AppPublisher=Muquifo
DefaultDirName={sd}\Muquifo
DefaultGroupName=Muquifo
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Muquifo-Instalador-{#AppVersion}
SetupIconFile=..\launcher\muquifo.ico
UninstallDisplayIcon={app}\Muquifo.exe
UninstallDisplayName=Muquifo
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
WizardStyle=modern
PrivilegesRequired=admin
; A chave "ligar com o Windows" vai no usuário que instalou (o do caixa).
UsedUserAreasWarning=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
; O próprio instalador desliga o Muquifo (Muquifo.exe --desligar) antes de copiar.
CloseApplications=no
RestartApplications=no

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
ptbr.WelcomeLabel2=Este assistente vai instalar o Muquifo {#AppVersion} neste computador.%n%nO banco de dados fica dentro da pasta do Muquifo. Se já houver um Muquifo instalado, os dados do restaurante são mantidos.

[Tasks]
Name: "desktopicon"; Description: "Criar um atalho na área de trabalho"; GroupDescription: "Atalhos:"
Name: "autostart"; Description: "Ligar o Muquifo junto com o Windows (recomendado)"; GroupDescription: "Ao ligar o computador:"

[Dirs]
; O Muquifo roda como usuário comum e precisa gravar o banco e os registros.
Name: "{app}\dados"; Permissions: users-modify
Name: "{app}\logs"; Permissions: users-modify

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "\dados\*,\logs\*"; \
  Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Muquifo"; Filename: "{app}\Muquifo.exe"
Name: "{autoprograms}\Muquifo - pasta de dados"; Filename: "{app}\dados"
Name: "{autodesktop}\Muquifo"; Filename: "{app}\Muquifo.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; \
  ValueName: "Muquifo"; ValueData: """{app}\Muquifo.exe"" --minimizado"; \
  Tasks: autostart; Flags: uninsdeletevalue

[Run]
; Celulares e tablets da rede local entram no Muquifo sem o aviso do Windows.
; Vale em qualquer perfil de rede (muitas vezes a do restaurante fica "pública"),
; mas só para aparelhos da mesma rede local.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Muquifo"""; \
  Flags: runhidden; StatusMsg: "Liberando o Muquifo na rede local..."
Filename: "{sys}\netsh.exe"; \
  Parameters: "advfirewall firewall add rule name=""Muquifo"" dir=in action=allow program=""{app}\runtime\node\node.exe"" enable=yes profile=any remoteip=localsubnet protocol=tcp"; \
  Flags: runhidden; StatusMsg: "Liberando o Muquifo na rede local..."
Filename: "{app}\Muquifo.exe"; Description: "Ligar o Muquifo agora"; \
  Flags: postinstall nowait skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{app}\Muquifo.exe"; Parameters: "--desligar"; Flags: runhidden waituntilterminated; RunOnceId: "Desligar"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Muquifo"""; \
  Flags: runhidden; RunOnceId: "Firewall"

[Code]
function IsUnderProgramFiles(Dir: String): Boolean;
var
  D: String;
begin
  D := Lowercase(AddBackslash(Dir));
  Result := (Pos(Lowercase(AddBackslash(ExpandConstant('{commonpf64}'))), D) = 1) or
            (Pos(Lowercase(AddBackslash(ExpandConstant('{commonpf32}'))), D) = 1);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpSelectDir) and IsUnderProgramFiles(WizardDirValue) then
  begin
    MsgBox('Escolha uma pasta fora de "Arquivos de Programas" (por exemplo C:\Muquifo).' + #13#10#13#10 +
      'O banco de dados do restaurante fica dentro da pasta do Muquifo, e o Windows ' +
      'não deixa gravar dados em "Arquivos de Programas".', mbError, MB_OK);
    Result := False;
  end;
end;

{ Atualização: desliga o Muquifo (ele faz backup) antes de trocar os arquivos. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
  Exe: String;
begin
  Result := '';
  Exe := ExpandConstant('{app}\Muquifo.exe');
  if FileExists(Exe) then
  begin
    if not Exec(Exe, '--desligar', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      Result := 'Não foi possível desligar o Muquifo que está rodando. ' +
        'Clique com o botão direito no ícone do Muquifo perto do relógio, escolha ' +
        '"Desligar o Muquifo" e rode o instalador de novo.';
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and DirExists(ExpandConstant('{app}\dados')) and not UninstallSilent then
    MsgBox('Os dados do restaurante foram mantidos em:' + #13#10 + ExpandConstant('{app}\dados') + #13#10#13#10 +
      'Para reinstalar com os mesmos dados, instale o Muquifo na mesma pasta. ' +
      'Se não for mais usar, você pode apagar essa pasta.', mbInformation, MB_OK);
end;
