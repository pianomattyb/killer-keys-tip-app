import asyncio, json
from playwright.async_api import async_playwright
CHECK = """() => { const box=document.querySelector('#chartBox'); if(!box) return null;
 const W = box.clientWidth; let over=0; const inner = box.getBoundingClientRect().right - parseFloat(getComputedStyle(box).paddingRight) + 1.5; box.querySelectorAll('*').forEach(d=>{ const r=d.getBoundingClientRect(); if(r.width && r.right > inner) over++; }); const tw=document.createTreeWalker(box, NodeFilter.SHOW_TEXT); let n; while((n=tw.nextNode())){ if(!n.nodeValue.trim()) continue; const rg=document.createRange(); rg.selectNodeContents(n); for(const rr of rg.getClientRects()) if(rr.right > inner) {over++; break;} }
 return {fs: box.style.fontSize, wrapped: box.classList.contains('wrapped'), boxOverflow: box.scrollWidth > box.clientWidth+1, lineOverflow: over, words: box.textContent.replace(/\\s+/g,'').length, origWords: (()=>{const t=document.createElement('div'); t.innerHTML=chartOrigHtml; return t.textContent.replace(/\\s+/g,'').length})()} }"""
ALIGN = """() => { // for each wrapped chord/lyric pair, chord columns must be within/at lyric positions as in original: check chord text equals original chord sequence
 const box=document.querySelector('#chartBox'); const t=document.createElement('div'); t.innerHTML=chartOrigHtml;
 const seq = el => [...el.querySelectorAll('.ch')].map(x=>x.textContent).join(' ');
 return seq(box) === seq(t) }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        res = {}
        for (w,h,mob,tag) in [(390,844,True,'m390'),(1280,800,False,'desk')]:
            ctx = await b.new_context(viewport={'width':w,'height':h}, is_mobile=mob, has_touch=mob, device_scale_factor=2 if mob else 1)
            pg = await ctx.new_page(); await pg.goto('http://127.0.0.1:8100/outer-live.html'); await pg.wait_for_timeout(2500)
            app=[f for f in pg.frames if ':3000' in f.url][0]
            ids = await app.evaluate("songs.filter(s=>s.hasChart).map(s=>s.id)")
            bad=[]; wrappedN=0; minfs=99
            for sid in ids:
                await app.evaluate(f"openSong({sid})"); await pg.wait_for_timeout(120)
                for _ in range(20):
                    r = await app.evaluate(CHECK)
                    if r: break
                    await pg.wait_for_timeout(100)
                al = await app.evaluate(ALIGN)
                if r['boxOverflow'] or r['lineOverflow'] or not al or (r['words'] != r['origWords']): bad.append((sid, r, al))
                wrappedN += r['wrapped']; minfs=min(minfs, float(r['fs'][:-2]))
            print(tag, 'charts', len(ids), 'clipped/bad', len(bad), 'wrapped', wrappedN, 'min font', minfs, bad[:5], flush=True)
            await ctx.close()
        await b.close()
asyncio.run(main())
