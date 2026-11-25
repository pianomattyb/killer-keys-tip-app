// Fireworks celebration — ported from the replica (client/src/fireworks.ts).
(function(){
// Fireworks celebration, ported from the visual model: rockets launch,
// burst into peony / ring / willow fireworks, and the burst sparks turn
// into dollar signs that rise up and float out through the top of the
// screen. Plus the thin green outline flash that holds for exactly
// 2 seconds to catch the performers' eyes mid-song.

let canvas                           = null;
let ctx2d                                  = null;
let W = 0;
let H = 0;
let rockets                                          = [];
let parts                                          = [];
let dollars                                         = [];
let running = false;
let lastT = 0;

const HUES = [45, 48, 110, 0, 190, 320, 265, 18];
const DOLLAR_COLORS = ["#58f339", "#7ee787", "#ffd76a", "#ffffff", "#3fb970"];

function initFireworks(el                   ) {
  canvas = el;
  ctx2d = el.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
}

function resize() {
  if (!canvas || !ctx2d) return;
  const d = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * d);
  canvas.height = Math.round(H * d);
  ctx2d.setTransform(d, 0, 0, d, 0, 0);
}

function explode(x        , y        , hue        , big         , willow         ) {
  const n = willow ? 55 : big ? 95 : 75;
  const mode = willow ? "willow" : Math.random() < 0.3 ? "ring" : "sphere";
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.14;
    let spd        ;
    if (mode === "ring") spd = 4.6 + Math.random() * 0.5;
    else if (mode === "willow") spd = 1 + Math.pow(Math.random(), 0.6) * 4.6;
    else spd = 0.6 + Math.pow(Math.random(), 0.5) * 5.9;
    parts.push({
      x, y, px: x, py: y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd * (mode === "ring" ? 0.86 : 1),
      age: 0,
      life: willow ? 95 + Math.random() * 55 : 62 + Math.random() * 38,
      hue: hue + (Math.random() * 18 - 9),
      sat: willow ? 95 : 100,
      light: 58 + Math.random() * 14,
      size: 1.5 + Math.random() * 1.1,
      willow: willow ? 1 : 0,
      phase: Math.random() * Math.PI * 2,
      dollarAt: 0.42 + Math.random() * 0.28,
      toDollar: Math.random() < 0.55 ? 1 : 0,
      trail: 0,
    });
  }
}

function launch(cx        , groundY        , apexY        , big         , delay        ) {
  setTimeout(() => {
    const hue = HUES[Math.floor(Math.random() * HUES.length)] ?? 45;
    rockets.push({
      x: cx + (Math.random() * 110 - 55),
      y: groundY,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -(10.6 + Math.random() * 1.8),
      targetY: apexY - Math.random() * 60,
      hue,
      big: big ? 1 : 0,
      willow: Math.random() < 0.35 ? 1 : 0,
    });
    start();
  }, delay);
}

function start() {
  if (!ctx2d || running) return;
  running = true;
  lastT = 0;
  requestAnimationFrame(tick);
}

