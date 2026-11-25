#!/usr/bin/env python3
"""Headless paste of realistic Apple Notes HTML into the chord-chart editor."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

PORT = int(os.environ.get('PORT', '3055'))
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = '/workspace/kk-app-shots/'
os.makedirs(SHOTS, exist_ok=True)

NOTES_STYLE = '''<html>
<head>
<meta charset="utf-8">
<style type="text/css">
p.p1 {margin: 0.0px 0.0px 0.0px 0.0px; font: 18.0px 'Helvetica Neue'; color: #000000; -webkit-text-stroke: #000000}
span.s1 {font-kerning: none; color: #ff3b30; -webkit-text-stroke: 0px #ff3b30}
span.s2 {font-kerning: none; color: #ffcc00; -webkit-text-stroke: 0px #ffcc00}
span.s3 {font-kerning: none; color: #34c759}
span.s4 {text-decoration: underline; color: #007aff}
</style>
</head>
<body>
<!--StartFragment-->
<p class="p1">[Verse]</p>
<p class="p1"><span class="s1">C</span> When I find myself in times of <span class="s2">G</span>trouble</p>
<p class="p1"><span class="s3">Am</span> Mother Mary comes to <b>me</b></p>
<p class="p1"><span class="s4">F</span> Speaking words of wisdom</p>
<!--EndFragment-->
</body>
</html>'''

NOTES_DARK = '''Version:0.9
StartHTML:0000000189
EndHTML:0000000600
StartFragment:0000000189
EndFragment:0000000600
<html><head><style>
p.p1 {color: #ffffff; font: 18.0px 'Helvetica Neue'}
span.s1 {color: #ff3b30}
</style></head>
<body><!--StartFragment-->
<p class="p1">plain default <span class="s1">C</span> red chord</p>
<!--EndFragment--></body></html>'''

INLINE = '<div><span style="color: rgb(255, 38, 0)">Can I sail through the changin ocean tides?</span><script>window.__pwned=1</script></div>'
FONT = '<div><font color="#FEFF0A">G</font> in times of trouble</div>'
STYLE_BODY = '<style>.s1 {color: rgb(33, 203, 255)}</style><div><span class="s1">E</span> lyric<img src=x onerror="window.__pwned=2"></div>'
FILL = '<div><span style="-webkit-text-fill-color: rgb(251, 0, 255)">F#</span> fill-color chord</div>'

results = []
def rec(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS ' if ok else 'FAIL ') + name + ((' — ' + str(detail)) if detail else ''), flush=True)

async def paste(pg, html, plain='pasted'):
    # Escape for JS template via json
    payload = json.dumps(html)
    plain_js = json.dumps(plain)
    return await pg.evaluate(f'''() => {{
      const box = document.querySelector('#chartBox');
      box.focus();
      const r = document.createRange();
      r.selectNodeContents(box);
      r.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      const dt = new DataTransfer();
      dt.setData('text/html', {payload});
      dt.setData('text/plain', {plain_js});
      box.dispatchEvent(new ClipboardEvent('paste', {{clipboardData: dt, bubbles: true, cancelable: true}}));
      return box.innerHTML;
    }}''')

def colors_of(html, needle):
    # helper used only in python assertions after evaluate returns structured data
    return html

async def colors_near(pg, text):
    return await pg.evaluate('''(text) => {
      const box = document.querySelector('#chartBox');
      const hit = document.evaluate(
        ".//*[contains(normalize-space(text()), '" + text + "')]",
        box, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
      ).singleNodeValue || [...box.querySelectorAll('*')].find(x => x.childNodes.length && [...x.childNodes].some(n => n.nodeType===3 && n.nodeValue.includes(text)));
      if (!hit) return {found:false, color:'', html: box.innerHTML.slice(0,800)};
      return {found:true, color: getComputedStyle(hit).color, underline: getComputedStyle(hit).textDecorationLine || getComputedStyle(hit).textDecoration, bold: getComputedStyle(hit).fontWeight, html: hit.outerHTML};
    }''', text)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome', headless=True)
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 900}, device_scale_factor=1)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        created = await pg.request.post(f'{BASE}/api/songs', data={
            'title': 'Paste Colour Test',
            'artist': 'Apple Notes',
            'noteHtml': '<div>ready</div>',
            'visible': False
        })
        rec('create test song', created.ok, created.status)
        song = (await created.json())['song']
        sid = song['id']

        await pg.goto(BASE + '/')
        await pg.wait_for_timeout(800)
        await pg.evaluate('openSong(' + str(sid) + ')')
        await pg.wait_for_timeout(600)
        rec('chart opened', await pg.locator('#chartBox').count() == 1)

        await pg.locator('#lockBtn').click()
        await pg.wait_for_timeout(300)
        rec('unlocked', await pg.evaluate("document.querySelector('#chartBox').isContentEditable"))

        # Clear the starter text so the paste is the whole chart
        await pg.evaluate("document.querySelector('#chartBox').innerHTML=''")

        html = await paste(pg, NOTES_STYLE, 'C When I find myself')
        await pg.wait_for_timeout(400)
        rec('style-block paste has no <style> or s1 class', '<style' not in html.lower() and 's1' not in html, html[:240])

        c = await colors_near(pg, 'C')
        g = await colors_near(pg, 'G')
        am = await colors_near(pg, 'Am')
        f = await colors_near(pg, 'F')
        me = await colors_near(pg, 'me')
        verse = await colors_near(pg, '[Verse]')
        rec('style-block red C', c.get('found') and c['color'] == 'rgb(255, 59, 48)', c)
        rec('style-block yellow G', g.get('found') and g['color'] == 'rgb(255, 204, 0)', g)
        rec('style-block green Am', am.get('found') and am['color'] == 'rgb(52, 199, 89)', am)
        rec('style-block blue underlined F', f.get('found') and f['color'] == 'rgb(0, 122, 255)' and 'underline' in (f.get('underline') or ''), f)
        rec('style-block bold me kept', me.get('found') and (str(me.get('bold')) in ('700','800','bold') or int(str(me.get('bold') or '0') or 0) >= 600), me)
        rec('style-block default [Verse] is editor white', verse.get('found') and verse['color'] == 'rgb(255, 255, 255)', verse)
        rec('no scripts ran on style-block paste', await pg.evaluate('window.__pwned||0') == 0)

        await pg.screenshot(path=SHOTS + 'paste-colors-style-block.png')

        await pg.locator('#lockBtn').click()  # Save & lock
        await pg.wait_for_timeout(800)
        saved = await pg.evaluate(f"fetch('/api/songs/{sid}').then(r=>r.json()).then(d=>d.song.noteHtml)")
        rec('saved note inlines colours, no style/script',
            all(x in saved.lower().replace(' ', '') for x in ['#ff3b30' if '#ff3b30' in saved.lower() else '255,59,48'.replace(',', '')]) or (
                ('255, 59, 48' in saved or '#ff3b30' in saved.lower()) and
                ('255, 204, 0' in saved or '#ffcc00' in saved.lower()) and
                ('52, 199, 89' in saved or '#34c759' in saved.lower()) and
                ('0, 122, 255' in saved or '#007aff' in saved.lower())
            ) and '<style' not in saved.lower() and '<script' not in saved.lower() and 'class="s1"' not in saved,
            saved[:400])
        # clearer check
        rec('saved HTML has all four colours',
            (('255, 59, 48' in saved or '#ff3b30' in saved.lower()) and
             ('255, 204, 0' in saved or '#ffcc00' in saved.lower()) and
             ('52, 199, 89' in saved or '#34c759' in saved.lower()) and
             ('0, 122, 255' in saved or '#007aff' in saved.lower())),
            saved[:400])

        # Reload the song from the server
        await pg.evaluate(f'openSong({sid})')
        await pg.wait_for_timeout(900)
        c2 = await colors_near(pg, 'C')
        g2 = await colors_near(pg, 'G')
        am2 = await colors_near(pg, 'Am')
        f2 = await colors_near(pg, 'F')
        rec('reload red C', c2.get('found') and c2['color'] == 'rgb(255, 59, 48)', c2)
        rec('reload yellow G', g2.get('found') and g2['color'] == 'rgb(255, 204, 0)', g2)
        rec('reload green Am', am2.get('found') and am2['color'] == 'rgb(52, 199, 89)', am2)
        rec('reload blue underlined F', f2.get('found') and f2['color'] == 'rgb(0, 122, 255)' and 'underline' in (f2.get('underline') or ''), f2)
        rec('reload default [Verse] still white', (await colors_near(pg, '[Verse]'))['color'] == 'rgb(255, 255, 255)')
        await pg.screenshot(path=SHOTS + 'paste-colors-after-reload.png')

        # Other clipboard shapes, appended after unlock
        await pg.locator('#lockBtn').click()
        await pg.wait_for_timeout(300)

        await paste(pg, INLINE, 'Can I sail through the changin ocean tides?')
        await pg.wait_for_timeout(200)
        inl = await pg.evaluate("""() => [...document.querySelector('#chartBox').querySelectorAll('*')].some(x => x.textContent.includes('changin ocean tides') && getComputedStyle(x).color==='rgb(255, 38, 0)')""")
        rec('inline style rgb red kept', inl, 'expected a span at rgb(255, 38, 0)')
        rec('inline paste strips script', await pg.evaluate("document.querySelectorAll('#chartBox script, #chartBox img').length") == 0 and await pg.evaluate('window.__pwned||0') == 0)

        await paste(pg, FONT, 'in times of trouble')
        await pg.wait_for_timeout(200)
        fontc = await colors_near(pg, 'G')
        # There may be two G's; check the font one exists somewhere as yellow
        yellows = await pg.evaluate('''() => [...document.querySelector('#chartBox').querySelectorAll('*')].filter(x => getComputedStyle(x).color==='rgb(254, 255, 10)' && x.textContent.includes('G')).map(x => x.textContent)''')
        rec('font color yellow G kept', len(yellows) > 0, yellows)

        await paste(pg, STYLE_BODY, 'lyric')
        await pg.wait_for_timeout(200)
        cy = await pg.evaluate('''() => [...document.querySelector('#chartBox').querySelectorAll('*')].some(x => x.textContent.trim()==='E' && getComputedStyle(x).color==='rgb(33, 203, 255)')''')
        rec('body <style> class cyan E kept', cy)
        rec('img/script still stripped', await pg.evaluate("document.querySelectorAll('#chartBox script, #chartBox img').length") == 0 and await pg.evaluate('window.__pwned||0') == 0)

        await paste(pg, FILL, 'fill-color chord')
        await pg.wait_for_timeout(200)
        mag = await pg.evaluate('''() => [...document.querySelector('#chartBox').querySelectorAll('*')].some(x => x.textContent.includes('F#') && getComputedStyle(x).color==='rgb(251, 0, 255)')''')
        rec('webkit-text-fill-color magenta F# kept', mag)

        # Clear and paste dark-mode Notes (default white + red C)
        await pg.evaluate("document.querySelector('#chartBox').innerHTML=''")
        await paste(pg, NOTES_DARK, 'plain default C red chord')
        await pg.wait_for_timeout(300)
        dark = await pg.evaluate('''() => {
          const box = document.querySelector('#chartBox');
          const c = [...box.querySelectorAll('*')].find(x => x.textContent.trim()==='C' && x.children.length===0);
          const plain = [...box.querySelectorAll('*')].find(x => (x.textContent||'').includes('plain default'));
          return {c: c && getComputedStyle(c).color, plain: plain && getComputedStyle(plain).color, html: box.innerHTML};
        }''')
        rec('dark-mode Notes red C kept', dark.get('c') == 'rgb(255, 59, 48)', dark)
        rec('dark-mode default text is editor white (not forced black)', dark.get('plain') == 'rgb(255, 255, 255)', dark)
        rec('dark-mode default white not stored as inline #fff', '#ffffff' not in (dark.get('html') or '').lower() and '255, 255, 255' not in (dark.get('html') or ''), dark.get('html'))
        await pg.screenshot(path=SHOTS + 'paste-colors-dark-mode.png')

        await pg.locator('#lockBtn').click()
        await pg.wait_for_timeout(800)
        rec('no page errors', not errs, errs)
        await browser.close()

    fails = [r for r in results if not r[1]]
    print(f"\n{sum(1 for r in results if r[1])} passed, {len(fails)} failed, {len(results)} total")
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
