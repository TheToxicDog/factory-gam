// A small WebSocket server (RFC 6455) with no dependencies: text and binary messages,
// fragmentation, ping/pong and close. Used by the multiplayer server.
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 24 * 1024 * 1024; // hosting uploads a whole save
const MAX_BUFFERED = 32 * 1024 * 1024; // drop clients that stop reading

class Socket extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frag = null; // { op, parts, size }
    this.open = true;
    this.remote = sock.remoteAddress;
    sock.setNoDelay(true);
    sock.on('data', (d) => this.onData(d));
    sock.on('close', () => this.finish());
    sock.on('error', () => this.finish());
    sock.on('end', () => this.finish());
  }
  finish() {
    if (!this.open) return;
    this.open = false;
    try { this.sock.destroy(); } catch (e) { /* already gone */ }
    this.emit('close');
  }
  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
        if (hi) { this.close(1009); return; }
        len = lo; off = 10;
      }
      if (!masked) { this.close(1002); return; }
      if (len > MAX_MESSAGE) { this.close(1009); return; }
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.frame(fin, op, data);
    }
  }
  frame(fin, op, data) {
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this.raw(0xA, data); return; }
    if (op === 0xA) return;
    if (op === 0x0) {
      if (!this.frag) { this.close(1002); return; }
      this.frag.parts.push(data);
      this.frag.size += data.length;
      if (this.frag.size > MAX_MESSAGE) { this.close(1009); return; }
      if (fin) { const f = this.frag; this.frag = null; this.deliver(f.op, Buffer.concat(f.parts)); }
      return;
    }
    if (op !== 0x1 && op !== 0x2) { this.close(1002); return; }
    if (!fin) { this.frag = { op, parts: [data], size: data.length }; return; }
    this.deliver(op, data);
  }
  deliver(op, data) {
    this.emit('message', op === 0x1 ? data.toString('utf8') : data, op === 0x2);
  }
  raw(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | op;
    if (this.sock.writableLength > MAX_BUFFERED) { this.finish(); return; }
    this.sock.write(head);
    if (len) this.sock.write(payload);
  }
  send(data) {
    if (typeof data === 'string') this.raw(0x1, Buffer.from(data, 'utf8'));
    else this.raw(0x2, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }
  get buffered() { return this.sock.writableLength; }
  close(code) {
    if (!this.open) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code || 1000, 0);
    try { this.raw(0x8, p); this.sock.end(); } catch (e) { /* ignore */ }
    setTimeout(() => this.finish(), 1000).unref();
  }
}

// Complete the upgrade handshake for an HTTP 'upgrade' event. Returns a Socket or null.
function accept(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const hash = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + hash + '\r\n\r\n');
  return new Socket(sock);
}

module.exports = { accept, Socket };
