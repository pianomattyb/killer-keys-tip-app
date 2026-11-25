import json, time, urllib.request
from playwright.sync_api import sync_playwright
B='http://127.0.0.1:4410'; SH='/workspace/kk-app-shots/'
def call(m,p,b=None):
    r=urllib.request.Request(B+p,method=m,data=json.dumps(b).encode() if b is not None else None,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r) as x: return json.loads(x.read())
    except urllib.error.HTTPError as e: return {'error':e.read().decode()}
fan={s['title']:s for s in call('GET','/api/fan')['songs']}
res=[]; made=[]
def chk(n,c): res.append(bool(c)); print('PASS' if c else 'FAIL', n)
BG="html{background:radial-gradient(ellipse at 50% 120%,#3a2a10,#0b0b10 60%) !important}"
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--headless=new','--enable-gpu-rasterization'])
    ctx=br.new_context(viewport={'width':1920,'height':1080}, record_video_dir='/tmp/ovvid', record_video_size={'width':960,'height':540})
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(B+'/?view=overlay'); pg.wait_for_timeout(1500)
    tb=pg.evaluate("[getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]")
    chk(f'overlay background transparent {tb}', all(x in ('rgba(0, 0, 0, 0)','transparent') for x in tb))
    pg.add_style_tag(content=BG)
    pg.evaluate("""window.__fps=[];(function(){let n=0,t0=performance.now();function f(t){n++; if(t-t0>=500){ if(document.querySelector('.kkfx')) __fps.push(n*1000/(t-t0)); n=0;t0=t;} requestAnimationFrame(f);} requestAnimationFrame(f);})()""")
    for name,song,tip,shot,who in [('free','1979',0,'overlay-fx-free.png','Dana'),('10','500 Miles',1000,'overlay-fx-10.png','Kyle'),('50','Piano Man',5000,'overlay-fx-50.png','Matt')]:
        s=fan[song]; d=call('POST','/api/queue',{'songId':s['id'],'songTitle':song,'tipCents':tip,'requester':'ZZTEST '+who})
        made.append(d['item']['id'])
        pg.wait_for_selector('.kkfx', timeout=8000); t0=time.time()
        pg.wait_for_timeout({'free':850,'10':1000,'50':1350}[name]); pg.screenshot(path=SH+shot)
        txt=pg.inner_text('.kkfx-card'); chk(f'{name}: card shows song + fan + tip [{txt.replace(chr(10)," | ")}]', song.upper() in txt.upper() and who in txt and ((f'${tip//100}' in txt) if tip else 'tip' not in txt.lower()))
        pg.wait_for_selector('.kkfx', state='detached', timeout=8000); dur=time.time()-t0
        chk(f'{name}: cleans up after ~{dur:.1f}s', 2.5<=dur<=5.5 and pg.locator('.kkfx, .kkfx canvas').count()==0)
        pg.wait_for_timeout(600)
    fps=pg.evaluate("__fps"); avg=sum(fps)/max(1,len(fps)); low=min(fps) if fps else 0
    chk(f'fps during celebrations avg {avg:.0f}, low {low:.0f} (headless, software GL)', avg>=50)
    # per-kind colours
    call('PUT','/api/settings',{'ovColorShout':'#00ff88'})
    d=call('POST','/api/queue',{'kind':'shoutout','tipCents':1000,'requester':'ZZTEST Shout','message':'Happy birthday Sarah!'}); made.append(d['item']['id'])
    pg.wait_for_selector('.kkfx', timeout=8000); pg.wait_for_timeout(300)
    chk('shout-out row uses its colour', pg.evaluate("[...document.querySelectorAll('.ov-item.k-shoutout')].some(e=>e.style.getPropertyValue('--kc')==='#00ff88')"))
    pg.wait_for_selector('.kkfx', state='detached', timeout=8000)
    call('PUT','/api/settings',{'ovColorShout':'#ff6fa5'})
    # performer test buttons reach the overlay
    q=ctx.new_page(); q.goto(B+'/?view=overlay'); 
    perf=br.new_page(viewport={'width':1280,'height':900}); perf.goto(B+'/'); perf.click('#topnav button[data-view="overlay"]'); perf.wait_for_selector('[data-fx="5000"]')
    pg.wait_for_timeout(500)
    perf.click('[data-fx="1000"]'); perf.wait_for_timeout(300)
    chk('Test $10 plays in performer preview', perf.locator('#ovStage .kkfx').count()==1)
    pg.wait_for_selector('.kkfx', timeout=8000); chk('Test $10 reaches the stream overlay', 'TEST EXPLOSION' in pg.inner_text('.kkfx-card').upper() and '$10' in pg.inner_text('.kkfx-card'))
    perf.wait_for_timeout(600); perf.screenshot(path=SH+'overlay-fx-controls.png')
    pg.wait_for_selector('.kkfx', state='detached', timeout=8000)
    chk('no page errors', not errs); print(errs[:3])
    vid=pg.video; ctx.close(); 
    import shutil; shutil.copy(vid.path(), SH+'overlay-fx.webm')
    # reduced motion
    rc=br.new_context(viewport={'width':1920,'height':1080}, reduced_motion='reduce'); r=rc.new_page(); r.goto(B+'/?view=overlay'); r.wait_for_timeout(1500)
    call('POST','/api/overlay/explode',{'tipCents':5000})
    r.wait_for_selector('.kkfx', timeout=8000); chk('reduced motion: card only, no canvas/flash', r.locator('.kkfx canvas').count()==0 and r.locator('.kkfx-flash').count()==0 and r.locator('.kkfx-card').count()==1)
    rc.close()
    # fan social links
    f=br.new_context(**dict(p.devices['iPhone 13'])).new_page(); f.goto(B+'/fan'); f.wait_for_selector('.song')
    chk('fan: YouTube @thekillerkeysofficial + Instagram shown', f.locator('.social a.yt[href="https://www.youtube.com/@thekillerkeysofficial"]').count()==1 and f.locator('.social a.ig[href="https://www.instagram.com/thekillerkeys/"]').count()==1)
    chk('fan: social row no overflow, 44px', f.evaluate("document.documentElement.scrollWidth<=innerWidth+1") and min(f.eval_on_selector_all('.social a','e=>e.map(x=>x.getBoundingClientRect().height)'))>=44)
    f.screenshot(path=SH+'fan-social-links.png')
    call('PUT','/api/settings',{'socialYoutube':''}); f.wait_for_timeout(32000)
    chk('fan: YouTube hides when cleared (live refresh)', f.locator('.social a.yt').count()==0)
    chk('bad link refused', 'error' in call('PUT','/api/settings',{'socialYoutube':'javascript:alert(1)'}))
    call('PUT','/api/settings',{'socialYoutube':'https://www.youtube.com/@thekillerkeysofficial'})
    br.close()
for i in made: call('POST',f'/api/queue/{i}/delete')
call('POST','/api/tally/reset')  # test tips must not stay in the tip tally
left=[x for x in call('GET','/api/queue')['queue'] if (x['requester'] or '').startswith('ZZTEST')]
print('test entries left',len(left),'settings',{k:v for k,v in call('GET','/api/settings')['settings'].items() if k!='overlayTest'})
print('TOTAL',sum(res),'/',len(res))
