; Instalador do Agente de Impressão (Delivery) — gera um .exe com wizard.
; Compilar: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" instalador.iss

#define MyAppName "LTNK"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "LTNK"
#define MyAppExeName "LTNK.exe"

[Setup]
AppId={{B7E1F6B0-3A6A-4C7C-9C60-DELIVERYPRINT}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\DeliveryAgenteImpressao
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=AgenteImpressao-Instalador
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
DisableWelcomePage=no
SetupIconFile=icone.ico

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos adicionais:"
Name: "startupicon"; Description: "Iniciar automaticamente com o Windows (recomendado)"; GroupDescription: "Inicialização:"; Flags: checkedonce

[Files]
Source: "dist\AgenteImpressao.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
Source: "EditorCupomFiscal.url"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Editor do Cupom Fiscal"; Filename: "{app}\EditorCupomFiscal.url"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{autodesktop}\Editor do Cupom Fiscal"; Filename: "{app}\EditorCupomFiscal.url"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startupicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir o Agente de Impressão agora"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM {#MyAppExeName} /F"; Flags: runhidden skipifdoesntexist; RunOnceId: "StopAgente"
