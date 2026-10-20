#!/usr/bin/env node
// Membuat manifest add-in Word untuk alamat hosting tertentu.
//   node word-addin/tools/make-manifest.js https://USERNAME.github.io/cek-sitasi/ manifest.xml
//   node word-addin/tools/make-manifest.js https://localhost:3000/ manifest.localhost.xml
// Alamat = folder AKAR repo (tempat engine.js berada), diakhiri "/".
var fs = require('fs');
var path = require('path');

var base = process.argv[2];
var outName = process.argv[3] || 'manifest.xml';
if (!base || !/^https:\/\//.test(base)) {
  console.error('Pakai: node make-manifest.js https://host/path/ [nama-file.xml]   (wajib HTTPS)');
  process.exit(1);
}
if (!/\/$/.test(base)) base += '/';
var addin = base + 'word-addin/';
var isLocal = /localhost/.test(base);
var ID = isLocal ? '9b1f6a52-3c1e-4d0f-9a57-2f0f5e8c3b11' : '4c918475-0a41-4dff-b6d0-89840a4395f8';

function x(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
'<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"\n' +
'           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
'           xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"\n' +
'           xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides"\n' +
'           xsi:type="TaskPaneApp">\n' +
'  <Id>' + ID + '</Id>\n' +
'  <Version>1.0.0.0</Version>\n' +
'  <ProviderName>Journal Tools</ProviderName>\n' +
'  <DefaultLocale>id-ID</DefaultLocale>\n' +
'  <DisplayName DefaultValue="Cek Sitasi' + (isLocal ? ' (dev)' : '') + '" />\n' +
'  <Description DefaultValue="Validator sitasi APA 7 &amp; IEEE dengan saran perbaikan langsung, penautan sitasi ke daftar pustaka, konversi gaya, dan verifikasi referensi via CrossRef." />\n' +
'  <IconUrl DefaultValue="' + x(addin) + 'assets/icon-32.png" />\n' +
'  <HighResolutionIconUrl DefaultValue="' + x(addin) + 'assets/icon-64.png" />\n' +
'  <SupportUrl DefaultValue="https://github.com/journal23abc-web/word-cek-sitasi" />\n' +
'  <AppDomains>\n' +
'    <AppDomain>https://api.crossref.org</AppDomain>\n' +
'    <AppDomain>https://doi.org</AppDomain>\n' +
'  </AppDomains>\n' +
'  <Hosts>\n' +
'    <Host Name="Document" />\n' +
'  </Hosts>\n' +
'  <Requirements>\n' +
'    <Sets DefaultMinVersion="1.1">\n' +
'      <Set Name="WordApi" MinVersion="1.3" />\n' +
'    </Sets>\n' +
'  </Requirements>\n' +
'  <DefaultSettings>\n' +
'    <SourceLocation DefaultValue="' + x(addin) + 'taskpane.html" />\n' +
'  </DefaultSettings>\n' +
'  <Permissions>ReadWriteDocument</Permissions>\n' +
'  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">\n' +
'    <Hosts>\n' +
'      <Host xsi:type="Document">\n' +
'        <DesktopFormFactor>\n' +
'          <GetStarted>\n' +
'            <Title resid="GetStarted.Title" />\n' +
'            <Description resid="GetStarted.Description" />\n' +
'            <LearnMoreUrl resid="GetStarted.LearnMoreUrl" />\n' +
'          </GetStarted>\n' +
'          <FunctionFile resid="Commands.Url" />\n' +
'          <ExtensionPoint xsi:type="PrimaryCommandSurface">\n' +
'            <OfficeTab id="TabHome">\n' +
'              <Group id="CekSitasi.Group">\n' +
'                <Label resid="CS.Brand" />\n' +
'                <Icon>\n' +
'                  <bt:Image size="16" resid="Icon.16x16" />\n' +
'                  <bt:Image size="32" resid="Icon.32x32" />\n' +
'                  <bt:Image size="80" resid="Icon.80x80" />\n' +
'                </Icon>\n' +
'                <Control xsi:type="Button" id="CekSitasi.Open">\n' +
'                  <Label resid="CS.ButtonLabel" />\n' +
'                  <Supertip>\n' +
'                    <Title resid="CS.ButtonLabel" />\n' +
'                    <Description resid="CS.ButtonTip" />\n' +
'                  </Supertip>\n' +
'                  <Icon>\n' +
'                    <bt:Image size="16" resid="Icon.16x16" />\n' +
'                    <bt:Image size="32" resid="Icon.32x32" />\n' +
'                    <bt:Image size="80" resid="Icon.80x80" />\n' +
'                  </Icon>\n' +
'                  <Action xsi:type="ShowTaskpane">\n' +
'                    <TaskpaneId>CekSitasiPane</TaskpaneId>\n' +
'                    <SourceLocation resid="Taskpane.Url" />\n' +
'                  </Action>\n' +
'                </Control>\n' +
'              </Group>\n' +
'            </OfficeTab>\n' +
'          </ExtensionPoint>\n' +
'        </DesktopFormFactor>\n' +
'      </Host>\n' +
'    </Hosts>\n' +
'    <Resources>\n' +
'      <bt:Images>\n' +
'        <bt:Image id="Icon.16x16" DefaultValue="' + x(addin) + 'assets/icon-16.png" />\n' +
'        <bt:Image id="Icon.32x32" DefaultValue="' + x(addin) + 'assets/icon-32.png" />\n' +
'        <bt:Image id="Icon.80x80" DefaultValue="' + x(addin) + 'assets/icon-80.png" />\n' +
'      </bt:Images>\n' +
'      <bt:Urls>\n' +
'        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="https://github.com/journal23abc-web/word-cek-sitasi" />\n' +
'        <bt:Url id="Commands.Url" DefaultValue="' + x(addin) + 'commands.html" />\n' +
'        <bt:Url id="Taskpane.Url" DefaultValue="' + x(addin) + 'taskpane.html" />\n' +
'      </bt:Urls>\n' +
'      <bt:ShortStrings>\n' +
'        <bt:String id="GetStarted.Title" DefaultValue="Cek Sitasi siap dipakai" />\n' +
'        <bt:String id="CS.Brand" DefaultValue="Cek Sitasi" />\n' +
'        <bt:String id="CS.Title" DefaultValue="Saran sitasi" />\n' +
'        <bt:String id="CS.Subtitle" DefaultValue="APA 7 / IEEE" />\n' +
'        <bt:String id="CS.ButtonLabel" DefaultValue="Cek Sitasi" />\n' +
'      </bt:ShortStrings>\n' +
'      <bt:LongStrings>\n' +
'        <bt:String id="GetStarted.Description" DefaultValue="Buka tab Beranda lalu klik Cek Sitasi untuk memeriksa sitasi APA 7 / IEEE." />\n' +
'        <bt:String id="CS.ButtonTip" DefaultValue="Periksa sitasi &amp; daftar pustaka (APA 7 / IEEE), tautkan sitasi, dan konversi gaya." />\n' +
'      </bt:LongStrings>\n' +
'    </Resources>\n' +
'  </VersionOverrides>\n' +
'</OfficeApp>\n';

var out = path.join(__dirname, '..', outName);
fs.writeFileSync(out, xml);
console.log('Manifest ditulis: ' + out + '\n  taskpane: ' + addin + 'taskpane.html');
