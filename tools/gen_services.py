"""Builds the four service pages from financial-calculators.html (shared header,
nav, footer, search and styles), and adds them to both pages' search index."""
# ===== HOW TO USE =====
# Run it from the repo root (the folder that holds index.html):
#     python tools/gen_services.py .
# Re-run it after you change financial-calculators.html (shared header, menu, footer,
# styles, scripts, search list) or the SERVICES text below. It overwrites these four files:
#     tax-preparation-planning.html, bookkeeping-payroll.html,
#     business-consulting.html, future-security.html
# so do not hand-edit those four pages: your changes would be lost on the next run.
# It also adds the four pages to the search list in index.html and
# financial-calculators.html, but only if they are not already there.
# It prints ok when finished. An AssertionError or ValueError means an exact text it looks for
# in financial-calculators.html (or index.html) was changed; see the notes in page() below.

# ===== SETUP =====
# sys reads the folder name from the command line; io reads and writes files as UTF-8.
import sys, io
# root = the folder given on the command line (the dot in the command above)
root = sys.argv[1]
# rd(path) reads a file and wr(path, text) writes one, both relative to root
rd = lambda p: io.open(root + '/' + p, encoding='utf-8').read()
wr = lambda p, s: io.open(root + '/' + p, 'w', encoding='utf-8', newline='').write(s)

# ===== SERVICES DATA =====
# One dict per service page, in the order used by the Switch service list. Edit text here, then re-run.
#   file  = file name of the page that gets written
#   key   = the service name for the consultation form link (only used by the unused form value in page())
#   img   = the big photo on the page (also the photo's transition name via VT_NAMES)
#   icon  = Font Awesome icon in the badge on the photo (an fa- name)
#   title = browser tab title, Google description, Switch service list, search title, H1_MAP key
#   short = shorter name, used only as extra search keywords
#   lede  = one-sentence summary: Google description and search snippet
#   more  = longer paragraph; not shown anywhere at the moment
#   items = list of (icon, heading, description) offerings; only the headings are used, as search keywords
SERVICES = [
  # --- Tax Preparation and Planning ---
  dict(file='tax-preparation-planning.html', key='Tax Preparation', img='images/tax.jpg', icon='fa-file-invoice-dollar',
       title='Tax Preparation and Planning', short='Tax Preparation',
       lede='We help you stay compliant and maximize your tax savings with strategic, year-round planning.',
       more='Taxes are more than a once-a-year deadline. We prepare accurate returns and plan ahead with you, so decisions you make during the year work in your favor when it is time to file.',
       items=[('fa-file-lines', 'Individual & business tax returns', 'Accurate federal and state returns for individuals, sole proprietors, partnerships and corporations.'),
              ('fa-chart-line', 'Tax planning and projections', 'Projections that show where you stand before year-end, while there is still time to act.'),
              ('fa-scale-balanced', 'IRS representation and support', 'Help responding to IRS and state notices, letters and audits, so you are not facing them alone.'),
              ('fa-calendar-check', 'Year-round tax advisory', 'Answers when you need them: before a big purchase, a new job, a sale or a life change.')]),
  # --- Bookkeeping and Payroll ---
  dict(file='bookkeeping-payroll.html', key='Bookkeeping & Payroll', img='images/bk-payroll.jpg', icon='fa-calculator',
       title='Bookkeeping and Payroll Services', short='Bookkeeping & Payroll',
       lede='Accurate records and timely payroll so you can focus on what matters most — your business.',
       more='Clean books are the foundation of every good financial decision. We keep your records current and your people paid on time, and we give you reports you can actually use.',
       items=[('fa-book', 'Daily/Monthly bookkeeping', 'Transactions categorized and accounts reconciled on a schedule that fits your business.'),
              ('fa-money-check-dollar', 'Payroll processing & tax filings', 'Payroll run on time, with the related payroll tax filings handled.'),
              ('fa-file-invoice', 'Financial statement preparation', 'Profit and loss, balance sheet and cash flow statements, ready for lenders or planning.'),
              ('fa-broom', 'Clean-up and catch-up services', 'Behind on your books? We bring past months up to date and set you up to stay current.')]),
  # --- Business Consulting ---
  dict(file='business-consulting.html', key='Business Consulting', img='images/consulting.jpg', icon='fa-chart-column',
       title='Business Consulting', short='Business Consulting',
       lede='Strategic insights and practical solutions to drive growth, improve efficiency, and increase profitability.',
       more='Every business reaches decisions that deserve a second set of expert eyes. We look at your numbers with you and turn them into a clear plan for what comes next.',
       items=[('fa-chess', 'Business strategy and planning', 'Goals, budgets and a realistic roadmap built around how your business actually runs.'),
              ('fa-gears', 'Operational improvement', 'Find where time and money leak out, and fix the processes behind it.'),
              ('fa-magnifying-glass-chart', 'Financial analysis and forecasting', 'Forecasts and key numbers that show where the business is heading.'),
              ('fa-people-arrows', 'Succession and growth planning', 'Plan for expansion, a new partner, or the day you hand the business on.')]),
  # --- Future Security (wealth, retirement and estate planning) ---
  dict(file='future-security.html', key='Wealth, Retirement & Estate Planning', img='images/security.jpg', icon='fa-shield-halved',
       title='Future Security', short='Future Security',
       lede='Build, protect, and grow your wealth with a holistic approach to retirement, wealth management, and estate planning.',
       more='Security comes from a plan that covers the whole picture. We help you prepare for retirement, protect what you have built, and pass it on the way you intend.',
       items=[('fa-umbrella-beach', 'Retirement planning', 'Know how much you need, how to save for it, and how to draw it down tax-efficiently.'),
              ('fa-sack-dollar', 'Wealth management', 'A long-term strategy for growing and protecting your assets.'),
              ('fa-landmark', 'Estate and legacy planning', 'Plan how your estate passes on, with the tax side considered from the start.'),
              ('fa-house-shield', 'Life and business protection', 'Review the coverage that protects your family and your business from the unexpected.')]),
]

