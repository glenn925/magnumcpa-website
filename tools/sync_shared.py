"""Keeps the parts that are the same on every page in step.

index.html holds the MASTER copy of:
  - the main menu   (<header class="site-header"> ... </header>)
  - the footer      (<footer> ... </footer>)
  - the search list (var INDEX = [ ... ]; in the SEARCH script)
  - the floating call button (its styles, from FLOATING CALL BUTTON to FLOATING CALL BUTTON:END in the style
    block, and its HTML + script, from <!-- ===== FLOATING CALL BUTTON ===== --> to <!-- FLOATING CALL BUTTON:END -->)
Edit those in index.html, then run from the project folder:

    python tools/sync_shared.py .

It copies them into every other page and marks each page's own menu item as the
current one. It also writes the SHARE + GOOGLE MARKUP block in every page's head:
the preview shown when a page is shared (Open Graph), the business details Google
reads (name, address, phone, hours, social links) on Home and Contact, and the
breadcrumb trail (Home > Services > ...) on the other pages. Finally it rebuilds
the four service pages (tools/gen_services.py) and syncs them too.

A new page: add it to PAGES below (its name for the breadcrumb, and its parent
page if it has one), then run this tool. Prints "ok" at the end.
"""
import glob, html, io, json, os, re, subprocess, sys

root = sys.argv[1] if len(sys.argv) > 1 else '.'
SITE = 'https://www.magnumcpa.com/'

# ===== PAGES =====
# file name (without .html) -> (name in the breadcrumb, parent page or None)
PAGES = {
    'index': ('Home', None),
    'about': ('About Us', None),
    'services': ('Services', None),
    'tax-preparation-planning': ('Tax Preparation and Planning', 'services'),
    'bookkeeping-payroll': ('Bookkeeping and Payroll Services', 'services'),
    'business-consulting': ('Business Consulting', 'services'),
    'future-security': ('Future Security', 'services'),
    'client-newsletter': ('Client Newsletter', None),
    'tax-planning-newsletter': ('Tax Planning Newsletter', None),
    'tax-videos': ('Tax Videos', None),
    'financial-calculators': ('Financial Calculators', None),
    'request-consultation': ('Request a Consultation', None),
    'contact': ('Contact Us', None),
}

# ===== BUSINESS DETAILS =====
# What Google reads about the firm (shown with the business in search and Maps). Keep it the same
# as the TOP BAR, the Contact page and the Google Business Profile.
SOCIAL = [
    'https://www.facebook.com/max.drew.522',
    'https://www.instagram.com/magnumcpa11/',
    'https://www.youtube.com/@MaxDrew',
    'https://www.threads.com/@magnumcpa11',
    'https://x.com/MagnumCPA11',
    'https://www.quora.com/profile/Magnum-CPA',
]
GOOGLE_PROFILE = 'https://maps.google.com/?cid=%d' % 0x2c669e32c72c4214
BUSINESS = {
    '@context': 'https://schema.org',
    '@type': 'AccountingService',
    '@id': SITE + '#business',
    'name': 'Magnum CPA PC',
    'url': SITE,
    'logo': SITE + 'images/logo.png',
    'image': SITE + 'images/hero-photo2.jpg',
    'telephone': '+1-916-616-1789',
    'email': 'ask@magnumcpa.com',
    'founder': {'@type': 'Person', 'name': 'Max Drew', 'jobTitle': 'CPA'},
    'address': {'@type': 'PostalAddress', 'streetAddress': '907 Green Moss Drive', 'addressLocality': 'Sacramento',
                'addressRegion': 'CA', 'postalCode': '95831', 'addressCountry': 'US'},
    'geo': {'@type': 'GeoCoordinates', 'latitude': 38.4907685, 'longitude': -121.525695},
    'hasMap': GOOGLE_PROFILE,
    'openingHoursSpecification': [
        {'@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
         'opens': '09:00', 'closes': '17:00'},
        {'@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Saturday', 'Sunday'], 'opens': '14:00', 'closes': '18:00'},
    ],
    'sameAs': SOCIAL + [GOOGLE_PROFILE],
}
BUSINESS_PAGES = ('index', 'contact')
# picture shown when a page is shared on Facebook, LinkedIn, texts, etc.
SHARE_IMAGE, SHARE_ALT = SITE + 'images/hero-photo2.jpg', 'Max Drew, CPA, meeting with a client in the Magnum CPA PC office'


