"""Builds herepup.health's static pages with one shared header, footer and search-engine head.
Run from the repo root: python3 _tools/build_site.py .
(Jekyll skips folders starting with "_", so this file is not published.)
Privacy, terms and insurers keep their own content: edit inside their <main>, then rebuild.
Existing page addresses are kept (/privacy/, /terms/, /insurers/ are linked from outside)."""
import html, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(sys.argv[1])
BASE = "https://herepup.health"
TODAY = "2026-10-18"
E = lambda s: html.escape(s, quote=True)

PLAUSIBLE = '''<!-- Privacy-friendly analytics by Plausible: anonymous visit and step counts, no cookies. Details: /privacy/#usage -->
<script async src="https://plausible.io/js/pa-WZOZ27ZALJ2IHCY8AwOFf.js"></script>
<script>
  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
  plausible.init({outboundLinks:false,fileDownloads:false,formSubmissions:false})
</script>'''

ORG = {"@type": "Organization", "@id": BASE + "/#org", "name": "HerePup", "url": BASE + "/",
       "logo": BASE + "/assets/icon-512.png", "email": "chris@herepup.health"}
SITE = {"@type": "WebSite", "@id": BASE + "/#website", "url": BASE + "/", "name": "HerePup",
        "alternateName": "HerePup | Pick yoUr Plan", "publisher": {"@id": BASE + "/#org"}}