# ===== EXTRA SETTINGS =====
# VT_CSS: page-transition styles. NOT USED anywhere below; the same rules already sit in the
# style block of financial-calculators.html, which every service page copies.
VT_CSS = '\n  /* ===== shared-element page transition (card photo <-> service page photo) ===== */\n  @view-transition{navigation:auto;}\n  ::view-transition-group(*){animation-duration:500ms;animation-timing-function:cubic-bezier(.32,.72,0,1);}\n  ::view-transition-old(root){animation:vtOut 220ms ease both;}\n  ::view-transition-new(root){animation:vtIn 360ms cubic-bezier(.32,.72,0,1) 120ms both;}\n  /* keep photos cropped, not stretched, while they change shape */\n  ::view-transition-old(svc-tax),::view-transition-new(svc-tax),::view-transition-old(svc-books),::view-transition-new(svc-books),\n  ::view-transition-old(svc-consult),::view-transition-new(svc-consult),::view-transition-old(svc-future),::view-transition-new(svc-future){\n    height:100%;width:100%;object-fit:cover;overflow:clip;animation-duration:500ms;}\n  @keyframes vtOut{to{opacity:0;}}\n  @keyframes vtIn{from{opacity:0;transform:translateY(8px);}}\n  @media(prefers-reduced-motion:reduce){@view-transition{navigation:none;}}\n'

# H1_MAP: the big heading on each page, looked up by the service title. The words wrapped in the
# span with class grad get the blue-to-teal gradient. If you change a title in SERVICES,
# change its key here too, or the script stops with a KeyError.
H1_MAP = {'Tax Preparation and Planning': 'Tax Preparation <span class="grad">and Planning</span>', 'Bookkeeping and Payroll Services': 'Bookkeeping and <span class="grad">Payroll Services</span>', 'Business Consulting': 'Business <span class="grad">Consulting</span>', 'Future Security': 'Future <span class="grad">Security</span>'}

