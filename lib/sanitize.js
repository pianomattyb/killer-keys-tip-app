// Allow-list sanitizer for the rich-text chord charts ("notes").
// Shared by the server (authoritative, on every save) and mirrored in the browser
// for paste handling. Keeps only: div, p, br, span, b, strong, u, font(color/size)
// and the style properties color, font-weight, font-size, text-decoration(-line),
// font-style. Everything else is unwrapped (text kept) or dropped with its content
// (script, style, iframe, object, embed, svg, math, template, noscript, head, title).
const ALLOWED = new Set(['div', 'p', 'br', 'span', 'b', 'strong', 'u', 'font', 'i', 'em']);
const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'title', 'textarea', 'select', 'button', 'xml'];
const STYLE_OK = new Set(['color', 'font-weight', 'font-size', 'text-decoration', 'text-decoration-line', 'font-style']);

function cleanStyle(style) {
  const out = [];
  for (const decl of String(style || '').split(';')) {
    const i = decl.indexOf(':'); if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    let val = decl.slice(i + 1).trim();
    if (!STYLE_OK.has(prop)) continue;
    if (/url\s*\(|expression\s*\(|javascript:|[<>"]/i.test(val)) continue;
    if (prop === 'color' && !/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(val)) continue;
    if (prop === 'font-size' && !/^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/i.test(val) && !/^(small|medium|large|x-large|xx-large|larger|smaller)$/i.test(val)) continue;
    if ((prop === 'text-decoration' || prop === 'text-decoration-line') && !/underline|none/i.test(val)) continue;
    out.push(prop + ': ' + val);
  }
  return out.join('; ');
}

function sanitizeOnce(html) {
  let s = String(html || '');
  if (s.length > 2000000) s = s.slice(0, 2000000);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  for (const t of DROP_WITH_CONTENT) s = s.replace(new RegExp('<' + t + '\\b[\\s\\S]*?(<\\/' + t + '\\s*>|$)', 'gi'), '');
  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (m, tag, attrs) => {
    tag = tag.toLowerCase();
    const closing = m[1] === '/';
    if (!ALLOWED.has(tag)) return '';
    if (closing) return tag === 'br' ? '' : '</' + tag + '>';
    let style = '';
    const sm = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (sm) style = cleanStyle((sm[2] !== undefined ? sm[2] : sm[3]).replace(/&quot;/g, '"'));
    if (tag === 'font') { // <font color=...> -> span
      const cm = attrs.match(/\scolor\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const c = cm ? (cm[2] || cm[3] || cm[4]) : '';
      const st = cleanStyle((c ? 'color: ' + c : '') + (style ? '; ' + style : ''));
      return '<span' + (st ? ' style="' + st + '"' : '') + '>';
    }
    const cls = (attrs.match(/\sclass\s*=\s*"([^"]*)"/i) || [])[1] || '';
    const keepCls = cls.split(/\s+/).filter((c) => c === 'ch' || c === 'sec').join(' ');
    if (tag === 'br') return '<br>';
    return '<' + tag + (keepCls ? ' class="' + keepCls + '"' : '') + (style ? ' style="' + style + '"' : '') + '>';
  }).replace(/<\/font>/gi, '</span>');
}

function sanitizeNote(html) {
  // repeat until stable so pieces can't be re-assembled into a tag (e.g. "<scr<b>ipt>")
  let prev = String(html || ''), cur = sanitizeOnce(prev), n = 0;
  while (cur !== prev && n++ < 6) { prev = cur; cur = sanitizeOnce(cur); }
  // any "<" that does not start an allowed tag becomes text
  return cur.replace(/<(?!\/?(div|p|br|span|b|strong|u|i|em)\b)/gi, '&lt;');
}

module.exports = { sanitizeNote, cleanStyle };
