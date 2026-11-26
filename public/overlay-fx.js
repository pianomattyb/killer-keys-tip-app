/* Killer Keys stream-overlay celebration: tip-burst video + request card.
   KKOverlayFX.celebrate(stageEl, {title, artist, requester, tipCents, kind, test})
   Tiers: free = small burst, $5-19 = medium, $20+ = big (same clip, scaled).

   Default burst is a stacked-alpha H.264 MP4 (colour on the top half, alpha as
   greyscale on the bottom half) drawn to a canvas with WebGL, or 2D canvas if
   WebGL is unavailable. That path works in Safari, Ecamm Live (WebKit), iPad,
   Chrome and OBS. The ProRes source is premultiplied; the shader keeps it that
   way (no mix-blend-mode:screen — the clip has dark smoke that screen would
   erase). The full 16.4s clip plays in front of the tip card and fades itself.
   Existing trigger / queue logic is unchanged. */
(function(){
'use strict';
const BURST_MP4 = '/fx/tip-burst-stacked.mp4';
const BURST_FALLBACK_S = 16.42;
const reduce = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = c => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
function tierOf(c){ c = Number(c) || 0; return c >= 2000 ? 'big' : c >= 500 ? 'medium' : 'small'; }

let cssDone = false, preloaded = false;
function preloadBurst(){
  if (preloaded) return; preloaded = true;
  const v = document.createElement('video');
  v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = BURST_MP4;
}
function injectCss(){
  if(cssDone) return; cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
.kkfx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:50;contain:strict}
.kkfx-burst{position:absolute;inset:0;z-index:3;pointer-events:none;overflow:visible}
.kkfx-burst canvas{position:absolute;left:50%;top:50%;max-width:100%;max-height:100%;width:auto;height:auto;display:block;background:transparent;transform:translate(-50%,-50%) scale(var(--kkfx-scale,1));transform-origin:center center}
.kkfx-src{position:absolute;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none;overflow:hidden}
.kkfx-flash{position:absolute;inset:0;z-index:1;background:radial-gradient(ellipse at 50% 42%,rgba(255,215,106,.5),rgba(245,185,66,.16) 42%,rgba(0,0,0,0) 72%);opacity:0;animation:kkfxFlash .5s ease-out forwards}
.kkfx-flash.big{animation-duration:.85s}
@keyframes kkfxFlash{0%{opacity:0}14%{opacity:1}100%{opacity:0}}
.kkfx-card{position:absolute;left:50%;top:60%;z-index:2;transform:translate(-50%,-50%) scale(.2);opacity:0;min-width:32%;max-width:76%;text-align:center;
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

const TIER_SCALE = { small: 1, medium: 1.04, big: 1.1 };

function makeVideo(){
  const v = document.createElement('video');
  v.className = 'kkfx-src';
  v.src = BURST_MP4;
  v.muted = true; v.autoplay = true; v.playsInline = true; v.loop = false;
  v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  v.setAttribute('muted', ''); v.setAttribute('aria-hidden', 'true');
  v.preload = 'auto'; v.disablePictureInPicture = true;
  v.crossOrigin = 'anonymous';
  return v;
}

function makeGL(canvas, video){
  const opts = { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  if (!gl) return null;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, 'attribute vec2 aPos;varying vec2 vUv;void main(){vUv=aPos*0.5+0.5;gl_Position=vec4(aPos,0.0,1.0);}');
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  // Colour is premultiplied. With UNPACK_FLIP_Y, v=1 is the top of the video
  // (start of the colour half); v=0.5 is the join; v=0 is the bottom of alpha.
  gl.shaderSource(fs, [
    'precision mediump float;',
    'uniform sampler2D uTex;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 colorUv=vec2(vUv.x, vUv.y*0.5+0.5);',
    '  vec2 alphaUv=vec2(vUv.x, vUv.y*0.5);',
    '  vec3 color=texture2D(uTex, colorUv).rgb;',
    '  float alpha=texture2D(uTex, alphaUv).g;',
    '  if(alpha<0.02){gl_FragColor=vec4(0.0);return;}',
    '  gl_FragColor=vec4(color, alpha);',
    '}'
  ].join('\n'));
  gl.compileShader(fs);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  let sized = false;
  function resize(){
    const w = video.videoWidth || video.naturalWidth, h = video.videoHeight || video.naturalHeight;
    if (!w || !h) return false;
    const cw = w, ch = Math.round(h / 2);
    if (canvas.width !== cw || canvas.height !== ch){ canvas.width = cw; canvas.height = ch; }
    gl.viewport(0, 0, cw, ch);
    return true;
  }
  function draw(){
    if (video.tagName === 'VIDEO' && video.readyState < 2) return;
    if (!resize()) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    sized = true;
  }
  return { draw, kind: 'webgl', dispose(){ try{ gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext(); }catch(e){} } };
}

function make2D(canvas, video){
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return null;
  const off = document.createElement('canvas');
  const octx = off.getContext('2d', { willReadFrequently: true });
  function draw(){
    if (video.tagName === 'VIDEO' && video.readyState < 2) return;
    const w = video.videoWidth || video.naturalWidth, h2 = Math.round((video.videoHeight || video.naturalHeight) / 2);
    if (!w || !h2) return;
    if (canvas.width !== w || canvas.height !== h2){ canvas.width = w; canvas.height = h2; }
    if (off.width !== w || off.height !== h2){ off.width = w; off.height = h2; }
    octx.clearRect(0, 0, w, h2);
    octx.drawImage(video, 0, 0, w, h2, 0, 0, w, h2);
    const color = octx.getImageData(0, 0, w, h2);
    octx.clearRect(0, 0, w, h2);
    octx.drawImage(video, 0, h2, w, h2, 0, 0, w, h2);
    const a = octx.getImageData(0, 0, w, h2);
    const cd = color.data, ad = a.data;
    for (let i = 0; i < cd.length; i += 4){
      const A = ad[i + 1];
      if (A < 6){ cd[i] = cd[i+1] = cd[i+2] = cd[i+3] = 0; continue; }
      const inv = 255 / A;
      cd[i]   = Math.min(255, Math.round(cd[i]   * inv));
      cd[i+1] = Math.min(255, Math.round(cd[i+1] * inv));
      cd[i+2] = Math.min(255, Math.round(cd[i+2] * inv));
      cd[i+3] = A;
    }
    ctx.putImageData(color, 0, 0);
  }
  return { draw, kind: '2d', dispose(){} };
}

function addBurst(layer, tier, modeForce){
  preloadBurst();
  const wrap = document.createElement('div');
  wrap.className = 'kkfx-burst ' + tier;
  wrap.style.setProperty('--kkfx-scale', String(TIER_SCALE[tier] || 1));
  const v = makeVideo();
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  wrap.appendChild(v);
  wrap.appendChild(canvas);
  layer.appendChild(wrap); // in front of the card — blast covers it, then fades to reveal
  const force2d = modeForce === '2d';
  let painter = force2d ? make2D(canvas, v) : (makeGL(canvas, v) || make2D(canvas, v));
  if (!painter) return v;
  canvas.dataset.kkfxPainter = painter.kind;
  let raf = 0, stopped = false;
  const draw = () => { if (!stopped) painter.draw(); };
  const tick = () => {
    if (stopped || !layer.isConnected){ stopped = true; return; }
    draw();
    if (!v.ended) raf = requestAnimationFrame(tick);
  };
  v.addEventListener('seeked', draw);
  v.addEventListener('ended', draw);
  const play = () => { v.play().catch(() => {}); if (!raf) raf = requestAnimationFrame(tick); };
  if (v.readyState >= 2) play();
  else v.addEventListener('canplay', play, { once: true });
  wrap._kkfxStop = () => { stopped = true; if (raf) cancelAnimationFrame(raf); painter.dispose && painter.dispose(); };
  return v;
}

function show(stage, o){
  injectCss();
  const tip = Math.max(0, Number(o.tipCents) || 0), tier = ['small','medium','big'].includes(o.tier) ? o.tier : tierOf(tip);
  if(getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
  const layer = document.createElement('div'); layer.className = 'kkfx';
  stage.appendChild(layer);
  const u = Math.max(.18, layer.getBoundingClientRect().width / 1920);
  const hold0 = BURST_FALLBACK_S;
  layer.style.setProperty('--u', u); layer.style.setProperty('--hold', hold0 + 's');
  if(o.color) layer.style.setProperty('--kkc', o.color);
  const kicker = o.kicker ? o.kicker : o.test ? 'Test explosion' : o.kind === 'shoutout' ? 'Shout-out' : o.kind === 'custom' ? 'Custom request' : tier === 'big' ? '★ Big tip ★' : tip > 0 ? 'Tipped request' : 'New request';
  layer.innerHTML = (reduce() ? '' : `<div class="kkfx-flash${tier === 'big' ? ' big' : ''}"></div>`) +
    `<div class="kkfx-card ${tier}"><div class="kkfx-kick">${esc(kicker)}</div><div class="kkfx-title">${esc(o.title || 'Song request')}</div>` +
    (o.artist ? `<div class="kkfx-artist">${esc(o.artist)}</div>` : '') +
    (o.requester ? `<div class="kkfx-who">for ${esc(o.requester)}</div>` : '') +
    (o.badge ? `<div class="kkfx-tip">${esc(o.badge)}</div>` : tip > 0 ? `<div class="kkfx-tip">${money(tip)} tip</div>` : '') + `</div>`;
  const armHold = (seconds) => {
    const d = (isFinite(seconds) && seconds > 1) ? seconds : BURST_FALLBACK_S;
    layer.style.setProperty('--hold', d + 's');
    return Math.round((d + 0.55) * 1000);
  };
  let total = reduce() ? Math.round((1.2) * 1000) : armHold(hold0);
  if(!reduce()){
    const v = addBurst(layer, tier, o.burstMode);
    const apply = () => { total = armHold(v.duration); };
    if (v.readyState >= 1 && isFinite(v.duration) && v.duration > 1) apply();
    else v.addEventListener('loadedmetadata', apply, { once: true });
  }
  setTimeout(() => {
    const burst = layer.querySelector('.kkfx-burst');
    if (burst && burst._kkfxStop) burst._kkfxStop();
    layer.remove();
  }, total);
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
function compositeStill(stage, url, o){
  if (!stage || !url) return Promise.resolve();
  o = o || {};
  injectCss();
  if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
  const layer = document.createElement('div'); layer.className = 'kkfx';
  stage.appendChild(layer);
  const u = Math.max(.18, layer.getBoundingClientRect().width / 1920);
  layer.style.setProperty('--u', u); layer.style.setProperty('--hold', '30s');
  if (o.color) layer.style.setProperty('--kkc', o.color);
  const tip = Math.max(0, Number(o.tipCents) || 0), tier = 'medium';
  layer.innerHTML = `<div class="kkfx-card ${tier}" style="animation:kkfxIn .01s linear forwards"><div class="kkfx-kick">Test explosion</div><div class="kkfx-title">${esc(o.title || 'Piano Man')}</div>` +
    (o.artist ? `<div class="kkfx-artist">${esc(o.artist)}</div>` : '') +
    (o.requester ? `<div class="kkfx-who">for ${esc(o.requester)}</div>` : '') +
    (tip > 0 ? `<div class="kkfx-tip" style="animation:none;transform:scale(1)">${money(tip)} tip</div>` : '') + `</div>`;
  const wrap = document.createElement('div');
  wrap.className = 'kkfx-burst ' + tier;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  wrap.appendChild(canvas);
  layer.appendChild(wrap);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  return new Promise((resolve, reject) => {
    img.onload = () => {
      const painter = (o.burstMode === '2d' ? make2D(canvas, img) : (makeGL(canvas, img) || make2D(canvas, img)));
      if (!painter){ reject(new Error('no painter')); return; }
      canvas.dataset.kkfxPainter = painter.kind;
      painter.draw();
      resolve({ painter: painter.kind, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('still failed to load'));
    img.src = url;
  });
}
window.KKOverlayFX = { celebrate, tierOf, compositeStill };
})();