# VT_NAMES: a transition name for each photo file, so the photo on the home page Services card
# morphs into the big photo on the service page. Must match the names used on the home page cards.
VT_NAMES = {'tax.jpg': 'svc-tax', 'bk-payroll.jpg': 'svc-books', 'consulting.jpg': 'svc-consult', 'security.jpg': 'svc-future'}

# ===== SERVICE PAGE STYLES =====
# CSS: styles only the service pages need, added at the end of the copied style block.
# sd-hero, sd-blank, sd-bar, sd-back, sd-switch and sd-hero-img style what the page shows now;
# sd-items, sd-steps, sd-others, sd-cta, sd-lede, sd-more style sections the current template does not output.
CSS = """
  /* ===== service detail page ===== */
  .sd-hero{position:relative;overflow:hidden;padding:30px 0 70px;background:linear-gradient(180deg,#F5FBFF 0%,#E1F0FC 100%);}
  .sd-back{display:inline-flex;align-items:center;gap:8px;color:var(--primary);font-weight:700;font-size:.92rem;padding:8px 14px 8px 10px;border-radius:999px;transition:background .2s;}
  .sd-back:hover{background:#fff;}
  .sd-back i{transition:transform .2s;}
  .sd-back:hover i{transform:translateX(-3px);}
  .sd-back:focus-visible{outline:3px solid var(--secondary);outline-offset:2px;}
  .sd-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;margin-top:24px;}
  .sd-hero h1{color:var(--primary);font-size:2.9rem;font-weight:800;line-height:1.12;letter-spacing:-.4px;margin:12px 0 16px;}
  .sd-lede{color:var(--text);font-size:1.15rem;line-height:1.65;margin-bottom:12px;}
  .sd-more{color:var(--muted);line-height:1.7;margin-bottom:28px;}
  .sd-cta{display:flex;flex-wrap:wrap;gap:12px;}
  .sd-cta .btn{display:inline-flex;align-items:center;gap:10px;border-radius:999px;padding:14px 26px;}
  .btn.ghost{background:#fff;color:var(--primary);border:2px solid rgba(11,61,145,.2);box-shadow:none;}
  .btn.ghost:hover{border-color:var(--secondary);}
  .sd-hero-img{position:relative;border-radius:22px;overflow:hidden;box-shadow:0 30px 70px rgba(11,61,145,.22);aspect-ratio:4/3;}
  .sd-hero-img img{width:100%;height:100%;object-fit:cover;}
  .sd-hero-img .svc-ic{position:absolute;left:24px;bottom:24px;width:64px;height:64px;border-radius:16px;display:grid;place-items:center;
    background:linear-gradient(135deg,var(--primary),#1560C9);color:#fff;font-size:1.7rem;border:3px solid #fff;box-shadow:0 10px 22px rgba(11,61,145,.3);}
  .sd-sec{padding:70px 0;}
  .sd-sec h2{color:var(--primary);font-size:2.1rem;font-weight:800;margin:8px 0 30px;}
  .sd-items{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;}
  .sd-item{display:flex;gap:18px;padding:26px;background:#fff;border:1px solid rgba(207,229,246,.8);border-radius:16px;
    box-shadow:0 2px 4px rgba(11,61,145,.04),0 14px 34px rgba(11,61,145,.09);transition:transform .25s,box-shadow .25s;}
  .sd-item:hover{transform:translateY(-4px);box-shadow:0 4px 8px rgba(11,61,145,.05),0 22px 46px rgba(11,61,145,.15);}
  .sd-item .ic{flex:none;width:54px;height:54px;border-radius:50%;display:grid;place-items:center;font-size:1.3rem;background:#E3F0FD;color:var(--primary);}
  .sd-item:nth-child(even) .ic{background:#DDF7F2;color:#0F9C8A;}
  .sd-item h3{color:var(--primary);font-size:1.12rem;margin-bottom:6px;}
  .sd-item p{color:var(--muted);font-size:.95rem;line-height:1.6;}
  .sd-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;counter-reset:step;}
  .sd-step{position:relative;padding:28px 26px;background:#fff;border-radius:16px;border:1px solid rgba(207,229,246,.8);}
  .sd-step:before{counter-increment:step;content:counter(step,decimal-leading-zero);display:block;font-size:1.9rem;font-weight:800;margin-bottom:8px;
    background:linear-gradient(90deg,#1C8BDF,#3CCFC0);-webkit-background-clip:text;background-clip:text;color:transparent;}
  .sd-step h3{color:var(--primary);font-size:1.08rem;margin-bottom:6px;}
  .sd-step p{color:var(--muted);font-size:.93rem;line-height:1.6;}
  .sd-others{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;}
  .sd-other{display:flex;align-items:center;gap:16px;padding:16px;background:#fff;border-radius:16px;border:1px solid rgba(207,229,246,.8);
    box-shadow:0 10px 26px rgba(11,61,145,.08);transition:transform .25s,box-shadow .25s;}
  .sd-other:hover{transform:translateY(-4px);box-shadow:0 18px 40px rgba(11,61,145,.15);}
  .sd-other img{width:84px;height:84px;border-radius:12px;object-fit:cover;flex:none;}
  .sd-other b{display:block;color:var(--primary);font-size:1rem;line-height:1.3;}
  .sd-other span{color:#1C8BDF;font-size:.85rem;font-weight:700;}
  .sd-other:focus-visible{outline:3px solid var(--secondary);outline-offset:3px;}
  .sd-kicker{display:flex;align-items:center;gap:12px;color:#1C8BDF;font-weight:800;font-size:.9rem;letter-spacing:1.6px;text-transform:uppercase;}
  .sd-kicker:after{content:"";width:44px;height:2px;background:linear-gradient(90deg,#3BA7F2,#7FE7D6);}
  .sd-blank{padding-bottom:90px;}
  .sd-blank h1{margin:22px 0 28px;}
  .sd-blank .sd-hero-img{aspect-ratio:21/8;}
  @media(max-width:600px){.sd-blank .sd-hero-img{aspect-ratio:4/3;}}
  .sd-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;}
  .sd-switch{display:inline-flex;align-items:center;gap:12px;color:var(--gold-ink);font-weight:700;font-size:.8rem;letter-spacing:1.4px;text-transform:uppercase;}
  .sd-switch select{appearance:none;-webkit-appearance:none;font:inherit;font-size:.95rem;font-weight:600;letter-spacing:0;text-transform:none;color:var(--primary);
    padding:11px 44px 11px 18px;border-radius:999px;border:1px solid rgba(11,61,145,.2);cursor:pointer;
    background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%230B3D91' stroke-width='1.8'/%3E%3C/svg%3E") right 16px center/12px no-repeat;
    box-shadow:0 6px 16px rgba(11,61,145,.08);}
  .sd-switch select:focus-visible{outline:3px solid var(--secondary);outline-offset:2px;}
  @media(max-width:900px){.sd-grid{grid-template-columns:1fr;gap:32px;}.sd-hero-img{order:-1;}.sd-items,.sd-steps,.sd-others{grid-template-columns:1fr;}}
  @media(max-width:600px){.sd-hero h1{font-size:2rem;}.sd-sec{padding:50px 0;}.sd-sec h2{font-size:1.6rem;}.sd-item{padding:20px;}}
"""

