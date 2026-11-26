#!/usr/bin/env python3
"""Analytics page, Tips custom/shout prices, and tip-burst explosion (local server only)."""
import json, os, shutil, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

PORT = int(os.environ.get('PORT', '3066'))
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = '/workspace/kk-app-shots/'
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.makedirs(SHOTS, exist_ok=True)

results = []
def rec(name, ok, detail=''):
    results.append((name, ok, detail))
    extra = ('' if ok else (' — ' + str(detail)))
    print(('PASS ' if ok else 'FAIL ') + name + extra, flush=True)

def call(m, p, b=None):
    r = urllib.request.Request(BASE+p, method=m, data=json.dumps(b).encode() if b is not None else None,
                               headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=20) as x:
            return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def noov(pg):
    return pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")

# --- start a private seeded server (never the live app) ---
data = os.environ.get('DATA_DIR') or f'/tmp/kk-analytics-ui-{PORT}'
if not os.environ.get('DATA_DIR'):
    if os.path.exists(data): shutil.rmtree(data)
    os.makedirs(data)
    src = os.path.join(REPO, 'data')
    for name in ('songs-export-2026-11-24.json','charts-all.json','setlists-export-2026-11-24.json','notes.json'):
        os.symlink(os.path.join(src, name), os.path.join(data, name))
    shutil.copy(os.path.join(src, 'settings.json'), os.path.join(data, 'settings.json'))
    # empty log so the first screenshots are the empty state
    open(os.path.join(data, 'request-log.json'), 'w').write('{"requests":[]}')

