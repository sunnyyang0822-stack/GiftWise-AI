import {appendFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
const deny = () => {
  appendFileSync(new URL('./network-attempts.jsonl', import.meta.url), JSON.stringify({pid:process.pid, blocked:true})+'\n');
  throw new Error('This UI fixture regression must not make network requests');
};
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