# ===== OLD TRANSITION SCRIPTS (not used) =====
# HEAD_SCRIPT: would fade the page in after the zoom from a home page Services card.
# NOT USED: page() below never inserts it.
HEAD_SCRIPT = ("<script>/* arriving from the zoom on the Services cards: fade the page in */"
               "try{if(sessionStorage.getItem('svcZoom')){sessionStorage.removeItem('svcZoom');"
               "document.documentElement.classList.add('from-zoom');}}catch(e){}</script>\n")

# BODY_SCRIPT: would fade the page out when All Services is clicked. NOT USED either.
BODY_SCRIPT = """<script>
  /* "All Services" fades this page out and the Services card zooms back down on the home page */
  (function(){
    var page = location.pathname.split('/').pop();
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    document.querySelectorAll('.sd-back').forEach(function(a){
      a.addEventListener('click', function(e){
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
        try{ sessionStorage.setItem('svcBack', page); }catch(_){}
        if (reduce.matches) return;
        e.preventDefault();
        document.documentElement.classList.add('leaving');
        setTimeout(function(){ location.href = a.href; }, 220);
      });
    });
    // returning with the browser's back/forward cache: undo the fade-out
    window.addEventListener('pageshow', function(e){ if (e.persisted) document.documentElement.classList.remove('leaving'); });
  })();
</script>
"""