def fail(msg):
    sys.exit('ERROR: ' + msg)


def rd(p):
    return io.open(os.path.join(root, p), encoding='utf-8').read()


def wr(p, s):
    io.open(os.path.join(root, p), 'w', encoding='utf-8', newline='').write(s)


def block(s, start, end, where):
    """(i, j) of the text from start up to and including end; it must appear exactly once."""
    if s.count(start) != 1:
        fail('%s: expected "%s" exactly once, found %d.' % (where, start, s.count(start)))
    i = s.index(start)
    j = s.index(end, i) + len(end)
    return i, j


# ===== MASTER COPIES (from index.html) =====
master = rd('index.html')
i, j = block(master, '<header class="site-header">', '</header>', 'index.html menu')
MENU = master[i:j].replace(' aria-current="page"', '').replace(' class="active"', '').replace('class="sub-toggle active"', 'class="sub-toggle"')
i, j = block(master, '<footer>', '</footer>', 'index.html footer')
FOOTER = master[i:j]
i, j = block(master, '    var INDEX = [', '\n    ];', 'index.html search list')
SEARCH = master[i:j]
# floating call button: its styles (inside <style>) and its HTML + script (after the Book button)
CALL_CSS_START, CALL_CSS_END = '  /* ===== FLOATING CALL BUTTON ===== */', '  /* FLOATING CALL BUTTON:END */\n'
CALL_HTML_START, CALL_HTML_END = '<!-- ===== FLOATING CALL BUTTON ===== -->', '<!-- FLOATING CALL BUTTON:END -->\n'
i, j = block(master, CALL_CSS_START, CALL_CSS_END, 'index.html call button styles')
CALL_CSS = master[i:j]
i, j = block(master, CALL_HTML_START, CALL_HTML_END, 'index.html call button')
CALL_HTML = master[i:j]


def mark(menu, slug):
    """The menu with this page's own item marked as current (a drop-down's title is highlighted too)."""
    if slug == 'index':
        return menu.replace('<li><a href="./">', '<li><a href="./" class="active" aria-current="page">', 1)
    out = []
    for part in re.split(r'(<li class="has-sub">.*?</ul>\s*</li>)', menu, flags=re.S):
        own = '<li><a href="%s">' % slug
        if part.startswith('<li class="has-sub">'):
            if own in part:
                part = part.replace('class="sub-toggle">', 'class="sub-toggle active">', 1)
                part = part.replace(own, '<li><a href="%s" aria-current="page">' % slug, 1)
        else:
            part = part.replace(own, '<li><a href="%s" class="active" aria-current="page">' % slug, 1)
        out.append(part)
    return ''.join(out)


def jsonld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '</script>\n'


