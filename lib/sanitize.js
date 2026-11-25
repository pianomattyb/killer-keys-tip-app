// Allow-list sanitizer for the rich-text chord charts ("notes").
// Shared by the server (authoritative, on every save) and mirrored in the browser
// for paste handling. Keeps only: div, p, br, span, b, strong, u, font(color/size)
// and the style properties color, font-weight, font-size, text-decoration(-line),
// font-style. Apple Notes often puts colours in a <style> block with class rules
// (and sometimes <font color> or -webkit-text-fill-color); those are resolved
// to inline color spans before <style> is dropped. Default black / near-black /
// white text is removed so it inherits the editor's white on black; real colours stay.
// Everything else is unwrapped (text kept) or dropped with its content
// (script, style, iframe, object, embed, svg, math, template, noscript, head, title).
const ALLOWED = new Set(['div', 'p', 'br', 'span', 'b', 'strong', 'u', 'font', 'i', 'em']);
const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'title', 'textarea', 'select', 'button', 'xml'];
const STYLE_OK = new Set(['color', 'font-weight', 'font-size', 'text-decoration', 'text-decoration-line', 'font-style']);

const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], blue: [0, 0, 255],
  green: [0, 128, 0], lime: [0, 255, 0], yellow: [255, 255, 0], cyan: [0, 255, 255],
  magenta: [255, 0, 255], orange: [255, 165, 0], purple: [128, 0, 128],
  navy: [0, 0, 128], maroon: [128, 0, 0], teal: [0, 128, 128], aqua: [0, 255, 255],
  fuchsia: [255, 0, 255], silver: [192, 192, 192], gray: [128, 128, 128], grey: [128, 128, 128]
};

function lum(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function parseRgb(val) {
  val = String(val || '').trim().replace(/!important/ig, '').trim();
  if (!val || /^(inherit|currentcolor|transparent|initial|unset|none)$/i.test(val)) return null;
  const named = NAMED[val.toLowerCase()];
  if (named) return named.slice();
  let m = val.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('').slice(0, 6);
    else if (h.length >= 6) h = h.slice(0, 6);
    else return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = val.match(/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)/i);
  if (m) {
    const conv = (x) => String(x).endsWith('%') ? Math.round(parseFloat(x) * 2.55) : Number(x);
    return [conv(m[1]), conv(m[2]), conv(m[3])];
  }
  return null;
}

// Neutral black / near-black / white / near-white → editor default (white on black).
// Real hues (red, yellow, green, blue…) are kept.
function isDefaultTextColor(val) {
  const rgb = parseRgb(val);
  if (!rgb) return true;
  const [r, g, b] = rgb;
  if (Math.max(r, g, b) - Math.min(r, g, b) >= 40) return false;
  const L = lum(r, g, b);
  return L < 0.35 || L > 0.85;
}

function liftColor(val) {
  const rgb = parseRgb(val);
  if (!rgb || isDefaultTextColor(val)) return '';
  let [r, g, b] = rgb, k = 0;
  while (lum(r, g, b) < 0.16 && k < 14) { r += (255 - r) * 0.18; g += (255 - g) * 0.18; b += (255 - b) * 0.18; k++; }
  return k ? ('rgb(' + (r | 0) + ', ' + (g | 0) + ', ' + (b | 0) + ')') : String(val).trim().replace(/!important/ig, '').trim();
}

function attr(attrs, name) {
  const m = String(attrs || '').match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? (m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4])) : '';
}