# ===== BUILD ONE PAGE =====
# page(svc, tpl) returns the full HTML of one service page.
#   svc = one dict from SERVICES; tpl = the text of financial-calculators.html.
# The page is glued from three parts:
#   head = the top of financial-calculators.html, down to its title band (head, styles, top bar, menu)
#   main = the service content from the template further down
#   foot = from the footer to the end of financial-calculators.html (footer, button, scripts, search)
# Every replace() below looks for EXACT text in financial-calculators.html. If that text changes there,
# the replace silently does nothing, so change the text here as well.
def page(svc, tpl):
    # where the calculators content starts (the title band section) and where the footer starts;
    # if either text is not found, the script stops with a ValueError
    i_main = tpl.index('<section class="sec-head"')
    i_foot = tpl.index('<footer>')
    # cut out the two shared parts
    head, foot = tpl[:i_main], tpl[i_foot:]
    # browser tab title: the calculators title becomes the service title
    head = head.replace('<title>Financial Calculators — Magnum CPA PC</title>', '<title>%s — Magnum CPA PC</title>' % svc['title'])
    # Google description: becomes the service title plus its lede
    head = head.replace(
        '<meta name="description" content="Handy financial calculators from Magnum CPA PC — tax, retirement, personal finance, savings, business, mortgage, loan, and vehicle calculators.">',
        '<meta name="description" content="%s %s">' % (svc['title'] + ' from Magnum CPA PC.', svc['lede']))
    # viewport line: replaced with identical text, so this step changes nothing
    head = head.replace('<meta name="viewport" content="width=device-width, initial-scale=1.0">',
                        '<meta name="viewport" content="width=device-width, initial-scale=1.0">')
    # add the service-page CSS (above) just before the closing style tag
    head = head.replace('</style>', CSS + '</style>')
    # menu: take the highlight off Resources ...
    head = head.replace('<a href="#" class="sub-toggle active">Resources ▾</a>', '<a href="#" class="sub-toggle">Resources ▾</a>')
    # ... and put it on Services instead
    head = head.replace('<a href="index.html#services" class="sub-toggle">Services ▾</a>', '<a href="index.html#services" class="sub-toggle active">Services ▾</a>')
    # in the Services drop-down, mark this page's own link as the current page (for screen readers)
    head = head.replace('<li><a href="%s">' % svc['file'], '<li><a href="%s" aria-current="page">' % svc['file'])
    # safety check: stop with an AssertionError if the title tag is missing or the Services highlight failed
    for k in ('<title>', 'sub-toggle active">Services'):
        assert k in head
    # form: link to the consultation form with this service pre-chosen (spaces, and, commas encoded).
    # NOT USED by the current template, and it still points at the old form spot on index.html.
    form = 'index.html?service=%s#request' % svc['key'].replace('&', '%26').replace(',', '%2C').replace(' ', '%20')
    # items: HTML cards for the list of offerings. NOT USED by the current template.
    items = ''.join('        <div class="sd-item"><span class="ic" aria-hidden="true"><i class="fa-solid %s"></i></span>'
                    '<div><h3>%s</h3><p>%s</p></div></div>\n' % (ic, t.replace('&', '&amp;'), d) for ic, t, d in svc['items'])
    # others: HTML links to the other three services. NOT USED by the current template.
    others = ''.join('        <a class="sd-other" href="%s"><img src="%s" alt="" loading="lazy"><div><b>%s</b><span>Learn more →</span></div></a>\n'
                     % (o['file'], o['img'], o['title']) for o in SERVICES if o is not svc)
    # ===== PAGE CONTENT TEMPLATE =====
    # The service page's own content. Each %(name)s spot is filled from the svc dict plus the extra
    # values listed after the closing quotes (vt, switch, h1, ...). Never type a lone percent sign inside it.
    main = """<main id="main">
<!-- ===== SERVICE PAGE TOP (built by tools/gen_services.py; edit it there, not in this page) ===== -->
<section class="sd-hero sd-blank">
  <div class="container">
    <!-- All Services back link, and the Switch service drop-down that jumps to another service page -->
    <div class="sd-bar">
      <a class="sd-back" href="index.html#services"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All Services</a>
      <label class="sd-switch"><span>Switch service</span>
        <select onchange="try{sessionStorage.setItem('vtZoom','1')}catch(e){}if(this.value)location.href=this.value" aria-label="Switch to another service">
%(switch)s        </select>
      </label>
    </div>
    <!-- big page heading (text comes from H1_MAP) -->
    <h1>%(h1)s</h1>
    <!-- service photo with its round icon badge -->
    <div class="sd-hero-img">
      <img src="%(img)s" width="800" height="1000" alt="" style="view-transition-name:%(vt)s">
      <span class="svc-ic" aria-hidden="true"><i class="fa-solid %(icon)s"></i></span>
    </div>
  </div>
</section>
</main>

""" % dict(svc, vt=VT_NAMES[svc['img'].split('/')[-1]], switch=''.join('          <option value="%s"%s>%s</option>\n' % (o['file'], ' selected' if o is svc else '', o['title']) for o in SERVICES), h1=H1_MAP[svc['title']], items=items, others=others, form=form, short=svc['short'].replace('&', '&amp;'))
    # glue the three parts together into the finished page
    return head + main + foot

