// レスト終了のプッシュ通知を組み立てる（Web Push: RFC 8291 の暗号化と VAPID 署名）。
// 暗号化と署名はすべて端末の中で行い、Apps Script は「時間になったら送るだけ」の中継にする。
(function (root) {
  'use strict';
  const subtle = root.crypto.subtle;
  const enc = new TextEncoder();

  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(c => { s += String.fromCharCode(c); }); return btoa(s); };
  const unb64u = s => {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
  };
  const concat = (...arrs) => {
    const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0));
    let o = 0; arrs.forEach(x => { out.set(x, o); o += x.length; });
    return out;
  };

  // 通知を送る側（このアプリ）の鍵。端末ごとに1回だけ作る
  async function generateVapid() {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    const privJwk = await subtle.exportKey('jwk', kp.privateKey);
    return { pub: b64u(pub), privJwk };
  }

  async function vapidAuth(endpoint, vapid, sub) {
    const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = b64u(enc.encode(JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: sub || 'https://maomax0427.github.io/kintore/',
    })));
    const key = await subtle.importKey('jwk', vapid.privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
    return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.pub}`;
  }

  async function hkdf(salt, ikm, info, bytes) {
    const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
  }

  // RFC 8291 (aes128gcm) で本文を暗号化
  async function encrypt(subscription, text) {
    const uaPublic = unb64u(subscription.keys.p256dh);
    const authSecret = unb64u(subscription.keys.auth);
    const as = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const asPublic = new Uint8Array(await subtle.exportKey('raw', as.publicKey));
    const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
    const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const plain = concat(enc.encode(text), new Uint8Array([2]));
    const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
    const rs = new Uint8Array([0, 0, 16, 0]); // 4096
    return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
  }

  // Apps Script にそのまま渡せる形（送り先・ヘッダー・本文）を作る
  async function buildRequest(subscription, vapid, message) {
    const body = await encrypt(subscription, JSON.stringify(message));
    return {
      endpoint: subscription.endpoint,
      headers: {
        Authorization: await vapidAuth(subscription.endpoint, vapid),
        TTL: '120',
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
      },
      body: b64(body),
    };
  }

  const api = { generateVapid, buildRequest, encrypt, vapidAuth, b64u, unb64u };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KintorePush = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