function isOkColor(val) {
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(val) && !/url\s*\(|expression\s*\(|javascript:|[<>"]/i.test(val);
}

function cleanStyle(style) {
  const seen = new Set();
  const out = [];
  let fill = '';
  for (const decl of String(style || '').split(';')) {
    const i = decl.indexOf(':'); if (i < 0) continue;
    let prop = decl.slice(0, i).trim().toLowerCase();
    let val = decl.slice(i + 1).trim().replace(/!important/ig, '').trim();
    if (prop === '-webkit-text-fill-color') { fill = val; continue; }
    if (!STYLE_OK.has(prop)) continue;
    if (/url\s*\(|expression\s*\(|javascript:|[<>"]/i.test(val)) continue;
    if (prop === 'color') {
      if (!isOkColor(val)) continue;
      val = liftColor(val);
      if (!val) continue;
    }
    if (prop === 'font-size' && !/^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/i.test(val) && !/^(small|medium|large|x-large|xx-large|larger|smaller)$/i.test(val)) continue;
    if ((prop === 'text-decoration' || prop === 'text-decoration-line') && !/underline|none/i.test(val)) continue;
    if (seen.has(prop)) {
      const idx = out.findIndex((x) => x.startsWith(prop + ': '));
      if (idx >= 0) out.splice(idx, 1);
    }
    seen.add(prop);
    out.push(prop + ': ' + val);
  }
  if (fill && !seen.has('color') && isOkColor(fill)) {
    const v = liftColor(fill);
    if (v) out.unshift('color: ' + v);
  }
  return out.join('; ');
}

function extractStyleText(html) {
  const texts = [];
  String(html || '').replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    texts.push(String(css).replace(/<!--[\s\S]*?-->/g, ''));
    return '';
  });
  return texts.join('\n');
}

function parseCssRules(css) {
  css = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
  const rules = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const decls = cleanStyle(m[2]);
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const sel of selectors) {
      const compact = sel.replace(/\s+/g, ' ').trim();
      if (/[>+~:[\]@]/.test(compact) || /\s/.test(compact)) continue;
      if (!/^([a-z][a-z0-9-]*)?(#[A-Za-z][\w-]*)?(\.[A-Za-z][\w-]*)*$/i.test(compact)) continue;
      if (!compact || compact === '*') continue;
      rules.push({ selector: compact, style: decls });
    }
  }
  return rules;
}

function selectorMatches(tag, classes, id, selector) {
  const m = String(selector).match(/^([a-z][a-z0-9-]*)?(#[A-Za-z][\w-]*)?((?:\.[A-Za-z][\w-]*)*)$/i);
  if (!m) return false;
  const t = (m[1] || '').toLowerCase();
  const i = (m[2] || '').slice(1);
  const cs = (m[3] || '').split('.').filter(Boolean);
  if (t && t !== tag) return false;
  if (i && i !== id) return false;
  for (const c of cs) if (!classes.has(c)) return false;
  if (!t && !i && !cs.length) return false;
  return true;
}

function cssStyleFor(tag, classAttr, id, rules) {
  const classes = new Set(String(classAttr || '').split(/\s+/).filter(Boolean));
  const parts = [];
  for (const r of rules || []) {
    if (selectorMatches(tag, classes, id || '', r.selector) && r.style) parts.push(r.style);
  }
  return parts.join('; ');
}

function sanitizeOnce(html, rules) {
  let s = String(html || '');
  if (s.length > 2000000) s = s.slice(0, 2000000);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  for (const t of DROP_WITH_CONTENT) s = s.replace(new RegExp('<' + t + '\\b[\\s\\S]*?(<\\/' + t + '\\s*>|$)', 'gi'), '');
  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (m, tag, attrs) => {
    tag = tag.toLowerCase();
    const closing = m[1] === '/';
    if (!ALLOWED.has(tag)) return '';
    if (closing) return tag === 'br' ? '' : '</' + tag + '>';
    const fromCss = cssStyleFor(tag, attr(attrs, 'class'), attr(attrs, 'id'), rules || []);
    let style = fromCss;
    const inline = attr(attrs, 'style').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (tag === 'font') {
      const c = attr(attrs, 'color');
      if (c) style += (style ? '; ' : '') + 'color: ' + c;
    }
    if (inline) style += (style ? '; ' : '') + inline;
    const st = cleanStyle(style);
    const cls = attr(attrs, 'class');
    const keepCls = cls.split(/\s+/).filter((c) => c === 'ch' || c === 'sec').join(' ');
    if (tag === 'font') return '<span' + (st ? ' style="' + st + '"' : '') + '>';
    if (tag === 'br') return '<br>';
    return '<' + tag + (keepCls ? ' class="' + keepCls + '"' : '') + (st ? ' style="' + st + '"' : '') + '>';
  }).replace(/<\/font>/gi, '</span>');
}

function sanitizeNote(html) {
  // Extract class/tag colour rules before <style> blocks are dropped, then
  // repeat until stable so pieces can't be re-assembled into a tag (e.g. "<scr<b>ipt>").
  const rules = parseCssRules(extractStyleText(html));
  let prev = String(html || ''), cur = sanitizeOnce(prev, rules), n = 0;
  while (cur !== prev && n++ < 6) { prev = cur; cur = sanitizeOnce(cur, rules); }
  // any "<" that does not start an allowed tag becomes text
  return cur.replace(/<(?!\/?(div|p|br|span|b|strong|u|i|em)\b)/gi, '&lt;');
}

module.exports = { sanitizeNote, cleanStyle, parseCssRules, extractStyleText, isDefaultTextColor, liftColor };