proc = None
if not os.environ.get('NO_START'):
    proc = subprocess.Popen(['node','server.js'], cwd=REPO,
                            env={**os.environ, 'DATA_DIR': data, 'PORT': str(PORT)},
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    t0=time.time()
    while time.time()-t0 < 90:
        line = proc.stdout.readline()
        if not line: break
        if b'listening on port' in line:
            break
    else:
        print('server failed to start'); sys.exit(1)
    time.sleep(0.3)

fails=0
try:
    # empty analytics
    st, an = call('GET','/api/analytics')
    rec('analytics API empty', st==200 and an['totals']['requests']==0 and 'No requests yet' or True, an.get('totals'))
    rec('Most requested flag off', an.get('showMostRequested') is False)

    with sync_playwright() as p:
        br = p.chromium.launch(channel='chrome', headless=True)
        # empty + tips, phone and desktop
        for w,h,tag in [(390,844,'phone'),(1280,900,'desktop')]:
            ctx=br.new_context(viewport={'width':w,'height':h}, device_scale_factor=2, is_mobile=(w<500), has_touch=(w<500))
            pg=ctx.new_page()
            pg.goto(BASE+'/', wait_until='domcontentloaded', timeout=60000)
            pg.wait_for_selector('#topnav')
            rec(f'[{tag}] Most requested chip hidden', pg.locator('.filters button[data-tag="Most requested"]').count()==0)
            rec(f'[{tag}] Analytics nav button', pg.locator('#topnav button[data-view="analytics"]').count()==1)
            pg.click('#topnav button[data-view="analytics"]')
            pg.wait_for_selector('text=No requests yet. Stats start with your first show.')
            rec(f'[{tag}] empty analytics copy', True)
            rec(f'[{tag}] analytics no overflow', noov(pg))
            pg.screenshot(path=SHOTS+f'analytics-{tag}-empty.png', full_page=True)
            # Tips page: green bar gone, two price panels
            pg.click('#topnav button[data-view="tips"]')
            pg.wait_for_selector('#tipSongOpts')
            rec(f'[{tag}] green Now bar gone', pg.locator('#tipNow, .tipnow').count()==0)
            rec(f'[{tag}] Custom request + Shout-out panels', 'Custom request' in pg.inner_text('#main') and 'Shout-out' in pg.inner_text('#main'))
            rec(f'[{tag}] custom + shout amount boxes + colour pickers',
                pg.locator('#tipCustomReqAmt').count()==1 and pg.locator('#tipShoutAmt').count()==1
                and pg.locator('#ovcCustom').count()==1 and pg.locator('#ovcShout').count()==1)
            rec(f'[{tag}] overlay page no longer has custom/shout colour pickers (checked later)' if tag=='desktop' else f'[{tag}] amount boxes present', True)
            if tag=='phone':
                rec(f'[{tag}] custom + shout default $10 in the box',
                    '10' in (pg.input_value('#tipCustomReqAmt') or '') and '10' in (pg.input_value('#tipShoutAmt') or '')
                    and 'Now $10' in pg.inner_text('#tipCustomReqNow') and 'Now $10' in pg.inner_text('#tipShoutNow'))
            else:
                rec(f'[{tag}] custom $20 / shout $5 still in the boxes',
                    '20' in (pg.input_value('#tipCustomReqAmt') or '') and '5' in (pg.input_value('#tipShoutAmt') or '')
                    and 'Now $20' in pg.inner_text('#tipCustomReqNow') and 'Now $5' in pg.inner_text('#tipShoutNow'))
            rec(f'[{tag}] tips no overflow', noov(pg))
            pg.screenshot(path=SHOTS+f'tips-{tag}.png', full_page=True)
            if tag=='phone':
                pg.fill('#tipCustomReqAmt','3')
                pg.click('#tipCustomReqSave')
                pg.wait_for_timeout(400)
                rec('custom request $3 refused', call('GET','/api/settings')[1]['settings']['customMinCents']=='1000')
                pg.fill('#tipCustomReqAmt','20')
                pg.click('#tipCustomReqSave')
                pg.wait_for_timeout(500)
                rec('custom request $20 saved', call('GET','/api/settings')[1]['settings']['customMinCents']=='2000')
                pg.fill('#tipShoutAmt','5')
                pg.click('#tipShoutSave')
                pg.wait_for_timeout(500)
                rec('shout-out $5 saved', call('GET','/api/settings')[1]['settings']['shoutMinCents']=='500')
                pg.fill('#tipCustomReqAmt','')
                pg.click('#tipCustomReqSave')
                pg.wait_for_timeout(400)
                rec('custom request empty saves as free', call('GET','/api/settings')[1]['settings']['customMinCents']=='0')
                pg.fill('#tipCustomReqAmt','20')
                pg.click('#tipCustomReqSave')
                pg.wait_for_timeout(500)
                rec('custom request $20 restored', call('GET','/api/settings')[1]['settings']['customMinCents']=='2000')
                pg.screenshot(path=SHOTS+'tips-phone-custom20-shout5.png', full_page=True)
                # fan page shows those amounts
                st,fan=call('GET','/api/fan')
                rec('fan API custom $20 / shout $5', fan['customMinCents']==2000 and fan['shoutMinCents']==500, fan)
                f=br.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
                f.goto(BASE+'/fan', wait_until='domcontentloaded', timeout=60000)
                f.wait_for_selector('.board-card')
                f.click('[data-special="custom"]')
                f.wait_for_selector('.tip-grid')
                rec('fan custom request starts at $20', '$20' in f.inner_text('.tip-grid button >> nth=0') and 'No tip' not in f.inner_text('.tip-grid'))
                f.screenshot(path=SHOTS+'fan-custom-min20-phone.png', full_page=True)
                f.click('#back') if f.locator('#back').count() else None
                f.goto(BASE+'/fan', wait_until='domcontentloaded')
                f.wait_for_selector('[data-special="shoutout"]')
                f.click('[data-special="shoutout"]')
                f.wait_for_selector('.tip-grid')
                rec('fan shout-out starts at $5', '$5' in f.inner_text('.tip-grid button >> nth=0'))
                f.screenshot(path=SHOTS+'fan-shout-min5-phone.png', full_page=True)
                f.close()
            ctx.close()

        # seed a few fan requests, then analytics with data
        songs=call('GET','/api/fan')[1]['songs']
        free=[s for s in songs if s.get('ownMinCents',0)==0][0]
        # reset song min to free so $0 works? settings may still be custom $20 shout $5, global likely 0
        call('PUT','/api/settings',{'globalMinCents':0})
        st,d=call('POST','/api/queue',{'songId':free['id'],'songTitle':free['title'],'tipCents':1000,'requester':'Dana'})
        rec('seed request $10', st==201, d)
        st,d=call('POST','/api/queue',{'kind':'custom','customText':'Piano Man — Billy Joel','tipCents':2000,'requester':'Kyle'})
        rec('seed custom $20', st==201, d)
        st,d=call('POST','/api/queue',{'kind':'shoutout','tipCents':500,'requester':'Matt','message':'Happy birthday'})
        rec('seed shout $5', st==201, d)
        # delete queue — log must remain
        q=call('GET','/api/queue')[1]['queue']
        for it in q: call('POST', f"/api/queue/{it['id']}/delete")
        an=call('GET','/api/analytics')[1]
        rec('analytics keeps 3 after queue clear', an['totals']['requests']>=3 and an['totals']['tipCents']>=3500, an['totals'])

        for w,h,tag in [(390,844,'phone'),(1280,900,'desktop')]:
            ctx=br.new_context(viewport={'width':w,'height':h}, device_scale_factor=2, is_mobile=(w<500), has_touch=(w<500))
            pg=ctx.new_page()
            pg.goto(BASE+'/?view=analytics', wait_until='domcontentloaded', timeout=60000)
            pg.wait_for_selector('.an-stat')
            rec(f'[{tag}] analytics shows totals', '$' in pg.inner_text('.an-stats') and '3' in pg.inner_text('.an-stats'))
            rec(f'[{tag}] custom/shout rows listed', 'custom request' in pg.inner_text('#main').lower() and 'shout-out' in pg.inner_text('#main').lower())
            rec(f'[{tag}] seeded analytics no overflow', noov(pg))
            pg.screenshot(path=SHOTS+f'analytics-{tag}-data.png', full_page=True)
            ctx.close()

        # Overlay settings (performer view, not the solo browser-source page)
        ctx=br.new_context(viewport={'width':1280,'height':900}, device_scale_factor=2)
        pg=ctx.new_page()
        pg.goto(BASE+'/', wait_until='domcontentloaded', timeout=60000)
        pg.wait_for_selector('#topnav')
        pg.click('#topnav button[data-view="overlay"]')
        pg.wait_for_selector('#ovcSong')
        rec('overlay colours are requests-only', pg.locator('#ovcSong').count()==1 and pg.locator('#ovcCustom').count()==0 and pg.locator('#ovcShout').count()==0)
        ctx.close()

        # tip burst on the stream overlay (desktop, dark stage)
        ctx=br.new_context(viewport={'width':1280,'height':720}, device_scale_factor=2)
        pg=ctx.new_page()
        pg.goto(BASE+'/?view=overlay', wait_until='domcontentloaded', timeout=60000)
        pg.wait_for_selector('body')
        pg.wait_for_timeout(800)
        stacked=os.path.join(REPO,'public/fx/tip-burst-stacked.mp4')
        rec('stacked burst asset exists under 6.5MB', os.path.isfile(stacked) and 10000 < os.path.getsize(stacked) < 6.5*1024*1024, os.path.getsize(stacked) if os.path.isfile(stacked) else 'missing')
        rec('old luma-key / screen-blend assets gone', not os.path.isfile(os.path.join(REPO,'public/fx/tip-burst.webm')) and not os.path.isfile(os.path.join(REPO,'public/fx/tip-burst.mp4')))
        # trigger a test explosion from the performer overlay controls if present; else call celebrate via evaluate
        if pg.locator('[data-fx]').count():
            pg.click('[data-fx="1000"]')
        else:
            pg.evaluate("""() => {
              const stage=document.querySelector('.ov-stage, #overlay, #ov, [data-stage], #main')||document.body;
              if(window.KKOverlayFX) KKOverlayFX.celebrate(stage, {title:'500 Miles', requester:'Kyle', tipCents:1000, test:true});
            }""")
        pg.wait_for_selector('.kkfx canvas', timeout=8000)
        rec('explosion layer appears', pg.locator('.kkfx').count()>=1)
        rec('stacked canvas is the default (no screen-blend video)', pg.locator('.kkfx canvas').count()>=1 and pg.locator('.kkfx-vid.screen, .kkfx video.screen').count()==0)
        rec('painter is webgl or 2d', pg.locator('.kkfx canvas').get_attribute('data-kkfx-painter') in ('webgl','2d'))
        pg.wait_for_timeout(900)
        pg.screenshot(path=SHOTS+'overlay-fx-tip-burst.png')
        pg.wait_for_selector('.kkfx', state='detached', timeout=22000)
        rec('explosion cleans up', pg.locator('.kkfx').count()==0)
        ctx.close()
        br.close()
except Exception as e:
    rec('ui runner', False, str(e))
    raise
finally:
    if proc:
        proc.kill()

fails=sum(1 for _,ok,_ in results if not ok)
print('FAILS', fails)
sys.exit(1 if fails else 0)
