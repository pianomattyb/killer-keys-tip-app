// Unit tests for Apple Notes colour handling in lib/sanitize.js
const { sanitizeNote, cleanStyle, isDefaultTextColor, liftColor } = require('../lib/sanitize');

const NOTES_STYLE = `<html>
<head>
<meta charset="utf-8">
<style type="text/css">
p.p1 {margin: 0.0px 0.0px 0.0px 0.0px; font: 18.0px 'Helvetica Neue'; color: #000000; -webkit-text-stroke: #000000}
span.s1 {font-kerning: none; color: #ff3b30; -webkit-text-stroke: 0px #ff3b30}
span.s2 {font-kerning: none; color: #ffcc00; -webkit-text-stroke: 0px #ffcc00}
span.s3 {font-kerning: none; color: #34c759}
span.s4 {text-decoration: underline; color: #007aff}
span.s5 {font-weight: bold; color: #000000}
</style>
</head>
<body>
<p class="p1">[Verse]</p>
<p class="p1"><span class="s1">C</span> When I find myself in times of <span class="s2">G</span>trouble</p>
<p class="p1"><span class="s3">Am</span> Mother Mary comes to <b>me</b></p>
<p class="p1"><span class="s4">F</span> Speaking words of wisdom</p>
</body>
</html>`;

const NOTES_DARK = `<html><head><style>
p.p1 {color: #ffffff; font: 18.0px 'Helvetica Neue'}
span.s1 {color: #ff3b30}
</style></head>
<body>
<p class="p1">plain default <span class="s1">C</span> red chord</p>
</body></html>`;

const INLINE = '<div><span style="color: rgb(255, 38, 0)">C</span> When I find myself</div>';
const FONT = '<div><font color="#FEFF0A">G</font> in times of trouble</div>';
const STYLE_IN_BODY = '<style>.s1 {color: rgb(33, 203, 255)}</style><div><span class="s1">E</span> lyric<script>window.__pwned=1</script></div>';
const FILL = '<span style="-webkit-text-fill-color: rgb(251, 0, 255)">F#</span>';
const IMPORTANT = '<span class="s1">D</span>';
const IMPORTANT_DOC = '<style>.s1 { color: #ff8a00 !important; }</style>' + IMPORTANT;

let failed = 0, passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

const out = sanitizeNote(NOTES_STYLE);
ok('style block dropped', !/<style/i.test(out) && !/class="s1"|class="p1"/.test(out), out.slice(0, 200));
ok('red C kept', /color:\s*(#ff3b30|rgb\(\s*255,\s*59,\s*48\))/i.test(out) && /<span[^>]*>C<\/span>/.test(out), out);
ok('yellow G kept', /color:\s*(#ffcc00|rgb\(\s*255,\s*204,\s*0\))/i.test(out) && />G</.test(out), out);
ok('green Am kept', /color:\s*(#34c759|rgb\(\s*52,\s*199,\s*89\))/i.test(out) && />Am</.test(out), out);
ok('blue underlined F kept', /color:\s*(#007aff|rgb\(\s*0,\s*122,\s*255\))/i.test(out) && /underline/i.test(out), out);
ok('bold me kept', /<b>me<\/b>/.test(out), out);
ok('default black dropped', !/#000000|rgb\(\s*0,\s*0,\s*0\)/i.test(out), out);
ok('line breaks kept as p or br or text of verse', /\[Verse\]/.test(out) && /When I find myself/.test(out), out);
ok('scripts not present', !/<script/i.test(out));

const dark = sanitizeNote(NOTES_DARK);
ok('dark-mode default white dropped', !/#ffffff|#fff\b|rgb\(\s*255,\s*255,\s*255\)/i.test(dark), dark);
ok('dark-mode red C kept', /color:\s*(#ff3b30|rgb\(\s*255,\s*59,\s*48\))/i.test(dark) && />C</.test(dark), dark);

const inl = sanitizeNote(INLINE);
ok('inline rgb red kept', /color:\s*rgb\(\s*255,\s*38,\s*0\)/.test(inl), inl);

const font = sanitizeNote(FONT);
ok('font color becomes span', /<span[^>]*color:\s*#FEFF0A/i.test(font) && !/<font/i.test(font), font);

const bodyStyle = sanitizeNote(STYLE_IN_BODY);
ok('body style class cyan kept, script stripped', /color:\s*rgb\(\s*33,\s*203,\s*255\)/.test(bodyStyle) && !/<script/i.test(bodyStyle) && !/__pwned/.test(bodyStyle), bodyStyle);

const fill = sanitizeNote(FILL);
ok('webkit-text-fill-color becomes color', /color:\s*rgb\(\s*251,\s*0,\s*255\)/.test(fill) && !/-webkit-text-fill-color/.test(fill), fill);

const imp = sanitizeNote(IMPORTANT_DOC);
ok('!important class color kept', /color:\s*#ff8a00/i.test(imp), imp);

ok('default colors detected', isDefaultTextColor('#000') && isDefaultTextColor('#ffffff') && isDefaultTextColor('black') && isDefaultTextColor('rgb(20,20,20)') && isDefaultTextColor('#fafafa'));
ok('real colors not default', !isDefaultTextColor('#ff3b30') && !isDefaultTextColor('rgb(43, 255, 43)') && !isDefaultTextColor('#007aff') && !isDefaultTextColor('red'));
ok('dark red is lifted not dropped', /^rgb\(/.test(liftColor('#8b0000')), liftColor('#8b0000'));

const js = sanitizeNote('<div onclick="x()">ok<script>alert(1)</script><iframe src="//e.com"></iframe><a href="javascript:alert(1)">l</a><span style="color:#fb0007;background:url(javascript:a)">red</span></div>');
ok('dangerous tags/attrs stripped, red kept', !/<script|onclick|<iframe|javascript:|url\(/i.test(js) && /color:\s*#fb0007/i.test(js), js);

const blackInline = sanitizeNote('<span style="color: rgb(0,0,0)">blacktext</span>');
ok('inline black dropped so it inherits editor white', !/color:/.test(blackInline) && /blacktext/.test(blackInline), blackInline);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