# ===== RUN: WRITE THE FOUR PAGES =====
# read the template once, then write (overwrite) one page per service
calc = rd('financial-calculators.html')
for svc in SERVICES:
    wr(svc['file'], page(svc, calc))

# ===== SEARCH INDEX =====
# search entries for the new pages (both search indexes)
# entries(): the JavaScript search entries (title, url, snippet, keywords) for all four service pages.
# The prefix_index argument is not used.
def entries(prefix_index):
    return ''.join("      {title:%r, url:%r,\n       snippet:%r,\n       text:%r},\n"
                   % (s['title'], s['file'], s['lede'], ' '.join([s['title'], s['short']] + [t for _, t, _ in s['items']]).lower())
                   for s in SERVICES)
# Add those entries to the search list of both pages, just above the Client Newsletter entry.
# They are only added when missing, so a later change to a title or lede in SERVICES does NOT
# update the search lists; edit those entries by hand (request-consultation.html has a copy too).
for p in ('index.html', 'financial-calculators.html'):
    s = rd(p)
    # the line the entries go above; it must appear exactly once in each file, or the script stops
    anchor = "      {title:'Client Newsletter', url:"
    assert s.count(anchor) == 1, p
    # skip if the tax page is already in this search list (then the other three are assumed to be too)
    if "url:'tax-preparation-planning.html'" not in s:
        s = s.replace(anchor, entries(p) + anchor)
    # the file is written back even when nothing changed
    wr(p, s)
# done
print('ok')
