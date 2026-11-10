"""Builds the "What Our Clients Say" review cards in index.html from reviews.xlsx.

Run by update-reviews.bat (or by hand: `python tools/build_reviews.py .` from the repo root).
Only the parts of index.html between the REVIEWS:START/END and REVIEW-BUTTON:START/END
markers are replaced; everything else on the page is left alone.

reviews.xlsx
  sheet "Reviews":  Show | Stars | Name | Title (optional) | Review | Review Link (optional)
                    one row per review, in the order they appear in the slideshow;
                    only rows with Show = Yes are published. No such rows = the
                    slideshow is hidden on the page (only the Google buttons show).
  sheet "Settings": B2 = your "Leave a review" link (blank = no button).
                    B3 = your "See all our reviews on Google" link (blank = no button).
"""
import html, io, re, sys

try:
    import openpyxl
except ImportError:
    sys.exit('ERROR: the openpyxl package is missing. Run:  python -m pip install --user openpyxl')

root = sys.argv[1] if len(sys.argv) > 1 else '.'
XLSX, PAGE = root + '/reviews.xlsx', root + '/index.html'


def fail(msg):
    sys.exit('ERROR: ' + msg)


def text(v):
    return '' if v is None else str(v).strip()


def esc(s):
    # line breaks typed in a cell (Alt+Enter) become line breaks on the page
    return '<br>'.join(html.escape(line.strip(), quote=False) for line in s.splitlines() if line.strip())


def link(s, where):
    if s and not re.match(r'https://\S+$', s):
        fail('%s: the link must start with https:// and have no spaces (got "%s").' % (where, s))
    return html.escape(s, quote=True)


try:
    wb = openpyxl.load_workbook(XLSX, data_only=True)
except FileNotFoundError:
    fail('reviews.xlsx was not found in the website folder.')
except PermissionError:
    fail('reviews.xlsx is locked. Save it and close Excel, then try again.')
for name in ('Reviews', 'Settings'):
    if name not in wb.sheetnames:
        fail('reviews.xlsx needs a sheet named "%s".' % name)

# ---- review rows -> cards ----
cards = []
for r, row in enumerate(wb['Reviews'].iter_rows(min_row=2, max_col=6, values_only=True), start=2):
    show, stars, name, title, body, url = (text(v) for v in row)
    if not any((show, stars, name, title, body, url)):
        continue                                   # empty row
    if show.lower() not in ('yes', 'y'):
        continue                                   # hidden on purpose
    where = 'Reviews sheet, row %d' % r
    if not body:
        fail(where + ': the Review text is empty.')
    try:
        n = int(float(stars))
    except ValueError:
        n = 0
    if not 1 <= n <= 5:
        fail(where + ': Stars must be a number from 1 to 5 (got "%s").' % stars)
    card = ['            <div class="review">',
            '              <div class="stars" role="img" aria-label="%d out of 5 stars">%s</div>' % (n, '★' * n)]
    if title:
        card.append('              <h4>%s</h4>' % esc(title))
    card.append('              <p>%s</p>' % esc(body))
    if name or url:
        card.append('              <div class="rev-by">')
        card.append('                <i class="fa-brands fa-google" aria-hidden="true"></i>')
        card.append('                <span>%s</span>' % (esc(name) + ' · Google review' if name else 'Google review'))
        if url:
            card.append('                <a href="%s" target="_blank" rel="noopener">Read on Google</a>' % link(url, where))
        card.append('              </div>')
    card.append('            </div>')
    cards.append('\n'.join(card))
# No cards is allowed: the review slider script in index.html then hides the empty slideshow.

# ---- settings -> "Leave Us a Google Review" (B2) and "See All Our Reviews on Google" (B3) buttons ----
def pill(url, cell, label, cls):
    return ('        <a href="%s" class="btn-pill%s" target="_blank" rel="noopener">'
            '<i class="fa-brands fa-google" aria-hidden="true"></i><span class="sep" aria-hidden="true"></span>'
            '%s <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>\n'
            % (link(url, 'Settings sheet, ' + cell), cls, label))


leave_url, all_url = text(wb['Settings']['B2'].value), text(wb['Settings']['B3'].value)
pills = ''
if leave_url:
    pills += pill(leave_url, 'B2', 'Leave Us a Google Review', '')
if all_url:
    pills += pill(all_url, 'B3', 'See All Our Reviews on Google', ' ghost')
button = ('      <div class="rev-leave">\n%s      </div>\n' % pills) if pills else ''

# ---- write them into index.html between the markers ----
page = io.open(PAGE, encoding='utf-8').read()


def put(page, tag, content):
    start, end = '<!-- %s:START' % tag, '<!-- %s:END -->' % tag
    if page.count(start) != 1 or page.count(end) != 1:
        fail('index.html is missing its %s markers; ask for the review section to be repaired.' % tag)
    i = page.index('-->', page.index(start)) + 3        # keep the START comment itself
    j = page.rindex('\n', 0, page.index(end)) + 1       # keep the END comment's indent line
    return page[:i] + '\n' + content + page[j:]


new = put(page, 'REVIEWS', ''.join(c + '\n' for c in cards))
new = put(new, 'REVIEW-BUTTON', button)
if new == page:
    print('Reviews are already up to date (%d shown).' % len(cards))
else:
    io.open(PAGE, 'w', encoding='utf-8', newline='').write(new)
    print('Updated index.html: %d review(s) shown, %d Google button(s).' % (len(cards), pills.count('<a ')))