function tick(t        ) {
  if (!ctx2d) return;
  if (!lastT) lastT = t;
  let dt = Math.min(40, t - lastT) / 16.667;
  lastT = t;
  if (dt <= 0) dt = 0.01;
  const c = ctx2d;
  c.clearRect(0, 0, W, H);
  c.globalCompositeOperation = "lighter";
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    if (!r) continue;
    r.x = (r.x          ) + (r.vx          ) * dt + Math.sin(t / 90 + (r.hue          )) * 0.3;
    r.y = (r.y          ) + (r.vy          ) * dt;
    r.vy = (r.vy          ) + 0.115 * dt;
    for (let k = 0; k < 2; k++) {
      parts.push({
        x: (r.x          ) + (Math.random() * 4 - 2), y: (r.y          ) + 4,
        px: r.x          , py: (r.y          ) + 4,
        vx: (Math.random() - 0.5) * 0.7, vy: 1 + Math.random() * 1.4,
        age: 0, life: 16 + Math.random() * 12, hue: 46, sat: 100, light: 62,
        size: 1.3, willow: 0, phase: 0, dollarAt: 2, toDollar: 0, trail: 1,
      });
    }
    c.beginPath();
    c.arc(r.x          , r.y          , 2.1, 0, Math.PI * 2);
    c.fillStyle = "rgba(255,236,190,.95)";
    c.fill();
    if ((r.vy          ) >= -1.1 || (r.y          ) <= (r.targetY          )) {
      explode(r.x          , r.y          , r.hue          , !!r.big, !!r.willow);
      rockets.splice(i, 1);
    }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p) continue;
    p.age = (p.age          ) + dt;
    const frac = (p.age          ) / (p.life          );
    if (!p.trail && p.toDollar && frac >= (p.dollarAt          )) {
      dollars.push({
        x: p.x          , y: p.y          ,
        vx: (p.vx          ) * 0.12, vy: -0.5 - Math.random() * 0.6,
        size: 13 + Math.random() * 13, rot: (Math.random() - 0.5) * 0.5,
        phase: Math.random() * Math.PI * 2,
        color: DOLLAR_COLORS[Math.floor(Math.random() * DOLLAR_COLORS.length)] ?? "#58f339",
        born: t,
      });
      parts.splice(i, 1);
      continue;
    }
    if ((p.age          ) >= (p.life          )) { parts.splice(i, 1); continue; }
    p.px = p.x          ; p.py = p.y          ;
    const drag = p.willow ? 0.988 : 0.984;
    const dragF = Math.pow(drag, dt);
    p.vx = (p.vx          ) * dragF;
    p.vy = (p.vy          ) * dragF + (p.willow ? 0.045 : 0.035) * dt;
    p.x = (p.x          ) + (p.vx          ) * dt;
    p.y = (p.y          ) + (p.vy          ) * dt;
    let a = 1 - frac;
    if (p.willow) a *= 0.72 + 0.28 * Math.sin(t / 55 + (p.phase          ));
    else if (!p.trail) a *= 0.85 + 0.15 * Math.sin(t / 70 + (p.phase          ));
    c.beginPath();
    c.moveTo(p.px          , p.py          );
    c.lineTo(p.x          , p.y          );
    c.strokeStyle = `hsla(${p.hue},${p.sat}%,${p.light}%,${Math.max(0, a).toFixed(3)})`;
    c.lineWidth = p.size          ;
    c.lineCap = "round";
    c.stroke();
  }
  c.globalCompositeOperation = "source-over";
  for (let i = dollars.length - 1; i >= 0; i--) {
    const d = dollars[i];
    if (!d) continue;
    d.vy = Math.max(-2.3, (d.vy          ) - 0.016 * dt);
    d.x = (d.x          ) + ((d.vx          ) + Math.sin(t / 480 + (d.phase          )) * 0.55) * dt;
    d.y = (d.y          ) + (d.vy          ) * dt;
    if ((d.y          ) < -34) { dollars.splice(i, 1); continue; }
    const da = (d.y          ) < 110 ? Math.max(0, ((d.y          ) + 34) / 144) : 1;
    const ageIn = Math.min(1, (t - (d.born          )) / 160);
    c.save();
    c.translate(d.x          , d.y          );
    c.rotate((d.rot          ) + Math.sin(t / 520 + (d.phase          )) * 0.18);
    c.globalAlpha = da * ageIn;
    c.font = `800 ${d.size}px Urbanist, Archivo, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = d.color          ;
    c.fillText("$", 0, 0);
    c.restore();
  }
  c.globalAlpha = 1;
  if (rockets.length || parts.length || dollars.length) requestAnimationFrame(tick);
  else { running = false; c.clearRect(0, 0, W, H); }
}

function show(cx        , groundY        , apexY        , big         ) {
  if (!ctx2d) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (big) {
    launch(cx, groundY, apexY, true, 0);
    launch(cx, groundY, apexY + 26, true, 200);
    launch(cx, groundY, apexY - 14, true, 420);
  } else {
    launch(cx, groundY, apexY, false, 0);
    launch(cx, groundY, apexY + 22, false, 190);
  }
}

function fireworksOnElement(el                    , big         ) {
  if (!el) { show(W / 2, H - 8, H * 0.3, big); return; }
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) { show(W / 2, H - 8, H * 0.3, big); return; }
  const cx = r.left + r.width / 2;
  const groundY = Math.min(H - 8, r.bottom + 26);
  const apexY = Math.max(44, Math.min(r.top - 130, H * 0.42));
  show(cx, groundY, apexY, big);
}

let flashTimer                                       = null;
function screenFlash(el                    ) {
  if (!el) return;
  el.classList.remove("on");
  void el.offsetWidth;
  el.classList.add("on");
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("on"), 2000);
}

window.KKFireworks={initFireworks,fireworksOnElement,screenFlash};
})();
