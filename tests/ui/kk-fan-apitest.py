import json, urllib.request
B='http://127.0.0.1:4410'
def call(m,p,b=None):
    r=urllib.request.Request(B+p,method=m,data=json.dumps(b).encode() if b is not None else None,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())
fan=call('GET','/api/fan')[1]['songs']
pm=[s for s in fan if s['title']=='Piano Man'][0]
free=[s for s in fan if s['ownMinCents']==0][0]
allsongs=call('GET','/api/songs?visible=0')[1]['songs']
hidden=[s for s in allsongs if not s['visible']][0]
made=[]; fails=0
def t(name, st, want):
    global fails
    ok = st==want; fails += (not ok); print(('PASS' if ok else 'FAIL'), name, st)
for g in (0,500,1000):
    s,_=call('PUT','/api/settings',{'globalMinCents':g}); t(f'set global {g}',s,200)
    req={x['id']:x['requiredCents'] for x in call('GET','/api/fan')[1]['songs']}
    t(f'[g={g}] Piano Man required stays 3000 (got {req[pm["id"]]})', req[pm['id']], 3000)
    t(f'[g={g}] {free["title"]} required = {g} (got {req[free["id"]]})', req[free['id']], g)
    for song,tip,want in [(pm,0,400),(pm,2999,400),(pm,3000,201),(free,0,201 if g==0 else 400),(free,300,400),(free,g-1 if g else 499,400),(free,max(g,500),201)]:
        s,d=call('POST','/api/queue',{'songId':song['id'],'songTitle':song['title'],'tipCents':tip,'requester':'ZZTEST'})
        t(f'[g={g}] {song["title"]} tip {tip} -> {want}',s,want)
        if s==201: made.append(d['item']['id'])
    for kind,tip,want in [('shoutout',500,400),('shoutout',max(1000,g),201),('custom',1000,201)]:
        s,d=call('POST','/api/queue',{'kind':kind,'customText':'Test Song - Test','tipCents':tip,'requester':'ZZTEST'})
        t(f'[g={g}] {kind} tip {tip} -> {want}',s,want)
        if s==201: made.append(d['item']['id'])
s,_=call('POST','/api/queue',{'songId':hidden['id'],'songTitle':hidden['title'],'tipCents':5000,'requester':'ZZTEST'}); t('hidden song rejected',s,404)
s,d=call('POST','/api/queue',{'songId':pm['id'],'songTitle':pm['title'],'tipCents':0,'performer':True}); t('performer add bypasses',s,201); made.append(d['item']['id'])
s,_=call('PUT','/api/settings',{'globalMinCents':300}); t('global $3 rejected',s,400)
s,_=call('PUT','/api/settings',{'globalMinCents':1500}); t('global custom $15 ok',s,200)
req={x['id']:x['requiredCents'] for x in call('GET','/api/fan')[1]['songs']}; t('custom $15: free song 1500',req[free['id']],1500); t('custom $15: Piano Man 3000',req[pm['id']],3000)
call('PUT','/api/settings',{'globalMinCents':0})
q=call('GET','/api/queue')[1]['queue']
print('queue order first tips:',[x['tipCents'] for x in q[:5]])
for i in made: call('POST',f'/api/queue/{i}/delete')
left=[x for x in call('GET','/api/queue')[1]['queue'] if x['requester']=='ZZTEST' or x['id'] in made]
print('cleanup left',len(left),'FAILS',fails)
