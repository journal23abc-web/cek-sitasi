#!/usr/bin/env node
// Server HTTPS lokal untuk mencoba add-in (https://localhost:3000/word-addin/taskpane.html).
// Sertifikat dev dibuat sekali dengan:  npx office-addin-dev-certs install
// Lalu jalankan dari akar repo:         node word-addin/tools/serve.js
var https = require('https');
var fs = require('fs');
var path = require('path');
var os = require('os');

var root = path.resolve(__dirname, '..', '..');
var certDir = path.join(os.homedir(), '.office-addin-dev-certs');
var port = +(process.env.PORT || 3000);
var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.xml': 'application/xml', '.svg': 'image/svg+xml' };

var key, cert;
try {
  key = fs.readFileSync(path.join(certDir, 'localhost.key'));
  cert = fs.readFileSync(path.join(certDir, 'localhost.crt'));
} catch (e) {
  console.error('Sertifikat dev belum ada. Jalankan dulu:  npx office-addin-dev-certs install');
  process.exit(1);
}

https.createServer({ key: key, cert: cert }, function (req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);
  var file = path.normalize(path.join(root, url));
  if (file.indexOf(root) !== 0) { res.writeHead(403); return res.end(); }
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, function () {
  console.log('Cek Sitasi add-in: https://localhost:' + port + '/word-addin/taskpane.html');
  console.log('Demo tanpa Word:   https://localhost:' + port + '/word-addin/demo.html');
});
