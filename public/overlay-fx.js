/* Killer Keys stream-overlay celebration: layered canvas fireworks + request card.
   KKOverlayFX.celebrate(stageEl, {title, artist, requester, tipCents, kind, test})
   Tiers: free = small burst, $5-19 = medium, $20+ = big multi-burst finale.
   Transparent background, one rAF loop per celebration, removes itself when done (~3-4.5 s). */
(function(){
'use strict';
const GOLD = ['#f5b942','#ffd76a','#ffe9a8','#f0a020','#fff4d6'];
const WHITE = ['#ffffff','#fff8e6'];
const reduce = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = c => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
function tierOf(c){ c = Number(c) || 0; return c >= 2000 ? 'big' : c >= 500 ? 'medium' : 'small'; }

let cssDone = false;
function injectCss(){
  if(cssDone) return; cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
.kkfx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:50;contain:strict}
.kkfx canvas{position:absolute;inset:0;width:100%;height:100%}
.kkfx-flash{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 42%,rgba(255,215,106,.5),rgba(245,185,66,.16) 42%,rgba(0,0,0,0) 72%);opacity:0;animation:kkfxFlash .5s ease-out forwards}
.kkfx-flash.big{animation-duration:.85s}
@keyframes kkfxFlash{0%{opacity:0}14%{opacity:1}100%{opacity:0}}
.kkfx-card{position:absolute;left:50%;top:60%;transform:translate(-50%,-50%) scale(.2);opacity:0;min-width:32%;max-width:76%;text-align:center;
  background:linear-gradient(180deg,rgba(20,15,5,.95),rgba(0,0,0,.95));border:calc(var(--u)*3px) solid var(--kkc,#f5b942);border-radius:calc(var(--u)*26px);
  padding:calc(var(--u)*22px) calc(var(--u)*46px) calc(var(--u)*28px);box-shadow:0 0 calc(var(--u)*64px) color-mix(in srgb,var(--kkc,#f5b942) 60%,transparent),inset 0 0 calc(var(--u)*30px) color-mix(in srgb,var(--kkc,#f5b942) 18%,transparent);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#fff;will-change:transform,opacity;
  animation:kkfxIn .62s cubic-bezier(.2,1.6,.4,1) .12s forwards, kkfxOut .45s ease-in var(--hold) forwards}
.kkfx-kick{font-weight:900;letter-spacing:.32em;color:var(--kkc,#f5b942);font-size:calc(var(--u)*22px);text-transform:uppercase}
.kkfx-title{font-weight:900;font-size:calc(var(--u)*64px);line-height:1.05;margin-top:calc(var(--u)*8px);text-shadow:0 calc(var(--u)*3px) calc(var(--u)*12px) #000;overflow-wrap:anywhere}
.kkfx-artist{color:#cfc6b0;font-weight:700;font-size:calc(var(--u)*28px);margin-top:calc(var(--u)*4px)}
.kkfx-who{font-weight:800;font-size:calc(var(--u)*30px);margin-top:calc(var(--u)*12px);color:#fff4d6}
.kkfx-tip{display:inline-block;margin-top:calc(var(--u)*16px);background:linear-gradient(180deg,#ffe08a,#f0a020);color:#000;font-weight:900;
  font-size:calc(var(--u)*44px);border-radius:999px;padding:calc(var(--u)*6px) calc(var(--u)*30px);box-shadow:0 0 calc(var(--u)*30px) rgba(245,185,66,.8);
  transform:scale(0);animation:kkfxTip .5s cubic-bezier(.2,1.8,.4,1) .45s forwards}
.kkfx-card.big .kkfx-tip{font-size:calc(var(--u)*60px)}
@keyframes kkfxIn{0%{transform:translate(-50%,-50%) scale(.2);opacity:0}55%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}
@keyframes kkfxOut{from{transform:translate(-50%,-50%) scale(1);opacity:1}to{transform:translate(-50%,-50%) scale(.92);opacity:0}}
@keyframes kkfxTip{to{transform:scale(1)}}
@media (prefers-reduced-motion: reduce){
  .kkfx-card{transform:translate(-50%,-50%);animation:kkfxFade .35s ease-out forwards, kkfxFadeOut .35s ease-in var(--hold) forwards}
  .kkfx-tip{animation:none;transform:none}
  .kkfx-flash{display:none}
  @keyframes kkfxFade{from{opacity:0}to{opacity:1}}
  @keyframes kkfxFadeOut{from{opacity:1}to{opacity:0}}
}`;
  document.head.appendChild(s);
}

function makeEngine(layer){
  const cv = document.createElement('canvas'); layer.appendChild(cv);
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const box = layer.getBoundingClientRect();
  const W = Math.max(1, box.width), H = Math.max(1, box.height), U = W / 1920;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const parts = [], rockets = [], rings = [], timers = [];
  let raf = 0, last = 0, endAt = 0, dead = false;
  const MAX = 2000;

  function burst(x, y, n, power, palette, o){
    o = o || {};
    const sp = power * U;
    for(let i = 0; i < n && parts.length < MAX; i++){
      const a = (i / n) * Math.PI * 2 + rand(-.07, .07);
      const v = sp * (o.ring ? rand(.9, 1) : Math.pow(Math.random(), .45));
      parts.push({ x, y, px:x, py:y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, life:rand(1.2, 1.9)*(o.life||1), age:0,
        c: Math.random() < .22 ? pick(WHITE) : pick(palette), w: rand(3, 5.2)*U*(o.thick||1), tw: Math.random() < .3, drag: o.drag || .984, g: (o.g||250)*U, spark:false });
    }
    for(let i = 0; i < n * .35 && parts.length < MAX; i++){
      const a = Math.random() * Math.PI * 2, v = sp * rand(.08, .5);
      parts.push({ x, y, px:x, py:y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, life:rand(1.1, 1.9), age:0, c:pick(WHITE), w:rand(2, 3.4)*U, tw:true, spark:true, drag:.955, g:55*U });
    }
    if(o.noRing !== true) rings.push({ x, y, r: 6*U, max: power * U * (o.ringScale || .8), age: 0, life: .5, w: 6*U });
  }
  function rocket(x0, x1, y1, delay, fn){
    timers.push(setTimeout(() => { if(dead) return; rockets.push({ x0, x:x0, y:H + 10*U, tx:x1, ty:y1, t:0, dur:rand(.42, .55), fn }); start(); }, delay));
  }
  function at(delay, fn){ timers.push(setTimeout(() => { if(dead) return; fn(); start(); }, delay)); }

  function step(t){
    raf = 0; if(dead) return;
    const dt = Math.min(.05, last ? (t - last) / 1000 : 1 / 60); last = t;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(0, 0, W, H);       // fade = trails, stays transparent
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for(let i = rockets.length - 1; i >= 0; i--){
      const r = rockets[i]; r.t = Math.min(1, r.t + dt / r.dur);
      const e = 1 - Math.pow(1 - r.t, 3), px = r.x, py = r.y;
      r.x = r.x0 + (r.tx - r.x0) * e; r.y = (H + 10*U) + (r.ty - (H + 10*U)) * e;
      ctx.globalAlpha = 1; ctx.strokeStyle = '#ffe6a0'; ctx.lineWidth = 3.5*U;
      ctx.beginPath(); ctx.moveTo(px, py + 14*U); ctx.lineTo(r.x, r.y); ctx.stroke();
      if(Math.random() < .6 && parts.length < MAX) parts.push({ x:r.x, y:r.y, px:r.x, py:r.y, vx:rand(-30,30)*U, vy:rand(20,80)*U, life:.35, age:0, c:'#f5b942', w:2*U, tw:false, spark:true, drag:.95, g:200*U });
      if(r.t >= 1){ rockets.splice(i, 1); r.fn(r.tx, r.ty); }
    }
    const glow = parts.length < 800;   // drop the soft glow pass on the very busiest frames
    for(let i = parts.length - 1; i >= 0; i--){
      const p = parts[i]; p.age += dt;
      if(p.age >= p.life){ parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      p.px = p.x; p.py = p.y;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      let a = 1 - p.age / p.life; a = a * (0.35 + 0.65 * a);
      if(p.tw) a *= .5 + .5 * Math.sin(p.age * 40 + i);
      if(a <= .02) continue;
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.c; ctx.lineWidth = p.w;
      ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      if(glow && a > .3){ ctx.globalAlpha = a * .35; ctx.lineWidth = p.w * 3.2; ctx.stroke(); }
      if(p.spark && a > .45){ ctx.globalAlpha = a; ctx.fillStyle = p.c; ctx.fillRect(p.x - p.w, p.y - p.w, p.w * 2, p.w * 2); }
    }
    for(let i = rings.length - 1; i >= 0; i--){
      const r = rings[i]; r.age += dt; const k = r.age / r.life;
      if(k >= 1){ rings.splice(i, 1); continue; }
      const rad = r.r + (r.max - r.r) * (1 - Math.pow(1 - k, 3));
      ctx.globalAlpha = (1 - k) * .8; ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = r.w * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if(parts.length || rockets.length || rings.length || performance.now() < endAt) raf = requestAnimationFrame(step);
    else { ctx.clearRect(0, 0, W, H); last = 0; }
  }
  function start(){ if(!raf && !dead) raf = requestAnimationFrame(step); }
  return { W, H, U, burst: (...a) => { burst(...a); start(); }, rocket, at,
    until(ms){ endAt = Math.max(endAt, performance.now() + ms); start(); },
    kill(){ dead = true; timers.forEach(clearTimeout); if(raf) cancelAnimationFrame(raf); raf = 0; parts.length = rockets.length = rings.length = 0; } };
}

function show(stage, o){
  injectCss();
  const tip = Math.max(0, Number(o.tipCents) || 0), tier = ['small','medium','big'].includes(o.tier) ? o.tier : tierOf(tip);
  if(getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
  const layer = document.createElement('div'); layer.className = 'kkfx';
  stage.appendChild(layer);
  const u = Math.max(.18, layer.getBoundingClientRect().width / 1920);
  const hold = tier === 'big' ? 3.9 : tier === 'medium' ? 3.2 : 2.6;      // card starts leaving at this second
  layer.style.setProperty('--u', u); layer.style.setProperty('--hold', hold + 's');
  if(o.color) layer.style.setProperty('--kkc', o.color);
  const kicker = o.kicker ? o.kicker : o.test ? 'Test explosion' : o.kind === 'shoutout' ? 'Shout-out' : o.kind === 'custom' ? 'Custom request' : tier === 'big' ? '★ Big tip ★' : tip > 0 ? 'Tipped request' : 'New request';
  layer.innerHTML = (reduce() ? '' : `<div class="kkfx-flash${tier === 'big' ? ' big' : ''}"></div>`) +
    `<div class="kkfx-card ${tier}"><div class="kkfx-kick">${esc(kicker)}</div><div class="kkfx-title">${esc(o.title || 'Song request')}</div>` +
    (o.artist ? `<div class="kkfx-artist">${esc(o.artist)}</div>` : '') +
    (o.requester ? `<div class="kkfx-who">for ${esc(o.requester)}</div>` : '') +
    (o.badge ? `<div class="kkfx-tip">${esc(o.badge)}</div>` : tip > 0 ? `<div class="kkfx-tip">${money(tip)} tip</div>` : '') + `</div>`;
  const total = (hold + .5) * 1000;
  if(reduce()){ setTimeout(() => layer.remove(), total); return total; }
  const fx = makeEngine(layer), W = fx.W, H = fx.H, P = GOLD;
  const lx = () => rand(.1, .3) * W, rx = () => rand(.7, .9) * W, cy = () => rand(.12, .32) * H;
  if(tier === 'small'){
    fx.rocket(W * .5, W * .5, H * .24, 0, (x, y) => fx.burst(x, y, 90, 620, P));
  } else if(tier === 'medium'){
    fx.rocket(W * .5, W * .5, H * .2, 0, (x, y) => fx.burst(x, y, 130, 780, P, { ringScale: 1.1 }));
    fx.rocket(W * .28, lx(), cy(), 240, (x, y) => fx.burst(x, y, 100, 640, P));
    fx.rocket(W * .72, rx(), cy(), 480, (x, y) => fx.burst(x, y, 100, 640, P));
  } else {
    fx.rocket(W * .5, W * .5, H * .18, 0, (x, y) => fx.burst(x, y, 180, 950, P, { ringScale: 1.5, thick: 1.25 }));
    [[.25, 200], [.75, 380], [.14, 600], [.86, 780], [.38, 1000], [.62, 1180]].forEach(([f, d]) =>
      fx.rocket(W * f, f < .5 ? lx() : rx(), cy(), d, (x, y) => fx.burst(x, y, 110, rand(620, 780), P)));
    fx.rocket(W * .3, W * .3, H * .16, 1480, (x, y) => fx.burst(x, y, 150, 720, P, { ring: true, ringScale: 1.2 }));
    fx.rocket(W * .7, W * .7, H * .16, 1580, (x, y) => fx.burst(x, y, 150, 720, P, { ring: true, ringScale: 1.2 }));
    fx.at(1900, () => { for(let i = 0; i < 7; i++) fx.burst(rand(.08, .92) * W, rand(.06, .2) * H, 45, 280, ['#ffd76a','#f5b942','#f0a020'], { life: 1.7, g: 330, drag: .975, noRing: true }); });
  }
  fx.until(700);
  setTimeout(() => { fx.kill(); layer.remove(); }, total);
  return total;
}

/* one celebration at a time per stage; keep the newest 3 waiting */
const queues = new WeakMap();
function celebrate(stage, o){
  if(!stage) return;
  let q = queues.get(stage); if(!q){ q = { busy:false, list:[] }; queues.set(stage, q); }
  if(q.list.length >= 3) q.list.shift();
  q.list.push(o || {});
  const next = () => {
    if(!q.list.length || !stage.isConnected){ q.busy = false; q.list.length = 0; return; }
    q.busy = true; const ms = show(stage, q.list.shift());
    setTimeout(next, ms + 150);
  };
  if(!q.busy) next();
}
window.KKOverlayFX = { celebrate, tierOf };
})();
