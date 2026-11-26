/* Killer Keys stream-overlay celebration: tip-burst video + request card.
   KKOverlayFX.celebrate(stageEl, {title, artist, requester, tipCents, kind, test})
   Tiers: free = small burst, $5-19 = medium, $20+ = big (same clip, scaled).
   Transparent WebM (VP9+alpha) in Chrome/OBS/Ecamm; Safari/iPad falls back to
   the H.264 clip with mix-blend-mode:screen (the overlay is dark).
   Burst is the first orange fireball from Matt's clip, 0.10–4.10s, faded out.
   Existing trigger / queue logic is unchanged. */
(function(){
'use strict';
const BURST_WEBM = '/fx/tip-burst.webm';
const BURST_MP4  = '/fx/tip-burst.mp4';
const BURST_MS   = 4000;
const reduce = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = c => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
function tierOf(c){ c = Number(c) || 0; return c >= 2000 ? 'big' : c >= 500 ? 'medium' : 'small'; }

function burstMode(){
  const ua = navigator.userAgent || '';
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const apple = iPadOS || (/iPhone|iPad|iPod/i.test(ua) || (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|Android/i.test(ua)));
  const vp9 = document.createElement('video').canPlayType('video/webm; codecs="vp9"');
  if (!apple && vp9) return 'webm';
  return 'screen';
}

let cssDone = false, preloaded = false;
function preloadBurst(){
  if (preloaded) return; preloaded = true;
  [BURST_WEBM, BURST_MP4].forEach(src => { const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.src = src; });
}
function injectCss(){
  if(cssDone) return; cssDone = true;
  preloadBurst();
  const s = document.createElement('style');
  s.textContent = `
.kkfx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:50;contain:strict}
.kkfx-burst{position:absolute;inset:0;pointer-events:none}
.kkfx-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 38%;transform-origin:50% 38%}
.kkfx-burst.small .kkfx-vid{transform:scale(.82)}
.kkfx-burst.big .kkfx-vid{transform:scale(1.12)}
.kkfx-vid.screen{mix-blend-mode:screen}
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
  .kkfx-flash,.kkfx-burst{display:none}
  @keyframes kkfxFade{from{opacity:0}to{opacity:1}}
  @keyframes kkfxFadeOut{from{opacity:1}to{opacity:0}}
}`;
  document.head.appendChild(s);
}

function addBurst(layer, tier){
  const mode = burstMode();
  const wrap = document.createElement('div');
  wrap.className = 'kkfx-burst ' + tier;
  const v = document.createElement('video');
  v.className = 'kkfx-vid' + (mode === 'screen' ? ' screen' : '');
  v.src = mode === 'webm' ? BURST_WEBM : BURST_MP4;
  v.muted = true; v.autoplay = true; v.playsInline = true;
  v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
  v.preload = 'auto'; v.disablePictureInPicture = true;
  v.setAttribute('aria-hidden', 'true');
  wrap.appendChild(v);
  layer.insertBefore(wrap, layer.firstChild);
  const play = () => v.play().catch(() => {
    if (mode === 'webm'){ v.classList.add('screen'); v.src = BURST_MP4; v.play().catch(() => {}); }
  });
  if (v.readyState >= 2) play(); else v.addEventListener('canplay', play, { once: true });
  return v;
}

function show(stage, o){
  injectCss();
  const tip = Math.max(0, Number(o.tipCents) || 0), tier = ['small','medium','big'].includes(o.tier) ? o.tier : tierOf(tip);
  if(getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
  const layer = document.createElement('div'); layer.className = 'kkfx';
  stage.appendChild(layer);
  const u = Math.max(.18, layer.getBoundingClientRect().width / 1920);
  const hold = tier === 'big' ? 3.5 : tier === 'medium' ? 3.3 : 3.1;
  layer.style.setProperty('--u', u); layer.style.setProperty('--hold', hold + 's');
  if(o.color) layer.style.setProperty('--kkc', o.color);
  const kicker = o.kicker ? o.kicker : o.test ? 'Test explosion' : o.kind === 'shoutout' ? 'Shout-out' : o.kind === 'custom' ? 'Custom request' : tier === 'big' ? '★ Big tip ★' : tip > 0 ? 'Tipped request' : 'New request';
  layer.innerHTML = (reduce() ? '' : `<div class="kkfx-flash${tier === 'big' ? ' big' : ''}"></div>`) +
    `<div class="kkfx-card ${tier}"><div class="kkfx-kick">${esc(kicker)}</div><div class="kkfx-title">${esc(o.title || 'Song request')}</div>` +
    (o.artist ? `<div class="kkfx-artist">${esc(o.artist)}</div>` : '') +
    (o.requester ? `<div class="kkfx-who">for ${esc(o.requester)}</div>` : '') +
    (o.badge ? `<div class="kkfx-tip">${esc(o.badge)}</div>` : tip > 0 ? `<div class="kkfx-tip">${money(tip)} tip</div>` : '') + `</div>`;
  const total = reduce() ? (hold + .5) * 1000 : BURST_MS + 200;
  if(!reduce()) addBurst(layer, tier);
  setTimeout(() => layer.remove(), total);
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
