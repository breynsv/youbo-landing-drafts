/* ---------------------------------------------------------------------------
   De Tailwind-configuratie van de drie pagina's die naar demo.youbo.io gaan.

   Tot 2026-11-18 stond dit als `tailwind.config = {...}` in elke pagina, en
   maakte de Play-CDN (cdn.tailwindcss.com) de CSS pas in de browser. Dat gaf
   een trage eerste weergave en een flits zonder opmaak, vooral in de browser
   van de LinkedIn-app — en die pagina krijgt betaald LinkedIn-verkeer. Nu bouwt
   `npm run build:css` (bouw-css.mjs) er een vast, geminificeerd bestand van.

   De waarden zijn LETTERLIJK die van de inline-config; de drie pagina's hadden
   dezelfde waarden, alleen het commentaar verschilde. Tailwind staat op 3.4.17,
   precies de versie die de CDN die dag leverde, zodat de uitkomst gelijk is.

   De tokens komen uit DESIGN-youbo-io.md, letterlijk. Het groen is niet
   bijgestuurd. Eén toevoeging, geen wijziging: link.licht voor links op een
   lichte achtergrond (zie hieronder). De huisstijlkleur zelf blijft ongemoeid.

   `content` staat hier alleen voor editors en voor wie `npx tailwindcss` met
   de hand draait. bouw-css.mjs geeft elke bundel haar eigen bronnen mee — zie
   daar waarom.
   --------------------------------------------------------------------------- */
export default {
  content: [
    './draft-r3-01-definitief.html',
    './draft-r3-02-bedankt.html',
    './draft-r3-03-cookies.html',
    './faq-opmaak.js',
    './inhoud-opmaak.js',
    './beheer/voorbeeld.js',
  ],
  theme: {
    extend: {
      colors: {
        brand:   { DEFAULT: '#0af29f', ink: '#154e3a' },   /* primary + primary-text   */
        ink:     { DEFAULT: '#0a3327', soft: '#547068',    /* text-primary + secondary */
                   inv: '#ffffff' },
        paper:   '#ffffff',                                 /* background               */
        surface: '#f6f8fa',                                 /* surface                  */
        line:    { DEFAULT: '#e1ebf0', btn: '#9dbcc2' },    /* border + border-button   */
        /* Het cyaanblauw van de huisstijl haalt op licht de leesnorm niet:
           2,67:1 op wit en 2,51:1 op #f6f8fa, waar 4,5:1 nodig is. Op de
           donkere banden werkt het wél, dus blijft het daar staan. Voor links
           op een lichte achtergrond gebruiken de pagina's de goedgekeurde
           donkerder variant #00718c: 5,61:1 op wit en 5,27:1 op #f6f8fa. */
        link:    { DEFAULT: '#00acd6', hover: '#006c87', licht: '#00718c' },
        night:   { DEFAULT: '#000000', surface: '#031317' },/* dark-background/-surface */
        forest:  '#154e3a',                                 /* gradient-dark-end        */
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        caption: ['15px', { lineHeight: '1.5' }],
        body:    ['17px', { lineHeight: '1.5' }],
        h3:      ['20px', { lineHeight: '1.5' }],
        h2:      ['24px', { lineHeight: '1.2' }],
        h1:      ['36px', { lineHeight: '1.2' }],
        display: ['56px', { lineHeight: '1.2' }],
      },
      /* de spatiëringsschaal 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 80 · 128 */
      spacing: {
        '1': '4px',  '2': '8px',   '3': '12px', '4': '16px', '5': '20px',
        '6': '24px', '8': '32px',  '10': '40px','12': '48px','20': '80px',
        '32': '128px',
      },
      borderRadius: { sm: '8px', DEFAULT: '12px', md: '12px', lg: '24px' },
      maxWidth: { shell: '1280px', text: '34rem', prose: '46rem' },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,.08)',
        lift: '0 4px 12px rgba(0,0,0,.12)',
        panel: '0 24px 60px -28px rgba(0,0,0,.65)',
      },
      transitionDuration: { fast: '150ms', base: '200ms', medium: '300ms', slow: '350ms' },
      transitionTimingFunction: {
        standard:   'ease-in-out',
        decelerate: 'ease-out',
        accelerate: 'cubic-bezier(0, 1, 0.3, 1)',
      },
    },
  },
  /* Klassen die niet letterlijk in een bronbestand staan. Gemeten op
     2026-11-18: elke klasse die tijdens een volledig bezoek (scrollen, FAQ,
     formulier, cookiebalk, op 1440 en 390 breed) ooit op een element stond,
     staat ook letterlijk in de bron. Javascript zet alleen eigen klassen aan
     en uit (is-in, is-vol, sleept, glijdt, js), en die staan als tekst in de
     scripts. Deze lijst is dus leeg — tot iemand een klassennaam in
     javascript in elkaar gaat plakken. Zet hem dan HIER. */
  safelist: [],
  plugins: [],
};
