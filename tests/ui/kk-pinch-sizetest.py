#!/usr/bin/env python3
"""Headless pinch + ctrl+wheel scaling of the chord-chart Size slider."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

PORT = int(os.environ.get('PORT', '3060'))
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = '/workspace/kk-app-shots/'
os.makedirs(SHOTS, exist_ok=True)

results = []
def rec(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS ' if ok else 'FAIL ') + name + ((' — ' + str(detail)) if detail and not ok else (' — ' + str(detail) if detail and not ok else ('' if ok else ''))), flush=True)
    if ok and detail:
        print('      ' + str(detail)[:200], flush=True)

async def size_state(pg):
    return await pg.evaluate('''() => {
      const box = document.querySelector('#chartBox');
      const sl = document.querySelector('#tbSize');
      const lab = document.querySelector('#tbSizeV');
      return {
        slider: Number(sl && sl.value),
        label: lab && lab.textContent.trim(),
        min: Number(sl && sl.min),
        max: Number(sl && sl.max),
        fontPx: parseFloat(box && box.style.fontSize) || parseFloat(getComputedStyle(box).fontSize),
        locked: !box.isContentEditable,
        scale: (window.visualViewport && window.visualViewport.scale) || 1,
        scrollTop: box.scrollTop,
        defaultPreventedWheel: null
      };
    }''')

async def set_slider(pg, val):
    await pg.evaluate('''(v) => {
      const sl = document.querySelector('#tbSize');
      sl.value = String(v);
      sl.dispatchEvent(new Event('input', {bubbles:true}));
    }''', val)
    await pg.wait_for_timeout(50)

async def pinch(pg, start_dist, end_dist, steps=6):
    return await pg.evaluate('''([s, e, steps]) => {
      const box = document.querySelector('#chartBox');
      const r = box.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + Math.min(140, Math.max(40, r.height/2));
      const mk = (id, x, y) => new Touch({identifier:id, target:box, clientX:x, clientY:y, pageX:x, pageY:y, radiusX:2.5, radiusY:2.5, rotationAngle:0, force:1});
      const fire = (type, dist) => {
        const down = type !== 'touchend' && type !== 'touchcancel';
        const t1 = mk(1, cx - dist/2, cy), t2 = mk(2, cx + dist/2, cy);
        const list = down ? [t1, t2] : [];
        const ev = new TouchEvent(type, {bubbles:true, cancelable:true, touches:list, targetTouches:list, changedTouches:[t1,t2], view:window});
        return box.dispatchEvent(ev);
      };
      fire('touchstart', s);
      let lastDefault = true;
      for (let i = 1; i <= steps; i++) {
        lastDefault = !fire('touchmove', s + (e - s) * i / steps) || lastDefault;
      }
      fire('touchend', e);
      return {ok:true};
    }''', [start_dist, end_dist, steps])

async def ctrl_wheel(pg, delta_y, times=1):
    return await pg.evaluate('''([dy, n]) => {
      const box = document.querySelector('#chartBox');
      let prevented = 0;
      for (let i = 0; i < n; i++) {
        const ev = new WheelEvent('wheel', {bubbles:true, cancelable:true, deltaY:dy, deltaMode:0, ctrlKey:true, view:window});
        const notDefault = !box.dispatchEvent(ev);
        if (notDefault || ev.defaultPrevented) prevented++;
      }
      return {prevented, n};
    }''', [delta_y, times])

async def plain_wheel(pg, delta_y):
    return await pg.evaluate('''(dy) => {
      const box = document.querySelector('#chartBox');
      const ev = new WheelEvent('wheel', {bubbles:true, cancelable:true, deltaY:dy, deltaMode:0, ctrlKey:false, view:window});
      box.dispatchEvent(ev);
      return ev.defaultPrevented;
    }''', delta_y)

async def open_chart(pg, sid):
    await pg.evaluate(f'openSong({sid})')
    await pg.wait_for_selector('#chartBox')
    await pg.wait_for_timeout(400)

async def shot(pg, name):
    # Keep the Size slider and the top of the chart in the same frame.
    await pg.evaluate("""() => {
      const tb = document.querySelector('#toolbar');
      if (tb) tb.scrollIntoView({block:'start'});
    }""")
    await pg.wait_for_timeout(200)
    await pg.screenshot(path=SHOTS + name, full_page=False)

async def run_on(pg, tag, sid):
    await open_chart(pg, sid)
    rec(f'{tag} chart opened locked', (await size_state(pg))['locked'] is True)

    await set_slider(pg, 19)
    await pg.wait_for_timeout(50)
    before = await size_state(pg)
    rec(f'{tag} starts at 19', before['slider'] == 19 and before['label'] == '19' and abs(before['fontPx'] - 19) < 0.6, before)
    await shot(pg, f'pinch-{tag}-before.png')

    # Two-finger pinch out (~1.5x): 19 * 1.5 = 28.5 -> 29
    await pinch(pg, 80, 120)
    after = await size_state(pg)
    rec(f'{tag} pinch-out grows size and slider', after['slider'] >= 26 and after['slider'] <= 31 and after['label'] == str(after['slider']) and abs(after['fontPx'] - after['slider']) < 1.1, after)
    rec(f'{tag} page did not zoom after pinch', abs(after['scale'] - 1) < 0.02, after['scale'])
    await shot(pg, f'pinch-{tag}-after.png')

    # Pinch in from current, then clamp zoom-out
    await set_slider(pg, 19)
    await pinch(pg, 160, 40)  # 19 * 0.25 = 4.75 -> 12
    clamped = await size_state(pg)
    rec(f'{tag} pinch-in clamps at min 12', clamped['slider'] == 12 and clamped['label'] == '12' and abs(clamped['fontPx'] - 12) < 0.6, clamped)

    await set_slider(pg, 19)
    await pinch(pg, 40, 400)  # huge zoom -> 34
    hi = await size_state(pg)
    rec(f'{tag} pinch-out clamps at max 34', hi['slider'] == 34 and hi['label'] == '34' and abs(hi['fontPx'] - 34) < 0.6, hi)

    # ctrl+wheel (Mac trackpad pinch in Chrome)
    await set_slider(pg, 19)
    wheel = await ctrl_wheel(pg, -80, times=8)
    wstate = await size_state(pg)
    rec(f'{tag} ctrl+wheel zooms in and is prevented', wstate['slider'] > 19 and wstate['slider'] <= 34 and wheel['prevented'] == wheel['n'], {**wstate, **wheel})
    rec(f'{tag} page did not zoom after ctrl+wheel', abs(wstate['scale'] - 1) < 0.02, wstate['scale'])

    await set_slider(pg, 19)
    wheel_out = await ctrl_wheel(pg, 80, times=8)
    wout = await size_state(pg)
    rec(f'{tag} ctrl+wheel zooms out', wout['slider'] < 19 and wout['slider'] >= 12, wout)

    # plain wheel must not change size (and should not be preventDefaulted)
    await set_slider(pg, 22)
    prevented_plain = await plain_wheel(pg, 120)
    plain = await size_state(pg)
    rec(f'{tag} plain wheel does not change size', plain['slider'] == 22 and abs(plain['fontPx'] - 22) < 0.6 and prevented_plain is False, dict(plain, prevented=prevented_plain))

    # one-finger touch should not change size
    await pg.evaluate('''() => {
      const box = document.querySelector('#chartBox');
      const r = box.getBoundingClientRect();
      const mk = (y) => new Touch({identifier:1, target:box, clientX:r.left+40, clientY:y, pageX:r.left+40, pageY:y, radiusX:2, radiusY:2, rotationAngle:0, force:1});
      const fire = (type, y, downs) => {
        const t = mk(y);
        box.dispatchEvent(new TouchEvent(type, {bubbles:true, cancelable:true, touches:downs?[t]:[], targetTouches:downs?[t]:[], changedTouches:[t], view:window}));
      };
      const y0 = r.top + 80;
      fire('touchstart', y0, true);
      fire('touchmove', y0 + 40, true);
      fire('touchend', y0 + 40, false);
    }''')
    one = await size_state(pg)
    rec(f'{tag} one-finger touch leaves size alone', one['slider'] == 22, one)

    # persist after pinch, locked
    await set_slider(pg, 19)
    await pinch(pg, 80, 120)
    mid = await size_state(pg)
    await pg.wait_for_timeout(900)
    saved = await pg.evaluate(f"fetch('/api/songs/{sid}').then(r=>r.json()).then(d=>d.song.chartSize)")
    rec(f'{tag} pinch size persisted (locked)', saved == mid['slider'], dict(saved=saved, mid=mid['slider']))
    await open_chart(pg, sid)
    re = await size_state(pg)
    rec(f'{tag} size survives reload', re['slider'] == mid['slider'] and re['label'] == str(mid['slider']) and abs(re['fontPx'] - mid['slider']) < 0.6, re)

    # also works while unlocked / editing
    await pg.locator('#lockBtn').click()
    await pg.wait_for_timeout(300)
    rec(f'{tag} unlocked', (await size_state(pg))['locked'] is False)
    await set_slider(pg, 19)
    await pinch(pg, 80, 130)
    ed = await size_state(pg)
    rec(f'{tag} pinch works while editing', ed['slider'] > 19 and ed['locked'] is False, ed)
    await pg.wait_for_timeout(900)
    saved2 = await pg.evaluate(f"fetch('/api/songs/{sid}').then(r=>r.json()).then(d=>d.song.chartSize)")
    rec(f'{tag} pinch size persisted (editing)', saved2 == ed['slider'], dict(saved=saved2, ed=ed['slider']))

    # reset to 19 so we leave the song tidy for other tests
    await set_slider(pg, 19)
    await pg.wait_for_timeout(900)

async def main():
    # pick a charted song
    import urllib.request
    with urllib.request.urlopen(BASE+'/api/songs?visible=0') as r:
        songs = json.loads(r.read())['songs']
    charted = [s for s in songs if s.get('hasChart')]
    prefer = next((s for s in charted if s.get('title') == 'Hotel California'), charted[0] if charted else None)
    if not prefer:
        rec('need a charted song', False, 'none found')
        return 1
    sid = prefer['id']
    rec('using charted song', True, f"{prefer['title']} #{sid}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome', headless=True)
        # phone-sized, touch
        ctx = await browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        await pg.goto(BASE+'/')
        await pg.wait_for_timeout(800)
        await run_on(pg, 'phone', sid)
        rec('phone no page errors', not errs, errs)
        await ctx.close()

        # iPad-sized, touch
        ctx2 = await browser.new_context(viewport={'width':810,'height':1080}, is_mobile=True, has_touch=True, device_scale_factor=2)
        pg2 = await ctx2.new_page()
        errs2 = []
        pg2.on('pageerror', lambda e: errs2.append('PAGEERROR '+str(e)))
        await pg2.goto(BASE+'/')
        await pg2.wait_for_timeout(800)
        await run_on(pg2, 'ipad', sid)
        rec('ipad no page errors', not errs2, errs2)
        await ctx2.close()
        await browser.close()

    fails = [r for r in results if not r[1]]
    print(f"\n{sum(1 for r in results if r[1])} passed, {len(fails)} failed, {len(results)} total")
    for n,_,d in fails:
        print('  FAIL', n, d)
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