APP = {"@type": "WebApplication", "@id": BASE + "/app/#app", "name": "HerePup | Pick yoUr Plan", "url": BASE + "/app/",
       "applicationCategory": "FinanceApplication", "operatingSystem": "Any (runs in a web browser)",
       "browserRequirements": "Requires JavaScript",
       "description": "Estimates what every health plan your household can enroll in, across employers, is likely to cost, using a model "
                      "built from your own claims history and each plan's premiums, deductibles, copays, coinsurance and HSA contributions. "
                      "Use it at open enrollment or any time your coverage options change. Runs in your browser; your files are not uploaded.",
       "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}, "publisher": {"@id": BASE + "/#org"}}


def crumbs_ld(trail):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": BASE + p} for i, (n, p) in enumerate(trail)]}


def head(title, desc, path, ld=(), robots="", og_title=None, analytics=True, extra=""):
    url = BASE + path
    graph = json.dumps({"@context": "https://schema.org", "@graph": list(ld)}, ensure_ascii=False, indent=1) if ld else ""
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
{'<meta name="robots" content="' + robots + '">' if robots else '<link rel="canonical" href="' + url + '">'}
<meta property="og:type" content="website">
<meta property="og:site_name" content="HerePup">
<meta property="og:title" content="{E(og_title or title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/assets/herepup-social.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="HerePup's golden retriever mascot with the words: Pick the health plan that costs you least, using your own claims, privately, right in your browser.">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta name="theme-color" content="#F6F8F7">
<link rel="stylesheet" href="/assets/site.css">
{'<script type="application/ld+json">' + chr(10) + graph + chr(10) + '</script>' if graph else ''}
{PLAUSIBLE if analytics else extra}
</head>'''


LOGO = ('<a class="logo" href="/" aria-label="HerePup home"><picture><source srcset="/assets/herepup-mascot-sm.webp" type="image/webp">'
        '<img src="/assets/herepup-mascot-sm.png" alt="" width="56" height="44"></picture><b>Here<span>Pup</span></b></a>')


def header(active=None):
    tab = lambda key, href, label, cls="": (f'<a href="{href}"' + (f' class="{cls}"' if cls else "")
                                            + (' aria-current="page"' if active == key else "") + f'>{label}</a>')
    return (f'<header class="top">\n  {LOGO}\n  <nav class="tabs" aria-label="Main">'
            + tab("try", "/app/", "Try it", "try") + tab("how", "/how-it-works/", "How it works") + tab("about", "/about/", "About")
            + '</nav>\n</header>')


FOOTER = '''<footer>
  <nav aria-label="Footer"><a href="/app/">Try it</a><a href="/how-it-works/">How it works</a><a href="/about/">About</a><a href="/about/#faq">FAQ</a><a href="/insurers/">Insurer connections</a><a href="/privacy/">Privacy policy</a><a href="/terms/">Terms of use</a><a href="/contact/">Contact</a></nav>
  <div class="fine">&copy; 2026 HerePup. Estimates, not insurance advice.</div>
</footer>'''


def page(path, title, desc, body, active=None, ld=(), robots="", og_title=None, tail="", analytics=True, extra=""):
    out = head(title, desc, path, ld, robots, og_title, analytics, extra) + f'''
<body>
<div class="wrap">
{header(active)}

{body.strip()}

{FOOTER}
</div>
{tail}</body>
</html>
'''
    dest = ROOT / (path.strip("/") + "/index.html" if path.strip("/") else "index.html")
    if path == "/404.html":
        dest = ROOT / "404.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(out)
    return dest


def main_of(rel):
    """Inner content of <main> in a page as it is now (the breadcrumb is stripped and rebuilt)."""
    src = (ROOT / rel).read_text()
    m = re.search(r"<main[^>]*>(.*?)</main>", src, re.S)
    inner = re.sub(r'^\s*<p class="crumbs">.*?</p>\s*', "", m.group(1), flags=re.S)  # rebuilt below
    return inner.strip(), src


def crumb(label):
    return f'<p class="crumbs"><a href="/about/">About</a> <span aria-hidden="true">›</span> {label}</p>'


# ---------------------------------------------------------------- FAQ (shown on About; three on the home page)
FAQ = [
    ("When should I use HerePup?",
     "Any time you're choosing or checking your coverage, not just at open enrollment: when you start a new job or weigh a job offer, "
     "after a life event such as marriage, a new baby or losing other coverage (which usually lets you change plans outside open "
     "enrollment), when a spouse's employer opens enrollment at a different time, or when you're budgeting for the year ahead."),
    ("Is HerePup free?",
     "Yes. HerePup is free to use while it's in early testing, and there's no account to create."),
    ("Do you see my health information?",
     "No. HerePup runs in your web browser, on your device. Your benefit guides and claims are read there and never uploaded, and "
     "HerePup has no servers that receive them. The site only counts anonymous visits and a few steps, with no cookies. You can "
     "erase everything with \"Delete all my data\" in the app.",
     'No. HerePup runs in your web browser, on your device. Your benefit guides and claims are read there and never uploaded, and '
     'HerePup has no servers that receive them. The site only counts <a href="/privacy/#usage">anonymous visits and a few steps</a>, '
     'with no cookies. You can erase everything with "Delete all my data" in the app.'),
    ("What do I need to get started?",
     "Each plan option's benefit guide or plan summary (a PDF is fine, even a scanned one), and your recent claims history: the "
     "explanations of benefits (EOBs) or claims spreadsheet you can download from your insurer's member website under Claims, plus "
     "pharmacy claims if you fill prescriptions. The last 12 months gives the best starting point; add earlier years to plan around your highest, lowest or average year. Direct insurer connections are in "
     "testing; see insurer connections to request yours.",
     "Each plan option's benefit guide or plan summary (a PDF is fine, even a scanned one), and your recent claims history: the "
     "explanations of benefits (EOBs) or claims spreadsheet you can download from your insurer's member website under Claims, plus "
     'pharmacy claims if you fill prescriptions. The last 12 months gives the best starting point; add earlier years to plan around your highest, lowest or average year. Direct insurer connections are in '
     'testing; see <a href="/insurers/">insurer connections</a> to request yours.'),
    ("Can it compare plans from two employers?",
     "Yes. If you and a spouse or partner both have employer coverage, add both benefit guides. HerePup tests every way your household "
     "can enroll, including splitting people across the two employers' plans."),
    ("Does it count employer HSA contributions?",
     "Yes. Money your employer puts into a health savings account (HSA) is subtracted from that plan's cost. Before you see an answer, "
     "you confirm the amount for each HSA plan, or confirm the employer puts in nothing. If you need a certain kind of plan, you can "
     "also tell HerePup to consider only HSA plans, or only plans without one."),
    ("How accurate is it?",
     "HerePup models each kind of care in your claims history under each plan's deductibles, coinsurance, copays, prescription tiers "
     "and out-of-pocket maximums, and checks the model against what your insurer actually charged when your files include it. Its "
     "estimate assumes your care looks like your history, adjusted with the What if slider. New conditions or care you don't expect "
     "can change real costs, prices and plan rules change, and specialty drug tiers are not modeled yet."),
    ("What if next year looks different?",
     "Use the What if slider to model anywhere from no care to three times the care in your claims history. HerePup shows the points "
     "where a different plan would become the better choice, so you can pick the plan that holds up for the year you expect."),
    ("Does it check whether my doctors are in network?",
     "No. HerePup compares costs, not networks. Before you enroll, check each plan's provider directory for the doctors, hospitals and "
     "pharmacies you use."),
    ("Is this insurance advice?",
     "No. HerePup doesn't sell insurance and isn't a broker. It gives you an estimate to help you decide; your plan's official "
     "documents decide what's covered."),
    ("Does it work on my phone?",
     "Yes, in any up-to-date browser. Reading long or scanned PDFs is faster on a computer."),
]


def faq_html(items):
    return "\n".join(f'<details><summary><h3>{E(q)}</h3></summary><p>{rest[1] if len(rest) > 1 else E(rest[0])}</p></details>'
                     for q, *rest in items)


FAQ_LD = {"@type": "FAQPage", "@id": BASE + "/about/#faq", "mainEntity": [
    {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": rest[0]}} for q, *rest in FAQ]}

HERO_IMG = ('<picture><source srcset="/assets/herepup-mascot.webp" type="image/webp">'
            '<img class="mascot" src="/assets/herepup-mascot.png" alt="HerePup\'s golden retriever mascot carrying a rolled-up plan" '
            'width="760" height="601" fetchpriority="high"></picture>')

# ---------------------------------------------------------------- home
home = f'''
<main>
<div class="hero">
  <div class="hero-text">
    <span class="eyebrow">Pick yoUr Plan</span>
    <h1>Choose your health plan with your own claims, not a guess.</h1>
    <p class="lead">HerePup builds a cost model from your own claims history and estimates what every plan your household can choose is likely to cost, whether HDHP, PPO or EPO and across every employer, counting premiums, deductibles, copays and HSA money. Then test a heavier or lighter year before you decide.</p>
    <p style="margin:22px 0 0"><a class="cta" href="/app/">Try HerePup in your browser</a></p>
    <p class="cta-note">Drag in your benefit guides and claims. They're read on your device and never uploaded.</p>
  </div>
  {HERO_IMG}
</div>

<section id="how" class="tight">
  <h2>How it works</h2>
  <div class="grid4" style="margin:14px 0 18px">
    <div class="card"><div class="num">1</div><h3>Add your plan options</h3><p>Drag in each employer's benefit guide, typed or scanned. HerePup reads the plan options, premiums, deductibles and copays, and you confirm every number.</p></div>
    <div class="card"><div class="num">2</div><h3>Bring in your claims history</h3><p>Drag in your explanations of benefits and the claim or pharmacy summaries you can download from your insurer's website. The last 12 months is the best start; earlier years let you plan around your highest, lowest or average year.</p></div>
    <div class="card"><div class="num">3</div><h3>See what each plan is likely to cost</h3><p>HerePup models how your kind of care would be covered under every plan: which visits get a flat copay and which go to the deductible. See month by month when costs would land and how much to set aside, then adjust for a heavier or lighter year.</p></div>
    <div class="card"><div class="num">4</div><h3>Spend less on the same care</h3><p>See where your money went, and where the same kind of care costs less: one urgent care against another, the same test at two labs, the same drug at two pharmacies.</p></div>
  </div>
  <a class="video-teaser" href="/how-it-works/#watch">
    <img src="/assets/herepup-walkthrough-poster.jpg" alt="" width="1920" height="1080" loading="lazy">
    <span><b>Watch the 3-minute walkthrough</b><br>See a sample household go from benefit guides to an answer, month-by-month costs and savings, step by step.</span>
  </a>
</section>

<section id="when" aria-labelledby="when-h">
  <h2 id="when-h">Use it any time your coverage choice matters</h2>
  <div class="grid4" style="margin-top:14px">
    <div class="card"><h3>Open enrollment</h3><p>Compare next year's plan options, at your employer and a spouse's, before the deadline.</p></div>
    <div class="card"><h3>A new job or job offer</h3><p>See what each new plan is likely to cost before you enroll, or how two offers' benefits really compare.</p></div>
    <div class="card"><h3>A life event</h3><p>Marriage, a new baby or losing other coverage usually lets you change plans mid-year. Check which option fits now.</p></div>
    <div class="card"><h3>Planning the year ahead</h3><p>Budget for premiums and care month by month, plan HSA contributions, and check you're on the right plan.</p></div>
  </div>
</section>

<section class="split" id="privacy">
  <div>
    <h2>Your health data stays with you</h2>
    <p style="color:var(--ink)">HerePup runs on your own device, right in your browser. Your documents are read there and never uploaded. We don't have servers that receive them.</p>
  </div>
  <ul class="checks">
    <li>No HerePup account, and we never see your carrier password</li>
    <li>Carrier access is read-only and only with your approval</li>
    <li>Nothing is sold, shared or used for advertising</li>
    <li>Disconnect or delete everything at any time</li>
  </ul>
</section>

<section class="faq" aria-labelledby="faq-h">
  <h2 id="faq-h">Common questions</h2>
  {faq_html([FAQ[0], FAQ[2], FAQ[3]])}
  <p class="more"><a href="/about/#faq">More questions and answers</a></p>
</section>

<section>
  <div class="note">
    <h2 style="font-size:22px">Where HerePup is today</h2>
    <p style="margin:0;color:var(--ink)">HerePup is in early testing, and you can <a href="/app/">try it now</a> with your own documents. Its estimates come from your own documents and are not a guarantee of cost or a substitute for your plan's documents. Questions, feedback or partnership inquiries: <a href="/contact/">send us a message</a>.</p>
  </div>
</section>
</main>'''
page("/", "Compare Health Plans With Your Own Claims | HerePup",
     "Estimate what each health plan will cost your household with a model built from your own claims. Compare HDHP, PPO and EPO options any time, privately.",
     home, None, [ORG, SITE, APP], og_title="HerePup: compare health plans with your own claims")

# ---------------------------------------------------------------- how it works
how = '''
<main class="page">
<h1>How HerePup estimates your health plan costs</h1>
<p class="lead">Choosing a plan means guessing what your care will cost. HerePup gives you a better starting point: it builds a model from your own claims history, works out how each plan you can choose would cover that kind of care, and lets you adjust it for the year you expect.</p>
<p>You can use it whenever your coverage choice matters: at open enrollment, when you start a new job or compare offers, after a life event such as marriage or a new baby, or when you're planning and budgeting for the year ahead.</p>

<section id="watch" class="tight">
  <h2>Watch the walkthrough <span class="muted">(3 minutes)</span></h2>
  <video controls playsinline preload="none" poster="/assets/herepup-walkthrough-poster.jpg" width="1920" height="1080">
    <source src="/assets/herepup-walkthrough.mp4" type="video/mp4">
    <track kind="captions" src="/assets/herepup-walkthrough.en.vtt" srclang="en" label="English">
    Your browser can't play this video. <a href="/assets/herepup-walkthrough.mp4">Download it</a> instead.
  </video>
  <p class="muted small">Shown with a made-up household and sample documents. Captions are available.</p>
</section>

<section aria-labelledby="steps-h">
<h2 id="steps-h">Step by step</h2>
<ol class="steps">
  <li><h3>Tell HerePup who's covered</h3><p>Add each person in your household and whether they're an adult or a child. HerePup uses this to pick the right coverage level for every option: employee only, employee plus spouse, employee plus children, or family.</p></li>
  <li><h3>Add your plan options</h3><p>Drag in each employer's benefit guide or plan summary. Typed and scanned PDFs both work. HerePup reads the premiums for each coverage level, deductibles, out-of-pocket maximums, coinsurance, office, specialist, urgent care and ER copays, prescription tiers and employer HSA contributions. You check and confirm every number. If you and a spouse or partner have different employers, add both.</p></li>
  <li><h3>Bring in your claims history</h3><p>Drag in your explanations of benefits (EOBs), the claims spreadsheet from your insurer's member website, and your pharmacy claims. The last 12 months is the best starting point; with earlier years too, you can plan around your highest, lowest or average year. HerePup works out what kind of care each claim was, such as an office visit, a specialist, urgent care, the ER, a procedure or a prescription, and asks you to confirm anything it isn't sure about. Direct connections to insurers are <a href="/insurers/">in testing</a>, and you can request yours.</p></li>
  <li><h3>Estimate what every option will cost</h3><p>HerePup models each kind of care in your history under every plan and every way your household could enroll: which visits would be a flat copay and which would go to the deductible, when coinsurance and out-of-pocket maximums kick in, and the total: premiums plus your share of care, minus employer HSA money. When your files include what your insurer actually charged, HerePup checks its model against it.</p></li>
  <li><h3>Adjust for the year ahead</h3><p>Expecting more care, or less? The What if slider models anywhere from no care to three times the care in your history and shows the point where a different plan becomes the better choice, so you can pick a plan that holds up for the year you expect.</p></li>
  <li><h3>See it month by month</h3><p>A low-deductible plan spreads its cost evenly through premiums; a high-deductible plan costs less up front but can bring big bills in the months you need care. The month-by-month view shows when each plan's costs are likely to land, and how much to set aside for the expensive months.</p></li>
  <li><h3>Spend less on the same care</h3><p>HerePup also looks across your claims for the same kind of care at different providers, such as two urgent care centers, the same test at two labs or the same drug at two pharmacies, and shows what the lower-cost one would save you, so you can choose it next time.</p></li>
</ol>
</section>

<section aria-labelledby="hdhp-h">
<h2 id="hdhp-h">HDHP or PPO? Why your own claims matter</h2>
<p>Plans trade premiums against what you pay when you get care. A high-deductible health plan (HDHP) usually has the lowest premiums and often comes with employer HSA money, but you pay the full price of most care until the deductible is met. A PPO or EPO with a low deductible costs more every paycheck, but many visits cost only a flat copay.</p>
<p>Which one costs less depends on how your household uses care: how many visits, what kind, how many prescriptions, and whether one person or everyone meets the deductible. Averages and plan comparison charts can't tell you that. A model built from your own claims can, and it shows whether a heavier or lighter year would change the answer.</p>
</section>

<section aria-labelledby="need-h">
<h2 id="need-h">What you'll need</h2>
<ul class="checks">
  <li>The benefit guide or plan summary from each employer offering you coverage</li>
  <li>Your recent claims from your insurer's member website, ideally the last 12 months (EOB PDFs or a claims spreadsheet)</li>
  <li>Pharmacy claims, if you fill prescriptions</li>
  <li>About 10 minutes. Nothing is uploaded, and there's no account to create</li>
</ul>
</section>

<section aria-labelledby="limits-h">
<h2 id="limits-h">What HerePup doesn't do yet</h2>
<p>HerePup compares costs, not provider networks, so check that your doctors are in each plan's network. Its estimates start from your history and the adjustment you choose, so they can't foresee new conditions or care you don't expect. It doesn't model specialty drug tiers yet, and its results are estimates, not a promise of what a plan will cost. <a href="/about/#faq">See the FAQ</a> for more.</p>
</section>

<p style="margin:8px 0 0"><a class="cta" href="/app/">Try HerePup in your browser</a></p>
</main>'''
VIDEO = {"@type": "VideoObject", "@id": BASE + "/how-it-works/#video", "name": "How HerePup estimates your health plan costs",
         "description": "A three-minute walkthrough of HerePup with a sample household: adding benefit guides, confirming HSA money and bringing in claims history, then seeing what each plan is likely to cost, month by month, and where the same care costs less.",
         "thumbnailUrl": [BASE + "/assets/herepup-walkthrough-poster.jpg"], "uploadDate": "2026-10-18T17:30:00-04:00",
         "duration": "PT3M13S", "contentUrl": BASE + "/assets/herepup-walkthrough.mp4", "publisher": {"@id": BASE + "/#org"}}
page("/how-it-works/", "How It Works: Estimate HDHP, PPO and EPO Costs | HerePup",
     "How HerePup models your claims history under each health plan: copay vs deductible, a what-if for the year ahead, month-by-month costs and money to set aside.",
     how, "how", [ORG, VIDEO])

# ---------------------------------------------------------------- about
about = f'''
<main class="page">
<h1>About HerePup</h1>
<p class="lead">Choosing a health plan usually means guessing. HerePup | Pick yoUr Plan replaces the guess with a model built from your own claims history: it estimates what each plan you can choose is likely to cost you, and when, at open enrollment or any time your coverage options change.</p>
<p>HerePup is a small, independent company. It isn't an insurer or a broker, and it doesn't sell insurance or your information. It's built to run on your own device, so your health information stays with you. HerePup is in early testing, and we'd love to hear how it works for you: <a href="/contact/">send us a message</a>.</p>

<section class="faq" id="faq" aria-labelledby="faq-h">
  <h2 id="faq-h">Frequently asked questions</h2>
  {faq_html(FAQ)}
</section>

<section aria-labelledby="more-h">
  <h2 id="more-h">More about HerePup</h2>
  <div class="grid3 hub">
    <a class="card" href="/insurers/"><h3>Insurer connections</h3><p>Which insurers can share claims with apps like HerePup, how to get your claims today, and how to request yours.</p></a>
    <a class="card" href="/privacy/"><h3>Privacy policy</h3><p>What HerePup reads, where it's stored, what's counted, and how to delete it.</p></a>
    <a class="card" href="/terms/"><h3>Terms of use</h3><p>What HerePup is, what its estimates mean, and your responsibilities.</p></a>
    <a class="card" href="/contact/"><h3>Contact</h3><p>Questions, feedback or partnership inquiries. Your message goes straight to Chris at HerePup.</p></a>
  </div>
</section>
</main>'''
page("/about/", "About HerePup and FAQ | HerePup",
     "What HerePup is, who it's for, and answers to common questions: when to use it, is it free, is my health data private, what do I need, how accurate is it.",
     about, "about", [ORG, {"@type": "AboutPage", "@id": BASE + "/about/", "url": BASE + "/about/", "name": "About HerePup", "about": {"@id": BASE + "/#org"}},
                      FAQ_LD])

# ---------------------------------------------------------------- existing pages, same content, new shell
ins, _ = main_of("insurers/index.html")
page("/insurers/", "Insurer Claims Connections (Patient Access APIs) | HerePup",
     "Which health insurers can share claims with apps like HerePup through a Patient Access API, who each covers, and how to request yours.",
     f'<main class="doc" style="max-width:980px">\n{crumb("Insurer connections")}\n{ins}\n</main>', "about",
     [ORG, crumbs_ld([("Home", "/"), ("About", "/about/"), ("Insurer connections", "/insurers/")])],
     tail='<script src="/assets/contact.js" defer></script>\n')

prv, prv_src = main_of("privacy/index.html")
tail = re.search(r"</footer>\s*</div>\s*(<script>.*?</script>)", prv_src, re.S).group(1) + "\n"
page("/privacy/", "Privacy Policy | HerePup",
     "How HerePup handles your information: documents and claims stay on your device, nothing is sold, anonymous usage counts only, and how to delete your data.",
     f'<main class="doc">\n{crumb("Privacy policy")}\n{prv}\n</main>', "about",
     [ORG, crumbs_ld([("Home", "/"), ("About", "/about/"), ("Privacy policy", "/privacy/")])], tail=tail)

trm, _ = main_of("terms/index.html")
page("/terms/", "Terms of Use | HerePup",
     "The terms for using HerePup: what it is, why its results are estimates and not insurance advice, and your responsibilities.",
     f'<main class="doc">\n{crumb("Terms of use")}\n{trm}\n</main>', "about",
     [ORG, crumbs_ld([("Home", "/"), ("About", "/about/"), ("Terms of use", "/terms/")])])

contact = """
<main class="page">
<p class="crumbs"><a href="/about/">About</a> <span aria-hidden="true">›</span> Contact</p>
<h1>Contact HerePup</h1>
<p class="lead">Questions, feedback, or partnership and press inquiries. Your message goes straight to Chris at HerePup.</p>
<div class="contact-box">
<form data-contact-form data-subject="HerePup contact form" class="contact-form">
  <label>What's this about?<select name="topic" required><option value="">Choose one</option><option>Feedback on HerePup</option><option>A question about using HerePup</option><option>Partnership or press</option><option>Something else</option></select></label>
  <label>Your name <span class="opt">(optional)</span><input name="name" autocomplete="name"></label>
  <label>Your email<input type="email" name="email" required autocomplete="email"></label>
  <label>Message<textarea name="message" rows="6" required></textarea></label>
  <input type="checkbox" name="botcheck" style="display:none" tabindex="-1" autocomplete="off">
  <input type="hidden" name="sent_from" value="Contact page">
  <p class="small">Please don't include claim details, amounts or other health information. See <a href="/privacy/#messages">how messages are handled</a>.</p>
  <p class="send"><button type="submit" class="cta">Send message</button> <span data-status role="status"></span></p>
</form>
<div data-sent hidden class="sent"><h2>Thanks, your message is on its way.</h2><p>Chris will reply to the email address you gave. <a href="/">Back to the home page</a></p></div>
</div>
<p class="small">Prefer email? Write to chris@herepup.health.</p>
</main>"""
page("/contact/", "Contact HerePup | HerePup",
     "Send HerePup a question, feedback, or a partnership or press inquiry. Messages go straight to the HerePup team.",
     contact, "about", [ORG, {"@type": "ContactPage", "@id": BASE + "/contact/", "url": BASE + "/contact/", "name": "Contact HerePup", "about": {"@id": BASE + "/#org"}},
                        crumbs_ld([("Home", "/"), ("About", "/about/"), ("Contact", "/contact/")])],
     tail='<script src="/assets/contact.js" defer></script>\n')

page("/404.html", "Page not found | HerePup", "That page doesn't exist on herepup.health.",
     '<main class="doc"><h1>Page not found</h1><p>That page doesn\'t exist. Try <a href="/app/">HerePup in your browser</a>, see <a href="/how-it-works/">how it works</a>, or go to the <a href="/">home page</a>.</p></main>',
     None, robots="noindex")

# Insurer sign-in hand-off. Some insurers (Cigna) won't accept a callback on the member's own computer, so this static
# page is the registered callback: it runs in the browser, records nothing (no analytics), and forwards the code and
# state to the HerePup desktop app at localhost, or (state hpw.*) back to the web app's tab on this site. The state names the app's scheme and port (hpl.<scheme>.<port>.<random>);
# only localhost is ever a destination. The code is useless without the PKCE verifier kept on the member's computer.
CALLBACK_JS = r'''<script>
(function () {
  var q = new URLSearchParams(location.search), state = q.get("state") || "";
  var msg = document.getElementById("cb-msg"), help = document.getElementById("cb-help");
  function link(href, text) { var a = document.createElement("a"); a.href = href; a.textContent = text; return a; }
  if (/^hpw\.[A-Za-z0-9_-]{16,}$/.test(state)) {  // started in the web app on this site: hand it back to that tab
    try { sessionStorage.setItem("herepup.connect.return", JSON.stringify({ code: q.get("code") || "", state: state,
      error: q.get("error_description") || q.get("error") || "" })); } catch (e) { /* storage blocked: the app will say so */ }
    location.replace("/app/");
    return;
  }
  var m = /^hpl\.(https?)\.(\d{4,5})\.[A-Za-z0-9_-]{16,}$/.exec(state), port = m ? Number(m[2]) : 0;
  if (m && port >= 1024 && port <= 65535) {
    var dest = m[1] + "://localhost:" + port + "/callback" + location.search;
    help.append("Nothing happening? Make sure HerePup is running on this computer, then ", link(dest, "try again"), ".");
    setTimeout(function () { help.hidden = false; }, 1500);
    location.replace(dest);
    return;
  }
  if (location.search) history.replaceState(null, "", location.pathname);
  var err = q.get("error_description") || q.get("error");
  msg.textContent = err ? "The insurer sign-in didn't finish: " + err
                        : "This page finishes insurer sign-ins for HerePup. There's nothing to do here.";
  help.append(link("/app/", "Go to HerePup"));
  help.hidden = false;
})();
</script>
'''
page("/app/callback/", "Finishing your insurer sign-in | HerePup", "Hands an insurer sign-in back to HerePup on your computer.",
     '''<main class="doc"><h1>Finishing your insurer sign-in</h1>
<p id="cb-msg" role="status">Taking you back to HerePup on your computer...</p>
<p id="cb-help" hidden></p>
<noscript><p>This page needs JavaScript to hand your sign-in back to HerePup.</p></noscript>
<p class="muted" style="margin-top:28px">This page only passes your sign-in along. HerePup doesn't record anything here, and the code in this
link only works with a key that stays on your computer.</p></main>''',
     None, robots="noindex", tail=CALLBACK_JS, analytics=False, extra='<meta name="referrer" content="no-referrer">')

# ---------------------------------------------------------------- sitemap + robots
urls = [("/", "1.0"), ("/app/", "0.9"), ("/how-it-works/", "0.9"), ("/about/", "0.8"), ("/insurers/", "0.6"), ("/contact/", "0.5"), ("/privacy/", "0.4"), ("/terms/", "0.3")]
(ROOT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                  + "".join(f"  <url><loc>{BASE}{u}</loc><lastmod>{TODAY}</lastmod><priority>{p}</priority></url>\n" for u, p in urls)
                                  + "</urlset>\n")
(ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
print("built")
