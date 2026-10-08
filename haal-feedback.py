#!/usr/bin/env python3
"""Haalt de feedback van de klant op en schrijft ze als leesbare Markdown.

    python3 haal-feedback.py https://youbo-drafts.pages.dev/api JETON [project]

Schrijft FEEDBACK.md naast dit script en zet de foto's in feedback-fotos/.
Beide staan in .gitignore: het is werk van de klant, geen publiek bestand.
"""
import json, os, ssl, sys, urllib.request, urllib.parse


def _ssl_context():
    """Deze Python (build van python.org) heeft geen standaard certificaatopslag:
    zonder dit mislukt elke HTTPS-aanroep met CERTIFICATE_VERIFY_FAILED. We nemen
    die van certifi als die er is, anders die van het systeem."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


CTX = _ssl_context()

# Cloudflare weigert de standaard-agent van Python ("Python-urllib") met een 403:
# er moet er expliciet een meegegeven worden, anders wordt de aanvraag voor een
# robot gehouden.
UA = {"User-Agent": "youbo-haal-feedback/1.0"}


def _open(url, timeout=30):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout, context=CTX)


if len(sys.argv) < 3:
    print(__doc__)
    sys.exit(1)

api, token = sys.argv[1].rstrip("/"), sys.argv[2]
project = sys.argv[3] if len(sys.argv) > 3 else "jana"
here = os.path.dirname(os.path.abspath(__file__))
photo_dir = os.path.join(here, "feedback-fotos")


def api_get(path):
    url = f"{api}/{path}?p={urllib.parse.quote(project)}&t={urllib.parse.quote(token)}"
    with _open(url) as r:
        return json.load(r)


data = api_get("feedback")
try:
    rondes = api_get("rounds").get("rounds", [])
except Exception:
    rondes = []

pins = data.get("pins", [])
LBL = {"ok": "Goed zo", "change": "AANPASSEN", "remove": "WEGHALEN"}
versies = sorted({p.get("ver") or "?" for p in pins})
huidige = versies[-1] if versies else "?"

out = ["# Youbo — feedback van de klant", ""]
if data.get("name"):
    out.append(f"**Door:** {data['name']}")
if data.get("updated_at"):
    out.append(f"**Laatst gewijzigd:** {data['updated_at']}")
out += ["", f"**{len(pins)} opmerking(en).**", ""]
if len(versies) > 1:
    out += [f"> Let op: deze opmerkingen gaan over **meerdere versies** van het ontwerp "
            f"({', '.join(versies)}). Die met « eerdere versie » kunnen geschreven zijn op een "
            f"pagina die sindsdien veranderd is.", ""]

if pins:
    os.makedirs(photo_dir, exist_ok=True)

if rondes:
    out += ["## Verstuurde rondes", ""]
    for t in rondes:
        out.append(f"- **Ronde {t.get('round')}** — {t.get('count', len(t.get('pins') or []))} opmerking(en), "
                   f"ontwerp `{t.get('version') or '?'}`, op {t.get('finalized_at','?')[:16].replace('T',' om ')} "
                   f"· mail: {t.get('mail') or '?'}")
    out.append("")
    open_pins = [p for p in pins if not p.get("sealed")]
    if open_pins:
        out += [f"> {len(open_pins)} opmerking(en) **nog niet verstuurd** — de klant heeft ze niet "
                f"afgerond met de knop « Afronden en versturen ».", ""]
    out += ["---", ""]

for p in pins:
    scherm = " · op telefoon bekeken" if p.get("vw") == "phone" else ""
    ver = p.get("ver") or "?"
    ouder = "  ⚠️ eerdere versie" if ver != huidige else ""
    verzending = f" · ronde {p.get('round')}" if p.get("sealed") else " · NOG NIET VERSTUURD"
    out.append(f"## {p.get('n')} — {LBL.get(p.get('status'), p.get('status'))}{scherm}{verzending}")
    out.append("")
    out.append(f"> Bedoeld element: « {p.get('ctx','')} »")
    out.append(f"> Ontwerp: `{ver}`{ouder}")
    out.append("")
    out.append(p.get("text") or "_(geen tekst)_")
    for i, u in enumerate(p.get("photos") or [], 1):
        name = f"opmerking-{p.get('n')}-{i}{os.path.splitext(urllib.parse.urlparse(u).path)[1] or '.jpg'}"
        dest = os.path.join(photo_dir, name)
        try:
            with _open(u, timeout=60) as src, open(dest, "wb") as dst:
                dst.write(src.read())
            out.append(f"\n![foto {i}](feedback-fotos/{name})")
        except Exception as e:
            out.append(f"\n- foto niet gedownload: {u} ({e})")
    out += ["", f"`{p.get('sel','')}`", ""]

path = os.path.join(here, "FEEDBACK.md")
with open(path, "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print(f"{len(pins)} opmerking(en) → {path}")
