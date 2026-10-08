/**
 * Youbo — API van de review-tool (Cloudflare Pages Function).
 *
 * Draait op hetzelfde domein als het ontwerp: geen CORS, geen tweede hosting,
 * geen server om bij te houden.
 *
 *   GET  /api/feedback?p=jana&t=JETON      → { pins, counter, name, updated_at }
 *   POST /api/feedback?p=jana&t=JETON      ← { pins, deleted, counter, name }
 *   POST /api/upload?p=jana&t=JETON        ← multipart "photo"   → { url }
 *   POST /api/finalize?p=jana&t=JETON      zegelt een ronde en verwittigt per mail
 *   GET  /api/rounds?p=jana&t=JETON        → de verzonden rondes
 *   POST /api/purge?p=test&t=JETON         wist een TESTproject, en niets anders
 *   GET  /api/photo/<sleutel>              → de afbeelding
 *
 * Verwachte bindings (zie wrangler.toml):
 *   DB (of D1)        D1       de feedback en haar geschiedenis
 *   PHOTOS            KV       de foto's
 *   REVIEW_TOKEN      secret   het jeton dat als wachtwoord geldt
 *   RESEND_API_KEY    secret   (optioneel) voor de mail bij het afsluiten
 *   REVIEW_MAIL_TO    var      (optioneel) ontvanger, standaard sven@membrero.com
 *   REVIEW_MAIL_FROM  var      (optioneel) afzender, moet een adres @membrero.com zijn
 *
 * Fotosleutels zijn willekeurig en niet te raden: een foto opvragen vraagt dus
 * geen jeton, en zo hoeft het jeton niet in elke <img src> te staan.
 */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES   = 4 * 1024 * 1024;
const ALLOWED_IMAGES = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const fail = (status, message) => json({ error: message }, status);

/** Vergelijking in constante tijd: een naïeve vergelijking laat het jeton raden. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Een testproject: `test`, `smoke`, `test-iets`, `smoke2_iets`. Die projecten
   sturen geen mail en zijn de enige die /api/purge mag wissen.
   De `([-_]|$)` aan het eind is er bewust: in de Studio 28-versie stond
   `[-_]` zonder alternatief, waardoor een kaal `p=test` GEEN testproject was —
   het stuurde een echte mail en kon niet gewist worden. Hier heet het
   wegwerpbord `p=test`, dus moet die kale vorm meegerekend worden. */
const IS_TEST = /^(smoke|test)\d*([-_]|$)/;

function projectName(url) {
  const p = (url.searchParams.get('p') || 'jana').toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,40}$/.test(p) ? p : null;
}

