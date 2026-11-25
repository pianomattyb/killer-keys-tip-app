import json, time, urllib.request, subprocess, os, shutil
from playwright.sync_api import sync_playwright
B='http://127.0.0.1:4410'; SH='/workspace/kk-app-shots/'
def call(m,p,b=None,base=B):
    r=urllib.request.Request(base+p,method=m,data=json.dumps(b).encode() if b is not None else None,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r) as x: return json.loads(x.read())
    except urllib.error.HTTPError as e: return {'error':e.read().decode()}
fan={s['title']:s for s in call('GET','/api/fan')['songs']}
res=[]; made=[]
def chk(n,c): res.append(bool(c)); print('PASS' if c else 'FAIL', n)
orig={k:call('GET','/api/settings')['settings'][k] for k in ['tipGoalCents','tipGoalShow','tipTallyCents']}
print('orig',orig)
BG="html{background:radial-gradient(ellipse at 50% 120%,#3a2a10,#0b0b10 60%) !important}"
call('POST','/api/tally/reset'); call('PUT','/api/settings',{'tipGoalCents':10000,'tipGoalShow':'1'})
chk('bad goal refused', 'error' in call('PUT','/api/settings',{'tipGoalCents':0}))
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--headless=new'])
    pg=br.new_page(viewport={'width':1920,'height':1080}); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(B+'/?view=overlay'); pg.wait_for_selector('#ovGoal:not([hidden])'); pg.add_style_tag(content=BG)
    chk('goal bar shows $0 / $100', pg.inner_text('#ovGoalTxt')=='$0 / $100')
    for song,tip,who in [('Piano Man',3000,'Dana'),('500 Miles',2000,'Kyle')]:
        d=call('POST','/api/queue',{'songId':fan[song]['id'],'tipCents':tip,'requester':'ZZTEST '+who}); made.append(d['item']['id'])
    d=call('POST','/api/queue',{'songId':fan['1979']['id'],'tipCents':0,'requester':'ZZTEST free'}); made.append(d['item']['id'])
    d=call('POST','/api/queue',{'songId':fan['1979']['id'],'tipCents':300,'requester':'ZZTEST bad'}); chk('rejected $3 tip not counted', 'error' in d)
    chk('server tally = $50', call('GET','/api/overlay')['goal']['tallyCents']==5000)
    pg.wait_for_function("document.querySelector('#ovGoalTxt').textContent==='$50 / $100'", timeout=8000)
    pg.wait_for_timeout(1400)
    w=pg.evaluate("[document.querySelector('#ovGoalFill').getBoundingClientRect().width, document.querySelector('#ovGoal .gt').getBoundingClientRect().width]")
    chk(f'bar ~50% filled {w}', abs(w[0]/w[1]-.5)<.03)
    pg.wait_for_selector('.kkfx', state='detached', timeout=20000); pg.wait_for_timeout(300)
    # overlap check: goal bar below last queue row
    ov=pg.evaluate("(()=>{const r=[...document.querySelectorAll('.ov-item,.ov-more')].map(e=>e.getBoundingClientRect().bottom);return [Math.max(...r), document.querySelector('#ovGoal').getBoundingClientRect().top]})()")
    chk(f'goal bar does not cover the queue {ov}', ov[0] <= ov[1])
    pg.screenshot(path=SH+'overlay-goal.png')
    d=call('POST','/api/queue',{'songId':fan['Piano Man']['id'],'tipCents':6000,'requester':'ZZTEST Matt'}); made.append(d['item']['id'])
    pg.wait_for_function("document.querySelector('#ovGoal').classList.contains('hit')", timeout=8000)
    chk('over goal shows $110 / $100, bar full', pg.inner_text('#ovGoalTxt')=='$110 / $100')
    t=time.time(); hit=False
    while time.time()-t<15 and not hit:
        hit = pg.evaluate("[...document.querySelectorAll('.kkfx-kick')].some(e=>/goal hit/i.test(e.textContent))"); pg.wait_for_timeout(200)
    chk('goal-hit celebration plays', hit)
    pg.wait_for_timeout(900); pg.screenshot(path=SH+'overlay-goal-hit.png')
    pg.wait_for_selector('.kkfx', state='detached', timeout=10000); pg.wait_for_timeout(3500)
    chk('goal celebration plays only once', pg.locator('.kkfx').count()==0)
    # controls
    perf=br.new_page(viewport={'width':1280,'height':900}); perf.on('pageerror',lambda e: errs.append(str(e)))
    perf.goto(B+'/'); perf.click('#topnav button[data-view="overlay"]'); perf.wait_for_selector('#ovGoalAmt')
    chk('controls show tally $110', perf.inner_text('#ovTally')=='$110')
    perf.fill('#ovGoalAmt','400'); perf.click('#ovGoalSave'); perf.wait_for_timeout(600)
    chk('goal saved $400', call('GET','/api/settings')['settings']['tipGoalCents']=='40000')
    pg.wait_for_function("document.querySelector('#ovGoalTxt').textContent==='$110 / $400'", timeout=8000); chk('stream shows $110 / $400', True)
    perf.uncheck('#ovGoalShow'); perf.wait_for_timeout(500)
    pg.wait_for_selector('#ovGoal[hidden]', state='attached', timeout=8000); chk('hide toggle hides bar on stream', True)
    perf.check('#ovGoalShow'); perf.wait_for_timeout(500)
    pg.wait_for_selector('#ovGoal:not([hidden])', timeout=8000); chk('show toggle brings it back', True)
    perf.once('dialog', lambda dg: dg.dismiss()); perf.click('#ovTallyReset'); perf.wait_for_timeout(500)
    chk('reset cancelled keeps tally', call('GET','/api/overlay')['goal']['tallyCents']==11000)
    perf.wait_for_selector('.kkfx', state='detached', timeout=10000); perf.wait_for_timeout(3200)
    perf.evaluate("document.querySelector('#ovGoalAmt').scrollIntoView({block:'center'})"); perf.screenshot(path=SH+'overlay-goal-controls.png')
    # phone width controls
    m=br.new_page(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True); m.goto(B+'/'); m.evaluate("setView('overlay')"); m.wait_for_selector('#ovGoalAmt')
    chk('390px: no sideways scroll on overlay controls', m.evaluate("document.documentElement.scrollWidth<=innerWidth+1"))
    hs=m.evaluate("['#ovGoalAmt','#ovGoalSave','#ovTallyReset'].map(s=>document.querySelector(s).getBoundingClientRect().height)")
    chk(f'390px: goal controls tall enough {hs}', min(hs)>=40)
    m.close()
    # export persistence
    tmp='/tmp/kkexp'; shutil.rmtree(tmp,ignore_errors=True)
    out=subprocess.run(['node','scripts/export-live.js',B,tmp],cwd='/workspace/kk-app',capture_output=True,text=True,timeout=120)
    st=json.load(open(tmp+'/settings.json'))
    chk(f'export-live carries tally {st.get("tipTallyCents")} + goal {st.get("tipGoalCents")}', st.get('tipTallyCents')=='11000' and st.get('tipGoalCents')=='40000' and 'overlayTest' not in st)
    srv=subprocess.Popen(['node','server.js'],cwd='/workspace/kk-app',env=dict(os.environ,DATA_DIR=tmp,PORT='4499'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(2.5)
    g=call('GET','/api/overlay',base='http://127.0.0.1:4499')['goal']; srv.terminate()
    chk(f'fresh deploy re-seeds tally {g}', g['tallyCents']==11000 and g['goalCents']==40000)
    perf.once('dialog', lambda dg: dg.accept()); perf.click('#ovTallyReset'); perf.wait_for_timeout(600)
    chk('reset confirmed -> $0', call('GET','/api/overlay')['goal']['tallyCents']==0 and perf.inner_text('#ovTally')=='$0')
    pg.wait_for_function("document.querySelector('#ovGoalTxt').textContent==='$0 / $400'", timeout=8000); chk('stream back to $0 / $400', True)
    chk('no page errors', not errs); print(errs[:3])
    br.close()
for i in made: call('POST',f'/api/queue/{i}/delete')
call('PUT','/api/settings',{'tipGoalCents':int(orig['tipGoalCents']),'tipGoalShow':orig['tipGoalShow']}); call('POST','/api/tally/reset')
left=[x for x in call('GET','/api/queue')['queue'] if (x['requester'] or '').startswith('ZZTEST')]
print('test entries left',len(left),{k:call('GET','/api/settings')['settings'][k] for k in orig})
print('TOTAL',sum(res),'/',len(res))