def markup(s, slug, where):
    """The SHARE + GOOGLE MARKUP block for one page, from its title, description and canonical address."""
    try:
        title = re.search(r'<title>(.*?)</title>', s, re.S).group(1).strip()
        desc = re.search(r'<meta name="description" content="(.*?)">', s, re.S).group(1).strip()
        url = re.search(r'<link rel="canonical" href="(.*?)">', s).group(1)
    except AttributeError:
        fail(where + ': needs a <title>, a <meta name="description"> and a <link rel="canonical">.')
    name, parent = PAGES[slug]
    out = ('<!-- ===== SHARE + GOOGLE MARKUP ===== made by tools/sync_shared.py from this page\'s title, description\n'
           '     and address. Don\'t edit it here: change the tool (or the page title / description) and run it again. -->\n'
           '<meta property="og:type" content="website">\n'
           '<meta property="og:site_name" content="Magnum CPA PC">\n'
           '<meta property="og:title" content="%s">\n'
           '<meta property="og:description" content="%s">\n'
           '<meta property="og:url" content="%s">\n'
           '<meta property="og:image" content="%s">\n'
           '<meta property="og:image:alt" content="%s">\n'
           '<meta name="twitter:card" content="summary_large_image">\n') % (title, desc, url, SHARE_IMAGE, SHARE_ALT)
    if slug in BUSINESS_PAGES:
        out += jsonld(BUSINESS)
    if slug != 'index':
        trail = [('Home', SITE)]
        if parent:
            trail.append((PAGES[parent][0], SITE + parent))
        trail.append((name, url))
        out += jsonld({'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': n, 'name': t, 'item': u} for n, (t, u) in enumerate(trail, 1)]})
    return out + '<!-- SHARE + GOOGLE MARKUP:END -->\n'


def sync(p):
    slug = p[:-5]
    if slug not in PAGES:
        fail('%s is not in the PAGES list at the top of tools/sync_shared.py; add it there.' % p)
    s = rd(p)
    new = s
    i, j = block(new, '<header class="site-header">', '</header>', p + ' menu')
    new = new[:i] + mark(MENU, slug) + new[j:]
    i, j = block(new, '<footer>', '</footer>', p + ' footer')
    new = new[:i] + FOOTER + new[j:]
    i, j = block(new, '    var INDEX = [', '\n    ];', p + ' search list')
    # on other pages a link to a part of the home page needs ./ in front (#why-choose-us -> ./#why-choose-us)
    new = new[:i] + (SEARCH if slug == 'index' else SEARCH.replace("url:'#", "url:'./#")) + new[j:]
    # floating call button: replace the page's copy, or add it (styles just before </style>,
    # HTML after the Book button, or after the footer on pages without one)
    if CALL_CSS_START in new:
        i, j = block(new, CALL_CSS_START, CALL_CSS_END, p + ' call button styles')
        new = new[:i] + CALL_CSS + new[j:]
    else:
        i = new.index('</style>')
        new = new[:i] + CALL_CSS + new[i:]
    if CALL_HTML_START in new:
        i, j = block(new, CALL_HTML_START, CALL_HTML_END, p + ' call button')
        new = new[:i] + CALL_HTML + new[j:]
    else:
        m = re.search(r'<a class="book-fab"[^\n]*\n', new) or re.search(r'</footer>\n', new)
        if not m:
            fail(p + ': no Book button or </footer> to put the call button after.')
        new = new[:m.end()] + CALL_HTML + new[m.end():]
    # the head markup goes right after the canonical link (replacing the previous one)
    start, end = '<!-- ===== SHARE + GOOGLE MARKUP =====', '<!-- SHARE + GOOGLE MARKUP:END -->\n'
    if start in new:
        i, j = block(new, start, end, p + ' markup')
        new = new[:i] + new[j:]
    m = re.search(r'<link rel="canonical" href=".*?">\n', new)
    if not m:
        fail(p + ': no <link rel="canonical" ...> line in the head.')
    new = new[:m.end()] + markup(new, slug, p) + new[m.end():]
    if new != s:
        wr(p, new)
        return 1
    return 0


pages = sorted(os.path.basename(f) for f in glob.glob(os.path.join(root, '*.html')))
changed = sum(sync(p) for p in pages)
# the four service pages are copied from financial-calculators.html: rebuild them, then sync them too
r = subprocess.run([sys.executable, os.path.join(root, 'tools', 'gen_services.py'), root], capture_output=True, text=True)
if r.returncode != 0 or 'ok' not in r.stdout:
    fail('tools/gen_services.py failed:\n' + r.stdout + r.stderr)
changed += sum(sync(p) for p in pages)
print('%d page(s) checked, %d update(s) written.' % (len(pages), changed))
print('ok')
