(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../vendor/markdown-it.min.js'), null, null);
  } else {
    root.ResearchMarkdown = factory(root.markdownit, root.katex, root.jsyaml);
  }
})(globalThis, function (MarkdownIt, katex, yaml) {
  'use strict';

  const parser = new MarkdownIt({ html: false, linkify: false, maxNesting: 24 });
  const noteExtension = /\.(?:md|markdown)$/i;
  const localExtension = /\.(?:md|markdown|png|jpe?g|gif|webp|avif|bmp|pdf|csv|txt|xlsx?|docx?|pptx?|zip|mp3|wav|mp4)$/i;
  const escape = parser.utils.escapeHtml;
  const boundaries = /^---[ \t]*\n(?:([\s\S]*?)\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/;

  function split(text) {
    const value = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const match = boundaries.exec(value);
    return match ? { yaml: match[1] || '', body: value.slice(match[0].length) } : { yaml: '', body: value };
  }

  function wikiLink(state, silent) {
    const start = state.pos;
    const embedded = state.src.startsWith('![[', start);
    if (!embedded && !state.src.startsWith('[[', start)) return false;
    const begin = start + (embedded ? 3 : 2);
    const end = state.src.indexOf(']]', begin);
    if (end === -1 || end + 2 > state.posMax) return false;
    const text = state.src.slice(begin, end);
    if (!text || /[\r\n\[\]]/.test(text)) return false;
    const [target, alias] = text.split('|');
    if (!target.trim()) return false;
    if (!silent) {
      const token = state.push('wiki_link', '', 0);
      token.markup = state.src.slice(start, end + 2);
      token.meta = { offset: start, target: target.trim(), label: alias?.trim() || target.split('/').pop(), embedded, wiki: true };
    }
    state.pos = end + 2;
    return true;
  }

  function mathInline(state, silent) {
    const start = state.pos;
    if (state.src[start] !== '$' || /[\s$]/.test(state.src[start + 1] || ' ')) return false;
    const endOfLine = state.src.indexOf('\n', start + 1);
    const limit = Math.min(state.posMax, endOfLine < 0 ? state.posMax : endOfLine);
    let end = state.src.indexOf('$', start + 1);
    while (end !== -1 && end < limit && state.src[end - 1] === '\\') end = state.src.indexOf('$', end + 1);
    if (end === -1 || end >= limit || /\s/.test(state.src[end - 1]) || /\d/.test(state.src[end + 1] || '')) return false;
    if (!silent) state.push('math_inline', '', 0).content = state.src.slice(start + 1, end);
    state.pos = end + 1;
    return true;
  }

  function mathBlock(state, start, end, silent) {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const line = i => state.src.slice(state.bMarks[i] + state.tShift[i], state.eMarks[i]);
    const first = line(start);
    if (!first.startsWith('$$')) return false;
    const lines = [first.slice(2)];
    let row = start;
    while (!/\$\$[ \t]*$/.test(lines.at(-1))) {
      row++;
      if (row >= end || state.sCount[row] < state.blkIndent) return false;
      lines.push(line(row));
    }
    if (silent) return true;
    lines[lines.length - 1] = lines.at(-1).replace(/\$\$[ \t]*$/, '');
    const token = state.push('math_block', '', 0);
    token.content = lines.join('\n').trim();
    token.block = true;
    token.map = [start, row + 1];
    state.line = row + 1;
    return true;
  }

  parser.inline.ruler.before('link', 'wiki_link', wikiLink);
  parser.inline.ruler.before('escape', 'math_inline', mathInline);
  parser.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph'] });

  function math(source, display) {
    const element = display ? 'div' : 'span';
    const fallback = '<code>' + escape(source) + '</code>';
    let rendered = fallback;
    if (katex && source.length <= 1500) {
      try {
        rendered = katex.renderToString(source, { output: 'mathml', displayMode: display, throwOnError: true,
          trust: false, maxExpand: 250, maxSize: 16 });
      } catch (_) { /* Keep invalid formulas visible as source text. */ }
    }
    return '<' + element + ' class="rw-markdown-math' + (display ? ' rw-markdown-display-math' : '') +
      '">' + rendered + '</' + element + '>';
  }

  function localRef(target, wiki) {
    let raw = String(target || '').trim();
    if (!raw || raw.length > 1024 || /^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(raw) || /^#/.test(raw)) return null;
    if (wiki) {
      const anchor = raw.indexOf('#');
      if (anchor !== -1) raw = raw.slice(0, anchor);
      if (!raw || /[<>:"|?*\x00-\x1f]/.test(raw)) return null;
    } else {
      raw = raw.split(/[?#]/)[0];
      try { raw = decodeURIComponent(raw); } catch { return null; }
      if (!raw || /[<>:"|?*\x00-\x1f]/.test(raw) || !localExtension.test(raw)) return null;
    }
    const attachment = !noteExtension.test(raw) && localExtension.test(raw);
    return { name: raw.replace(/\\/g, '/'), attachment };
  }

  function button(ref, fallbackLabel, env) {
    const label = escape(ref.label || fallbackLabel || ref.target);
    const local = localRef(ref.target, ref.wiki);
    if (env.links === false || !local) return label;
    const embed = ref.embedded && local.attachment;
    return (embed ? '<span class="rw-note-embed">' : '') +
      '<button type="button" class="fw-wikilink" data-full="follow-note" value="' + escape(ref.target) +
      '" data-note-wiki="' + Boolean(ref.wiki) + '"' + (embed ? ' data-note-embed="true"' : '') + '>' +
      label + '</button>' + (embed ? '</span>' : '');
  }

  parser.renderer.rules.math_inline = (tokens, index) => math(tokens[index].content, false);
  parser.renderer.rules.math_block = (tokens, index) => math(tokens[index].content, true);
  parser.renderer.rules.wiki_link = (tokens, index, _options, env) => button(tokens[index].meta, '', env);
  parser.renderer.rules.link_open = (tokens, index, _options, env) => {
    const target = tokens[index].attrGet('href');
    const local = env.links !== false && localRef(target, false);
    env.localLink = local;
    return local ? '<button type="button" class="fw-wikilink" data-full="follow-note" value="' +
      escape(target) + '" data-note-wiki="false">' : '<span>';
  };
  parser.renderer.rules.link_close = (_tokens, _index, _options, env) => env.localLink ? '</button>' : '</span>';
  parser.renderer.rules.image = (tokens, index, _options, env) => {
    const token = tokens[index];
    return button({ target: token.attrGet('src'), label: token.content, embedded: true, wiki: false }, '', env);
  };

  function links(text) {
    const refs = new Map();
    for (const block of parser.parse(split(text).body, {})) {
      for (const child of block.children || []) {
        const token = child.type;
        const ref = token === 'wiki_link' ? child.meta : token === 'image' ?
          { target: child.attrGet('src'), wiki: false, embedded: true } : token === 'link_open' ?
            { target: child.attrGet('href'), wiki: false, embedded: false } : null;
        if (ref && localRef(ref.target, ref.wiki)) refs.set(JSON.stringify([ref.target, ref.wiki]), ref);
      }
    }
    return [...refs.values()];
  }

  function wikiOccurrences(text) {
    const input = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const body = split(input).body;
    const offset = input.slice(0, input.length - body.length).split('\n').length - 1;
    const rows = body.split('\n');
    const found = [];
    let active = [0, rows.length];
    let nextColumn = new Map();
    for (const block of parser.parse(body, {})) {
      if (block.map) {
        active = block.map;
        nextColumn = new Map();
      }
      const inlineLines = block.content.split('\n');
      const bases = new Map();
      for (const child of block.children || []) {
        if (child.type !== 'wiki_link' || child.meta.target.length > 1024 || child.meta.target.startsWith('#')) continue;
        const { offset: start, ...ref } = child.meta;
        const preceding = block.content.slice(0, start).split('\n');
        const innerRow = preceding.length - 1;
        const row = active[0] + innerRow;
        if (!bases.has(row)) {
          const text = inlineLines[innerRow];
          bases.set(row, rows[row]?.indexOf(text, nextColumn.get(row) || 0) ?? -1);
        }
        const base = bases.get(row);
        const column = base < 0 ? undefined : base + preceding.at(-1).length + 1;
        if (column) nextColumn.set(row, column - 1 + child.markup.length);
        found.push({ ...ref, line: row + offset + 1, ...(column ? { column } : {}) });
      }
    }
    return found;
  }

  function properties(text) {
    const frontmatter = split(text).yaml;
    if (!frontmatter || !yaml || frontmatter.length > 64 * 1024) return { raw: frontmatter, rows: [] };
    try {
      const values = yaml.load(frontmatter, { schema: yaml.JSON_SCHEMA });
      const aliases = new Set();
      const safeValue = (value, depth = 0) => {
        if (value == null) return '空';
        if (typeof value !== 'object') return String(value).slice(0, 240);
        if (depth >= 3 || aliases.has(value)) return '…';
        aliases.add(value);
        return (Array.isArray(value) ? value.slice(0, 30).map(item => safeValue(item, depth + 1)).join('、') :
          Object.keys(value).slice(0, 15).map(key => key + '：' + safeValue(value[key], depth + 1)).join('、')).slice(0, 600);
      };
      return { raw: frontmatter, rows: values && typeof values === 'object' && !Array.isArray(values) ?
        Object.keys(values).slice(0, 60).map(key => [key, safeValue(values[key])]) : [] };
    } catch (_) {
      return { raw: frontmatter, rows: [], invalid: true };
    }
  }

  return { split, links, localRef, wikiOccurrences, properties, render: (value, options = {}) => parser.render(split(value).body, options) };
});
