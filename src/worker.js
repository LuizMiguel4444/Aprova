// Aprova: API gratuita na Cloudflare (Workers + D1). Sem R2, sem cartão.
// O estado do app é um texto JSON opaco guardado em pedaços; os arquivos também (base64 enviado pelo app).

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...h } });
const TX = (t, s = 200, h = {}) => new Response(t, { status: s, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...h } });
const GO = (loc, h = {}) => new Response(null, { status: 303, headers: { location: loc, "cache-control": "no-store", ...h } });
const now = () => Date.now();
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_DAYS = 30;
const STATE_CHUNK = 900000;

const b64u = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const u8 = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - (s.length % 4)) % 4); const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const sha = async (s) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const parts = (s, n) => { const o = []; for (let i = 0; i < s.length; i += n) o.push(s.slice(i, i + n)); return o.length ? o : [""]; };
const quota = (env) => (Math.max(1, +env.QUOTA_MB || 400)) * 1048576;

// ---------- Google: valida o ID token (RS256) com as chaves públicas do Google ----------
let JW = { t: 0, keys: null };
async function jwks(env, force) {
  if (!force && JW.keys && now() - JW.t < 3600e3) return JW.keys;
  const r = await fetch(env.GOOGLE_JWKS_URL || "https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("jwks");
  JW = { t: now(), keys: (await r.json()).keys || [] };
  return JW.keys;
}
async function verifyGoogle(env, tok) {
  const p = String(tok || "").split(".");
  if (p.length !== 3) throw new Error("token");
  const dec = (x) => JSON.parse(new TextDecoder().decode(u8(x)));
  const h = dec(p[0]), c = dec(p[1]);
  if (h.alg !== "RS256") throw new Error("alg");
  let k = (await jwks(env)).find((x) => x.kid === h.kid);
  if (!k) k = (await jwks(env, true)).find((x) => x.kid === h.kid);
  if (!k) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, u8(p[2]), new TextEncoder().encode(p[0] + "." + p[1])))) throw new Error("sig");
  const t = Math.floor(now() / 1000);
  if (!["https://accounts.google.com", "accounts.google.com"].includes(c.iss)) throw new Error("iss");
  if (!env.GOOGLE_CLIENT_ID || c.aud !== env.GOOGLE_CLIENT_ID) throw new Error("aud");
  if (!(c.exp > t - 30)) throw new Error("exp");
  if (c.iat && c.iat > t + 300) throw new Error("iat");
  if (!c.sub || !c.email || !(c.email_verified === true || c.email_verified === "true")) throw new Error("email");
  return c;
}
// Só entram os e-mails listados em ALLOWED_EMAILS (separados por vírgula). Vazio = ninguém entra.
const allowed = (env, email) => String(env.ALLOWED_EMAILS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(String(email || "").toLowerCase());

// ---------- sessão: cookie HttpOnly; no banco fica só o hash do token ----------
const ck = (tok, max) => `aprova_s=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${max}`;
async function login(env, cred, redirect) {
  let c;
  try { c = await verifyGoogle(env, cred); } catch (e) { return redirect ? GO("/?login=erro") : J({ error: "token" }, 401); }
  if (!allowed(env, c.email)) return redirect ? GO("/?login=negado") : J({ error: "forbidden" }, 403);
  const t = now();
  await env.DB.prepare("INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name").bind(c.sub, c.email, c.name || "", t).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(t).run();
  const tok = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)").bind(await sha(tok), c.sub, t + SESSION_DAYS * 864e5).run();
  const h = { "set-cookie": ck(tok, SESSION_DAYS * 86400) };
  return redirect ? GO("/?login=ok", h) : J({ email: c.email, name: c.name || "" }, 200, h);
}
async function whoami(env, req) {
  const m = /(?:^|;\s*)aprova_s=([^;]+)/.exec(req.headers.get("cookie") || "");
  if (!m) return null;
  const r = await env.DB.prepare("SELECT s.user_id id,u.email email,u.name name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?").bind(await sha(m[1]), now()).first();
  return r && allowed(env, r.email) ? r : null;
}
// Pedidos que alteram dados só valem vindos do próprio site.
const sameSite = (req, url) => req.method === "GET" || req.method === "HEAD" || (req.headers.get("origin") === url.origin && req.headers.get("x-aprova") === "1");

