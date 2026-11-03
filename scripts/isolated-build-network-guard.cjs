/** Preloaded in the isolated build and every Node worker. Fail visibly before any network I/O. */
const denied = operation => function () { if(process.env.FM_ISOLATED_BUILD_NETWORK_LOG)require('node:fs').appendFileSync(process.env.FM_ISOLATED_BUILD_NETWORK_LOG,operation+'\n');throw new Error(`Isolated production build refused network I/O (${operation}).`); };
globalThis.fetch = denied('fetch');
const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https'), http2 = require('node:http2'), dns = require('node:dns');
net.connect = denied('net.connect'); net.createConnection = denied('net.createConnection'); net.Socket.prototype.connect = denied('Socket.connect');
tls.connect = denied('tls.connect');
http.request = denied('http.request'); http.get = denied('http.get'); https.request = denied('https.request'); https.get = denied('https.get'); http2.connect = denied('http2.connect');
for (const name of ['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']) {
  if (typeof dns[name] === 'function') dns[name] = denied(`dns.${name}`);
  if (typeof dns.promises[name] === 'function') dns.promises[name] = denied(`dns.promises.${name}`);
}