/** Niets wat uit de browser komt, wordt ongezien weggeschreven. */
function cleanPayload(data) {
  const pins = Array.isArray(data.pins) ? data.pins : [];
  return {
    pins: pins.slice(0, 500).map((p) => ({
      id:     String(p.id ?? '').slice(0, 40),
      n:      Number.isFinite(+p.n) ? +p.n : 0,
      sel:    String(p.sel ?? '').slice(0, 500),
      rx:     Number.isFinite(+p.rx) ? +p.rx : 0.5,
      ry:     Number.isFinite(+p.ry) ? +p.ry : 0.5,
      ctx:    String(p.ctx ?? '').slice(0, 300),
      text:   String(p.text ?? '').slice(0, 20000),
      status: ['ok', 'change', 'remove'].includes(p.status) ? p.status : 'change',
      mt:     Number.isFinite(+p.mt) ? +p.mt : 0,
      vw:     p.vw === 'phone' ? 'phone' : 'desktop',   // op welk scherm de opmerking is gemaakt
      ver:    String(p.ver ?? '').slice(0, 40),          // op welke versie van het ontwerp
      round:  Number.isFinite(+p.round) ? +p.round : 0,  // 0 = nog niet verzonden
      sealed: !!p.sealed,
      photos: (Array.isArray(p.photos) ? p.photos : [])
        .slice(0, 12)
        .map(String)
        .filter((u) => u.length < 2000),
    })),
    // Grafstenen: zonder deze zou een hier gewiste opmerking terugkomen zodra
    // een ander tabblad opslaat.
    deleted: (Array.isArray(data.deleted) ? data.deleted : [])
      .slice(0, 1000)
      .map((d) => ({ id: String(d.id ?? '').slice(0, 40), mt: Number.isFinite(+d.mt) ? +d.mt : 0 }))
      .filter((d) => d.id),
    counter: Number.isFinite(+data.counter) ? +data.counter : pins.length,
    name:    String(data.name ?? '').slice(0, 120),
  };
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS reviews (
         project    TEXT PRIMARY KEY,
         payload    TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS review_rounds (
         id           INTEGER PRIMARY KEY AUTOINCREMENT,
         project      TEXT NOT NULL,
         round        INTEGER NOT NULL,
         version      TEXT,
         name         TEXT,
         payload      TEXT NOT NULL,
         finalized_at TEXT NOT NULL,
         mail         TEXT
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS review_history (
         id       INTEGER PRIMARY KEY AUTOINCREMENT,
         project  TEXT NOT NULL,
         payload  TEXT NOT NULL,
         saved_at TEXT NOT NULL
       )`
    ),
  ]);
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const path = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean);
  const action = path[0] || '';

  /* ── een foto leest zonder jeton: haar sleutel is al niet te raden ────── */
  if (action === 'photo' && request.method === 'GET') {
    if (!env.PHOTOS) return fail(500, 'fotobewaring niet geconfigureerd');
    const key = path.slice(1).join('/');
    if (!/^[A-Za-z0-9_.:-]{8,120}$/.test(key)) return fail(400, 'ongeldige sleutel');

    const obj = await env.PHOTOS.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!obj || !obj.value) return fail(404, 'foto niet gevonden');
    return new Response(obj.value, {
      headers: {
        'content-type': obj.metadata?.contentType || 'application/octet-stream',
        // de sleutel wijst altijd naar dezelfde inhoud: lang cachen mag
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  /* ── al het andere vraagt het jeton ───────────────────────────────────── */
  /* Twee manieren om het te geven:
     - `?t=…` in het adres: de link die Jana krijgt;
     - de cookie `youbo`, gezet door het optionele wachtwoord op /review.
       Zolang REVIEW_PASSWORD niet bestaat, is alleen de eerste weg in gebruik. */
  const expected = env.REVIEW_TOKEN;
  if (!expected) return fail(500, 'het jeton van de server is niet geconfigureerd');
  const cookie = (request.headers.get('Cookie') || '')
    .split(';').map((x) => x.trim()).find((x) => x.startsWith('youbo='));
  const given = url.searchParams.get('t') || (cookie ? cookie.slice(6) : '') || '';
  if (!safeEqual(expected, given)) return fail(403, 'ongeldige link');

  const project = projectName(url);
  if (!project) return fail(400, 'ongeldig project');
  /* Welke naam de D1-binding heeft, hangt af van wat er in het dashboard is
     gekozen. We nemen beide aan in plaats van een hernoeming op te leggen. */
  const DB = env.DB || env.D1;
  if (!DB) return fail(500, 'database niet geconfigureerd');

  /* ── de feedback ──────────────────────────────────────────────────────── */
  if (action === 'feedback' && request.method === 'GET') {
    await ensureSchema(DB);
    const row = await DB.prepare('SELECT payload, updated_at FROM reviews WHERE project = ?')
      .bind(project)
      .first();
    if (!row) return json({ pins: [], counter: 0, name: '' });
    let payload;
    try { payload = JSON.parse(row.payload); } catch { payload = { pins: [], counter: 0, name: '' }; }
    return json({ ...payload, updated_at: row.updated_at });
  }

  if (action === 'feedback' && request.method === 'POST') {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, 'inhoud te groot');

    let data;
    try { data = JSON.parse(raw); } catch { return fail(400, 'ongeldige inhoud'); }
    if (!data || typeof data !== 'object' || !Array.isArray(data.pins)) {
      return fail(400, 'ongeldige inhoud');
    }

    const clean = cleanPayload(data);
    await ensureSchema(DB);

    /* Het slot zit HIER, niet alleen in de interface. Een verzonden opmerking
       kan niet meer gewijzigd of gewist worden, wat de browser ook stuurt: de
       kopie van de server wordt opnieuw opgelegd. Zonder dit zou een tabblad
       dat openbleef, of een nagemaakte aanvraag, een ronde kunnen herschrijven
       die de klant al ondertekend heeft. */
    const prev = await DB.prepare('SELECT payload FROM reviews WHERE project = ?')
      .bind(project).first();
    if (prev) {
      let old = null;
      try { old = JSON.parse(prev.payload); } catch {}
      const sealed = new Map(
        ((old && old.pins) || []).filter((p) => p.sealed).map((p) => [p.id, p])
      );
      if (sealed.size) {
        const seen = new Set();
        clean.pins = clean.pins.map((p) => {
          if (sealed.has(p.id)) { seen.add(p.id); return sealed.get(p.id); }
          return p;
        });
        // een gezegelde opmerking die de browser "vergeten" was, komt terug
        for (const [id, p] of sealed) if (!seen.has(id)) clean.pins.push(p);
        clean.pins.sort((a, b) => (a.n || 0) - (b.n || 0));
        // en een grafsteen kan een verzonden ronde niet wissen
        clean.deleted = (clean.deleted || []).filter((d) => !sealed.has(d.id));
      }
    }

    /* Voorwaardelijk schrijven. De browser meldt de versie die hij gelezen
       heeft; als de server sindsdien bewogen is (ander tabblad, ander toestel)
       weigeren we en geven we de huidige stand terug om samen te voegen. Zonder
       deze beveiliging overschrijven twee open tabbladen elkaar en verdwijnt er
       feedback. */
    const base = url.searchParams.get('base');
    if (base !== null) {
      const cur = await DB.prepare('SELECT payload, updated_at FROM reviews WHERE project = ?')
        .bind(project).first();
      const curVersion = cur ? cur.updated_at : '';
      if (base !== curVersion) {
        let current = { pins: [], counter: 0, name: '' };
        if (cur) { try { current = JSON.parse(cur.payload); } catch {} }
        return json({ conflict: true, current: { ...current, updated_at: curVersion } }, 409);
      }
    }

    const now = new Date().toISOString();
    const payload = JSON.stringify(clean);
    // Elke versie blijft bewaard: feedback van een klant mag nooit kunnen verdwijnen.
    await DB.batch([
      DB.prepare(
        `INSERT INTO reviews (project, payload, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(project) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
      ).bind(project, payload, now),
      DB.prepare('INSERT INTO review_history (project, payload, saved_at) VALUES (?, ?, ?)')
        .bind(project, payload, now),
    ]);

    return json({ ok: true, count: clean.pins.length, updated_at: now });
  }

  /* ── een foto versturen ───────────────────────────────────────────────── */
  if (action === 'upload' && request.method === 'POST') {
    if (!env.PHOTOS) return fail(500, 'fotobewaring niet geconfigureerd');

    const form = await request.formData();
    const file = form.get('photo');
    if (!file || typeof file === 'string') return fail(400, 'geen bestand');
    if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'foto te zwaar (maximaal 8 MB)');

    const buf = await file.arrayBuffer();
    const type = sniffImage(new Uint8Array(buf));
    if (!type) return fail(415, 'alleen afbeeldingen worden aanvaard');

    const id = crypto.randomUUID().replace(/-/g, '');
    const key = `${project}:${id}.${ALLOWED_IMAGES[type]}`;
    await env.PHOTOS.put(key, buf, {
      metadata: { contentType: type, name: String(file.name || '').slice(0, 120), at: new Date().toISOString() },
    });

    return json({ ok: true, url: `${url.origin}/api/photo/${key}`, key });
  }

  /* ── een ronde afsluiten ──────────────────────────────────────────────── */
  if (action === 'finalize' && request.method === 'POST') {
    await ensureSchema(DB);

    const cur = await DB.prepare('SELECT payload, updated_at FROM reviews WHERE project = ?')
      .bind(project).first();
    if (!cur) return fail(400, 'geen feedback om te versturen');

    let doc;
    try { doc = JSON.parse(cur.payload); } catch { return fail(500, 'onleesbare gegevens'); }

    const open = (doc.pins || []).filter((p) => !p.sealed);
    if (!open.length) return fail(400, 'geen nieuwe feedback om te versturen');

    const last = await DB.prepare('SELECT MAX(round) AS n FROM review_rounds WHERE project = ?')
      .bind(project).first();
    const round = ((last && last.n) || 0) + 1;
    const now = new Date().toISOString();
    const version = String(open.find((p) => p.ver)?.ver || '');

    // Zegelen: deze opmerkingen bewegen niet meer, hier noch in de interface.
    doc.pins = (doc.pins || []).map((p) => (p.sealed ? p : { ...p, sealed: true, round }));
    const payload = JSON.stringify(doc);

    let mail;
    if (IS_TEST.test(project)) {
      mail = 'testproject — geen mail verstuurd';
    } else {
      try { mail = await sendMail(env, project, round, version, doc.name, open, url.origin); }
      catch (e) { mail = 'mislukt: ' + String(e).slice(0, 180); }
    }

    await DB.batch([
      DB.prepare(`INSERT INTO review_rounds (project, round, version, name, payload, finalized_at, mail)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(project, round, version, String(doc.name || ''), JSON.stringify(open), now, mail),
      DB.prepare(`UPDATE reviews SET payload = ?, updated_at = ? WHERE project = ?`)
        .bind(payload, now, project),
    ]);

    return json({ ok: true, round, count: open.length, finalized_at: now, mail });
  }

  /* ── een testproject wissen ───────────────────────────────────────────── */
  if (action === 'purge' && request.method === 'POST') {
    /* Opzettelijk niet in staat een echt project aan te raken: de naam moet
       aankondigen dat het een proef is. Een opruimknop die de feedback van de
       klant kan wissen, is gevaarlijker dan de rommel die ze opruimt. */
    if (!IS_TEST.test(project)) return fail(403, 'alleen testprojecten kunnen gewist worden');
    await ensureSchema(DB);
    await DB.batch([
      DB.prepare('DELETE FROM review_rounds WHERE project = ?').bind(project),
      DB.prepare('DELETE FROM reviews WHERE project = ?').bind(project),
    ]);
    return json({ ok: true, purged: project });
  }

  if (action === 'rounds' && request.method === 'GET') {
    await ensureSchema(DB);
    /* De inhoud van de ronde komt mee: dat is de enige bevroren kopie van wat
       de klant ondertekend heeft, en die moet herleesbaar blijven (back-up en
       haal-feedback.py). */
    const r = await DB.prepare(
      'SELECT round, version, name, finalized_at, mail, payload FROM review_rounds WHERE project = ? ORDER BY round'
    ).bind(project).all();
    const rows = (r.results || []).map((x) => {
      let pins = [];
      try { pins = JSON.parse(x.payload || '[]'); } catch {}
      const { payload, ...rest } = x;
      return { ...rest, count: pins.length, pins };
    });
    return json({ rounds: rows });
  }

  return fail(404, 'onbekende actie');
}

/** Meldt per mail dat de klant klaar is. Zwijgt als Resend niet geconfigureerd is. */
async function sendMail(env, project, round, version, name, pins, origin) {
  const key = env.RESEND_API_KEY;
  if (!key) return 'niet geconfigureerd';

  const to   = env.REVIEW_MAIL_TO   || 'sven@membrero.com';
  /* Het geverifieerde domein bij Resend is de apex membrero.com.
     send.membrero.com draagt alleen de SPF- en MX-records en is GEEN geldige
     afzender: Resend antwoordt dan `403 … domain is not verified`. */
  const from = env.REVIEW_MAIL_FROM || 'Youbo <youbo@membrero.com>';
  const LBL  = { ok: 'Goed zo', change: 'Aanpassen', remove: 'Weghalen' };
  const esc  = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const rows = pins.map((p) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e1ebf0;vertical-align:top;white-space:nowrap">
        <b>${esc(p.n)}</b><br>
        <span style="color:#154e3a;font-size:12px">${esc(LBL[p.status] || p.status)}</span>
        ${p.vw === 'phone' ? '<br><span style="color:#547068;font-size:11px">telefoon</span>' : ''}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e1ebf0">
        ${esc(p.text) || '<i style="color:#8aa39b">(geen tekst)</i>'}
        <div style="color:#547068;font-size:12px;margin-top:4px">&laquo; ${esc(p.ctx)} &raquo;</div>
        ${(p.photos || []).length ? `<div style="font-size:12px;margin-top:4px">${p.photos.length} foto(&apos;s) bijgevoegd</div>` : ''}
      </td>
    </tr>`).join('');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0a3327;max-width:640px">
      <h2 style="font-weight:600">${esc(name) || 'De klant'} is klaar met de feedback</h2>
      <p style="color:#547068">
        Project <b>${esc(project)}</b> — ronde <b>${round}</b> — <b>${pins.length}</b> opmerking(en)
        ${version ? `op ontwerp <code>${esc(version)}</code>` : ''}.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>
      <p style="color:#547068;font-size:13px;margin-top:18px">
        Alles ophalen:<br>
        <code>python3 haal-feedback.py ${esc(origin)}/api HET_JETON ${esc(project)}</code>
      </p>
    </div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from, to: [to],
      subject: `Youbo — ${pins.length} opmerking(en), ronde ${round}`,
      html,
    }),
  });
  if (!r.ok) return `mislukt ${r.status}: ${(await r.text()).slice(0, 160)}`;
  return 'verstuurd naar ' + to;
}

/**
 * Het type wordt uit de eerste bytes bepaald, nooit uit wat de browser
 * aankondigt: een bestand kan liegen over zijn content-type.
 */
function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';
  return null;
}