async function api(req, env, url) {
  const p = url.pathname, m = req.method;
  if (p === "/api/config" && m === "GET") return J({ ok: true, clientId: env.GOOGLE_CLIENT_ID || "", configured: !!(env.GOOGLE_CLIENT_ID && String(env.ALLOWED_EMAILS || "").trim()) });

  if (p === "/api/auth/google-redirect" && m === "POST") { // retorno do botão do Google (modo redirect)
    const f = await req.formData().catch(() => null);
    const cookie = /(?:^|;\s*)g_csrf_token=([^;]+)/.exec(req.headers.get("cookie") || "");
    if (!f || !cookie || cookie[1] !== f.get("g_csrf_token")) return GO("/?login=erro");
    return login(env, f.get("credential"), true);
  }
  if (!sameSite(req, url)) return J({ error: "origin" }, 403);
  if (p === "/api/auth/google" && m === "POST") { const b = await req.json().catch(() => ({})); return login(env, b.credential, false); }

  const u = await whoami(env, req);
  if (p === "/api/me" && m === "GET") return u ? J({ email: u.email, name: u.name }) : J({ error: "auth" }, 401);
  if (p === "/api/auth/logout" && m === "POST") {
    const c = /(?:^|;\s*)aprova_s=([^;]+)/.exec(req.headers.get("cookie") || "");
    if (c) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(await sha(c[1])).run();
    return J({ ok: true }, 200, { "set-cookie": ck("", 0) });
  }
  if (!u) return J({ error: "auth" }, 401);

  // ----- estado do app (um texto JSON, com controle de versão) -----
  if (p === "/api/state" && m === "GET") {
    for (let i = 0; i < 2; i++) {
      const st = await env.DB.prepare("SELECT rev,parts FROM state WHERE user_id=?").bind(u.id).first();
      if (!st) return new Response(null, { status: 204, headers: { "x-rev": "0", "cache-control": "no-store" } });
      const rows = (await env.DB.prepare("SELECT data FROM chunks WHERE user_id=? AND key=? ORDER BY n").bind(u.id, "s" + st.rev).all()).results;
      if (rows.length === st.parts) return TX(rows.map((r) => r.data).join(""), 200, { "x-rev": String(st.rev) });
    }
    return J({ error: "retry" }, 503);
  }
  if (p === "/api/state" && m === "PUT") {
    const base = +url.searchParams.get("base") || 0, body = await req.text();
    if (body.length > 6e6) return J({ error: "big" }, 413);
    const cur = await env.DB.prepare("SELECT rev FROM state WHERE user_id=?").bind(u.id).first(), cr = cur ? cur.rev : 0;
    if (cr !== base) return J({ error: "conflict", rev: cr }, 409);
    const nr = cr + 1, ps = parts(body, STATE_CHUNK);
    await env.DB.batch(ps.map((d, i) => env.DB.prepare("INSERT OR REPLACE INTO chunks(user_id,key,n,data) VALUES(?,?,?,?)").bind(u.id, "s" + nr, i, d)));
    const sw = cur
      ? await env.DB.prepare("UPDATE state SET rev=?,parts=?,size=?,updated_at=? WHERE user_id=? AND rev=?").bind(nr, ps.length, body.length, now(), u.id, cr).run()
      : await env.DB.prepare("INSERT INTO state(user_id,rev,parts,size,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING").bind(u.id, nr, ps.length, body.length, now()).run();
    if (!sw.meta.changes) { // outro aparelho gravou no meio do caminho
      await env.DB.prepare("DELETE FROM chunks WHERE user_id=? AND key=?").bind(u.id, "s" + nr).run();
      const c2 = await env.DB.prepare("SELECT rev FROM state WHERE user_id=?").bind(u.id).first();
      return J({ error: "conflict", rev: c2 ? c2.rev : 0 }, 409);
    }
    if (cr) await env.DB.prepare("DELETE FROM chunks WHERE user_id=? AND key=?").bind(u.id, "s" + cr).run();
    return J({ rev: nr });
  }

  // ----- arquivos (PDFs, fotos...) em pedaços de texto base64 -----
  if (p === "/api/files" && m === "GET") {
    const r = await env.DB.prepare("SELECT id,name,mime,size,parts,created FROM files WHERE user_id=?").bind(u.id).all();
    const us = await env.DB.prepare("SELECT used FROM users WHERE id=?").bind(u.id).first();
    return J({ now: now(), used: us ? us.used : 0, quota: quota(env), files: r.results });
  }
  let mt = /^\/api\/file\/([^/]+)\/(\d+)$/.exec(p);
  if (mt && m === "PUT") {
    const id = mt[1], n = +mt[2], body = await req.text();
    if (!ID.test(id) || n > 400) return J({ error: "id" }, 400);
    if (body.length > 1000000) return J({ error: "big" }, 413);
    const key = "f:" + id;
    const used = (await env.DB.prepare("SELECT used FROM users WHERE id=?").bind(u.id).first()).used || 0;
    const old = await env.DB.prepare("SELECT length(data) l FROM chunks WHERE user_id=? AND key=? AND n=?").bind(u.id, key, n).first();
    const delta = body.length - (old ? old.l : 0);
    if (used + delta > quota(env)) return J({ error: "quota" }, 413);
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO chunks(user_id,key,n,data) VALUES(?,?,?,?)").bind(u.id, key, n, body),
      env.DB.prepare("UPDATE users SET used=MAX(0,used+?) WHERE id=?").bind(delta, u.id),
    ]);
    return J({ ok: true });
  }
  if (mt && m === "GET") {
    if (!ID.test(mt[1])) return J({ error: "id" }, 400);
    const r = await env.DB.prepare("SELECT data FROM chunks WHERE user_id=? AND key=? AND n=?").bind(u.id, "f:" + mt[1], +mt[2]).first();
    return r ? TX(r.data) : J({ error: "notfound" }, 404);
  }
  mt = /^\/api\/file\/([^/]+)\/done$/.exec(p);
  if (mt && m === "POST") {
    const id = mt[1], b = await req.json().catch(() => ({}));
    if (!ID.test(id) || !(b.parts >= 1 && b.parts <= 401)) return J({ error: "id" }, 400);
    const c = await env.DB.prepare("SELECT COUNT(*) c FROM chunks WHERE user_id=? AND key=?").bind(u.id, "f:" + id).first();
    if (c.c !== b.parts) return J({ error: "incomplete", have: c.c }, 400);
    await env.DB.prepare("INSERT OR REPLACE INTO files(user_id,id,name,mime,size,parts,created) VALUES(?,?,?,?,?,?,?)").bind(u.id, id, String(b.name || "").slice(0, 200), String(b.mime || "").slice(0, 100), +b.size || 0, b.parts, now()).run();
    return J({ ok: true });
  }
  mt = /^\/api\/file\/([^/]+)$/.exec(p);
  if (mt && m === "DELETE") {
    if (!ID.test(mt[1])) return J({ error: "id" }, 400);
    const key = "f:" + mt[1];
    const s = await env.DB.prepare("SELECT COALESCE(SUM(length(data)),0) s FROM chunks WHERE user_id=? AND key=?").bind(u.id, key).first();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM chunks WHERE user_id=? AND key=?").bind(u.id, key),
      env.DB.prepare("DELETE FROM files WHERE user_id=? AND id=?").bind(u.id, mt[1]),
      env.DB.prepare("UPDATE users SET used=MAX(0,used-?) WHERE id=?").bind(s.s || 0, u.id),
    ]);
    return J({ ok: true });
  }
  return J({ error: "notfound" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try { return await api(req, env, url); }
    catch (e) { console.error(e); return J({ error: "server" }, 500); }
  },
};
