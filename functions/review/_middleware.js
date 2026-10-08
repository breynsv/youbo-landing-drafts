/**
 * Poort op alles wat onder /review leeft.
 *
 * Standaard geldt hier precies wat REVIEWTOOL.md belooft: **het jeton in het
 * adres is het wachtwoord**. Deze middleware laat alleen door wat `?t=` met het
 * juiste jeton meebrengt, en zet `x-robots-tag: noindex` op het antwoord.
 *
 * Er zit één opwaardering klaar, uit de Studio 28-versie. Zet je
 * REVIEW_PASSWORD, dan vraagt de browser om naam en wachtwoord en krijgt de
 * bezoeker daarna een HttpOnly-cookie met het jeton erin. Jana hoeft dan geen
 * link met een jeton meer te bewaren, en het jeton staat niet langer in een
 * browsergeschiedenis of een doorgestuurde mail. Zolang die variabele niet
 * bestaat, verandert er niets — de poort is nooit zwakker dan het jeton.
 *
 * Verwachte variabelen (Cloudflare → Settings → Environment variables):
 *   REVIEW_TOKEN     het jeton dat de API al controleert (secret)
 *   REVIEW_PASSWORD  optioneel wachtwoord (secret) — laat leeg om het jeton te gebruiken
 *   REVIEW_USER      optionele naam bij dat wachtwoord (standaard: youbo)
 *
 * Let op: Functions draaien alleen op Cloudflare Pages. Dezelfde repo wordt ook
 * door GitHub Pages gepubliceerd, en daar is deze poort er niet. De tool zelf
 * staat daarom op noindex en in robots.txt, en belangrijker: zonder API bewaart
 * ze niets — alle feedback leeft achter het jeton in D1, niet in de pagina.
 */

/** Vergelijking in constante tijd: een naïeve vergelijking laat het geheim raden. */
function gelijk(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const VRAAG = () =>
  new Response(
    'Deze ruimte is afgeschermd. Vraag de link of het wachtwoord aan Sven.',
    {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Youbo — reviewruimte", charset="UTF-8"',
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );

/** next() precies één keer: elke extra aanroep herstart de hele keten. */
async function doorlaten(next, env, metCookie) {
  const r = await next();
  const uit = new Response(r.body, r);
  uit.headers.set('cache-control', 'no-store');
  uit.headers.set('x-robots-tag', 'noindex, nofollow');
  if (metCookie && env.REVIEW_TOKEN) {
    uit.headers.append(
      'Set-Cookie',
      `youbo=${env.REVIEW_TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    );
  }
  return uit;
}

export async function onRequest({ request, env, next }) {
  const verwacht = env.REVIEW_PASSWORD;

  // Geen wachtwoord gezet: het jeton in het adres is de poort.
  if (!verwacht) {
    const url = new URL(request.url);
    const cookie = (request.headers.get('Cookie') || '')
      .split(';').map((x) => x.trim()).find((x) => x.startsWith('youbo='));
    const gegeven = url.searchParams.get('t') || (cookie ? cookie.slice(6) : '') || '';
    if (env.REVIEW_TOKEN && gelijk(gegeven, env.REVIEW_TOKEN)) {
      return doorlaten(next, env, false);
    }
    return VRAAG();
  }

  const kop = request.headers.get('Authorization') || '';
  if (!kop.startsWith('Basic ')) return VRAAG();

  let naam = '', woord = '';
  try {
    const ruw = atob(kop.slice(6));
    const i = ruw.indexOf(':');
    naam  = ruw.slice(0, i);
    woord = ruw.slice(i + 1);
  } catch {
    return VRAAG();
  }

  if (!gelijk(naam, env.REVIEW_USER || 'youbo') || !gelijk(woord, verwacht)) return VRAAG();
  return doorlaten(next, env, true);
}
