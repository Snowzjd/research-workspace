/* ==========================================================================
   线性图标库（1.7px stroke，24 格栅）
   替代 emoji，用于提升界面质感与视觉一致性
   ========================================================================== */

const ICON_PATHS = {
  flask:      '<path d="M9.2 2.8h5.6"/><path d="M10.2 2.8v6.6L5.4 16.9A2 2 0 0 0 7.2 20h9.6a2 2 0 0 0 1.8-3.1L13.8 9.4V2.8"/><path d="M7.6 14.2h8.8"/>',
  home:       '<path d="M3.2 10.4 12 3.2l8.8 7.2"/><path d="M5.6 9.4V20a1 1 0 0 0 1 1h10.8a1 1 0 0 0 1-1V9.4"/>',
  grid:       '<rect x="3.6" y="3.6" width="7" height="7" rx="1.8"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.8"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.8"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.8"/>',
  tasks:      '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.2"/><path d="m8.2 12.2 2.6 2.6 5-5.6"/>',
  clock:      '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 1.8"/>',
  book:       '<path d="M4.2 4.8A1.6 1.6 0 0 1 5.8 3.2H19v14.4H5.8a1.6 1.6 0 0 0-1.6 1.6z"/><path d="M4.2 19.2a1.6 1.6 0 0 1 1.6-1.6H19v3.2H5.8a1.6 1.6 0 0 1-1.6-1.6z"/>',
  bot:        '<rect x="4.2" y="8" width="15.6" height="11.2" rx="3.2"/><path d="M12 4.2v3.8"/><circle cx="9.2" cy="13.2" r="1.1"/><circle cx="14.8" cy="13.2" r="1.1"/><path d="M6 19.2v1.4M18 19.2v1.4"/>',
  zap:        '<path d="M13.2 2.4 4.8 13.6h6.2l-1 8 8.4-11.2h-6.2z"/>',
  rocket:     '<path d="M12 3.2c3.4 1.6 5.4 5 5.4 9l-2.9 3H9.5l-2.9-3c0-4 2-7.4 5.4-9z"/><path d="M9.5 15.2 8.1 21l3.9-2 3.9 2-1.4-5.8"/><circle cx="12" cy="10" r="1.6"/>',
  globe:      '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4c2.4 2.3 3.6 5.2 3.6 8.6S14.4 18.3 12 20.6c-2.4-2.3-3.6-5.2-3.6-8.6S9.6 5.7 12 3.4z"/>',
  settings:   '<path d="M4 6.8h8.5M17 6.8h2.6M4 12h3.4M11.6 12h8M4 17.2h10.5M18.7 17.2h.9"/><circle cx="15" cy="6.8" r="2"/><circle cx="9.4" cy="12" r="2"/><circle cx="16.5" cy="17.2" r="2"/>',
  search:     '<circle cx="11" cy="11" r="6.6"/><path d="m16 16 4.4 4.4"/>',
  bell:       '<path d="M18.1 8.6a6.1 6.1 0 1 0-12.2 0c0 5-2.1 6.6-2.1 6.6h16.4s-2.1-1.6-2.1-6.6"/><path d="M13.7 18.9a2 2 0 0 1-3.4 0"/>',
  plus:       '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
  chevronRight: '<path d="m9.6 5.6 6.4 6.4-6.4 6.4"/>',
  more:       '<circle cx="5.6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.4" cy="12" r="1.4"/>',
  folder:     '<path d="M3.6 7.6A2.6 2.6 0 0 1 6.2 5h3l2 2.6h6.6a2.6 2.6 0 0 1 2.6 2.6v6.2a2.6 2.6 0 0 1-2.6 2.6H6.2a2.6 2.6 0 0 1-2.6-2.6z"/>',
  folderOpen: '<path d="M3.6 8.4V6.2A2.2 2.2 0 0 1 5.8 4h3.4l1.8 2.4h6.2a2.2 2.2 0 0 1 2.2 2.2v1.2"/><path d="M3.3 10.6h16.4l-2 7.6A2 2 0 0 1 15.8 20H6.4a2 2 0 0 1-1.9-1.5z"/>',
  file:       '<path d="M13.6 3.4H7.4A2.2 2.2 0 0 0 5.2 5.6v12.8a2.2 2.2 0 0 0 2.2 2.2h9.2a2.2 2.2 0 0 0 2.2-2.2V8.8z"/><path d="M13.6 3.4v5.4h5.2"/>',
  externalLink: '<path d="M14 4.4h5.6V10"/><path d="M19.6 4.4 11 13"/><path d="M18.2 13.6v4.8a2.2 2.2 0 0 1-2.2 2.2H6a2.2 2.2 0 0 1-2.2-2.2V8.2A2.2 2.2 0 0 1 6 6h4.6"/>',
  copy:       '<rect x="8.6" y="8.6" width="11" height="11" rx="2.4"/><path d="M5.6 15.4H5A1.6 1.6 0 0 1 3.4 13.8V5.6A2.2 2.2 0 0 1 5.6 3.4h8.2a1.6 1.6 0 0 1 1.6 1.6v.6"/>',
  pencil:     '<path d="M4 20h4.2L18.7 9.5a2.1 2.1 0 0 0-3-3L5.2 17z"/><path d="m14.6 5.6 4 4"/>',
  trash:      '<path d="M4.6 6.6h14.8M9.6 6.6V4.9a1.3 1.3 0 0 1 1.3-1.3h2.2a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="m6.6 6.6.9 12.4a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l.9-12.4"/>',
  play:       '<path d="M8 5.4v13.2L18.2 12z"/>',
  stop:       '<rect x="6.2" y="6.2" width="11.6" height="11.6" rx="2.4"/>',
  refresh:    '<path d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9"/><path d="M20.2 4.2v4.8h-4.8"/>',
  check:      '<path d="m5 12.6 4.6 4.6L19.2 7"/>',
  x:          '<path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8"/>',
  database:   '<ellipse cx="12" cy="6" rx="7.6" ry="2.9"/><path d="M4.4 6v12c0 1.6 3.4 2.9 7.6 2.9s7.6-1.3 7.6-2.9V6"/><path d="M4.4 12c0 1.6 3.4 2.9 7.6 2.9s7.6-1.3 7.6-2.9"/>',
  calendar:   '<rect x="3.6" y="5.2" width="16.8" height="15.2" rx="2.6"/><path d="M3.6 9.8h16.8M8 2.8v4.2M16 2.8v4.2"/>',
  user:       '<circle cx="12" cy="8.6" r="3.8"/><path d="M4.6 20.6a7.4 7.4 0 0 1 14.8 0"/>',
  cpu:        '<rect x="7.2" y="7.2" width="9.6" height="9.6" rx="2.2"/><path d="M10 2.8v4.4M14 2.8v4.4M10 16.8v4.4M14 16.8v4.4M2.8 10h4.4M2.8 14h4.4M16.8 10h4.4M16.8 14h4.4"/>',
  link:       '<path d="M10 13.6a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1 1"/><path d="M14 10.4a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1-1"/>',
  alert:      '<path d="M12 4 3.2 20h17.6z"/><path d="M12 9.8v4.6M12 17.4v.2"/>',
  arrowRight: '<path d="M4.4 12h15.2M13.6 6l6 6-6 6"/>',
  arrowLeft:  '<path d="M19.6 12H4.4M10.4 6l-6 6 6 6"/>',
  undo:       '<path d="M4 10h9.2a5.4 5.4 0 0 1 0 10.8H7.4"/><path d="M7.6 6.2 3.6 10l4 3.8"/>',
  redo:       '<path d="M20 10h-9.2a5.4 5.4 0 0 0 0 10.8h5.8"/><path d="M16.4 6.2 20.4 10l-4 3.8"/>',
  shield:     '<path d="M12 3.2 4.8 6v6.1c0 4.2 2.9 7.4 7.2 8.7 4.3-1.3 7.2-4.5 7.2-8.7V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  list:       '<path d="M8.4 6.6h11.2M8.4 12h11.2M8.4 17.4h11.2M4.4 6.6h.1M4.4 12h.1M4.4 17.4h.1"/>',
  columns:    '<rect x="3.6" y="4" width="4.9" height="16" rx="1.6"/><rect x="9.6" y="4" width="4.9" height="16" rx="1.6"/><rect x="15.6" y="4" width="4.9" height="16" rx="1.6"/>',
  chart:      '<path d="M4 4v16h16"/><path d="M8 16.4V12M12.4 16.4V7.6M16.8 16.4v-5.8"/>',
  branch:     '<circle cx="6.2" cy="6" r="2.4"/><circle cx="6.2" cy="18" r="2.4"/><circle cx="18" cy="12" r="2.4"/><path d="M6.2 8.4v7.2M8.6 6h4.2a3 3 0 0 1 3 3v.6M8.6 18h4.2a3 3 0 0 0 3-3v-.6"/>',
  pulse:      '<path d="M3 12h3.8l2.4-6 4 12 2.2-6H21"/>',
  layers:     '<path d="M12 3.4 3.4 7.8 12 12.2l8.6-4.4z"/><path d="m3.4 12.6 8.6 4.4 8.6-4.4"/>',
  target:     '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r=".9"/>',
  sparkles:   '<path d="M12 3.6 13.7 9 19 10.8 13.7 12.6 12 18l-1.7-5.4L5 10.8 10.3 9z"/><path d="M18.8 4v3M20.3 5.5h-3"/>',
  filter:     '<path d="M3.6 5.2h16.8l-6.6 7.6v6.2l-3.6 1.8v-8z"/>',
  send:       '<path d="M21 3.4 10.6 13.8"/><path d="M21 3.4 14.6 20.8 10.6 13.8 3.6 9.8z"/>',
  hardDrive:  '<rect x="3.4" y="12.8" width="17.2" height="7.4" rx="2.2"/><path d="M5.6 12.8 8 5.2h8l2.4 7.6"/><path d="M7.4 16.4h.1M10.8 16.4h.1"/>',
  terminal:   '<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.6"/><path d="m7.6 10 2.4 2.4-2.4 2.4M12.8 15h3.6"/>',
  download:   '<path d="M12 3.6v11.2M7.6 10.4 12 14.8l4.4-4.4"/><path d="M4.4 17.6v1.2a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-1.2"/>',
  save:       '<path d="M5.6 3.6h10l3.8 3.8v11a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2z"/><path d="M8.4 3.6v5.2h6.4V3.6M8.4 20.4v-6h7.2v6"/>',
  inbox:      '<path d="M3.6 12.6 6 5.2h12l2.4 7.4v5.8a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"/><path d="M3.6 12.6h4.8l1.2 2.6h4.8l1.2-2.6h4.8"/>',
  eye:        '<path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.8"/>'
};

function icon(name, style) {
  const p = ICON_PATHS[name] || '';
  return `<span class="icon"${style ? ` style="${style}"` : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg></span>`;
}

/* ---------- 文件类型（颜色 + 角标） ---------- */
const FILE_TYPES = {
  pdf:  { c: '#CE2C31', t: 'PDF' },
  docx: { c: '#3E63DD', t: 'DOC' }, doc: { c: '#3E63DD', t: 'DOC' },
  xlsx: { c: '#218358', t: 'XLS' }, csv: { c: '#218358', t: 'CSV' },
  pptx: { c: '#AD5700', t: 'PPT' },
  py:   { c: '#3E63DD', t: 'PY' },  ipynb: { c: '#AD5700', t: 'IPY' },
  md:   { c: '#6E56CF', t: 'MD' },  txt: { c: '#7A7A87', t: 'TXT' },
  yaml: { c: '#6E56CF', t: 'YML' }, yml: { c: '#6E56CF', t: 'YML' },
  zip:  { c: '#AD5700', t: 'ZIP' }, rar: { c: '#AD5700', t: 'RAR' },
  case: { c: '#C9256B', t: 'CASE' }, dat: { c: '#C9256B', t: 'DAT' },
  h5:   { c: '#C9256B', t: 'H5' },
  img:  { c: '#0D7485', t: 'IMG' }, png: { c: '#0D7485', t: 'PNG' }, jpg: { c: '#0D7485', t: 'JPG' },
  cad:  { c: '#6E56CF', t: 'CAD' }, scdoc: { c: '#6E56CF', t: 'SCDM' },
  dir:  { c: '#AD5700', t: 'DIR' }, log: { c: '#7A7A87', t: 'LOG' }
};
const DEFAULT_FT = { c: '#7A7A87', t: 'FILE' };
function fileType(ext) { return FILE_TYPES[String(ext || '').toLowerCase()] || DEFAULT_FT; }

/* 扩展名 → 图标的语义映射 */
const EXT_ICON = {
  pdf: 'file', docx: 'file', doc: 'file', txt: 'file', md: 'file',
  xlsx: 'chart', csv: 'chart',
  pptx: 'columns',
  py: 'terminal', ipynb: 'terminal', log: 'terminal', yaml: 'terminal', yml: 'terminal',
  zip: 'inbox', rar: 'inbox', dir: 'folder', img: 'target', png: 'target', jpg: 'target',
  case: 'cpu', dat: 'cpu', h5: 'cpu', cad: 'layers', scdoc: 'layers'
};
function extIcon(ext) { return EXT_ICON[String(ext || '').toLowerCase()] || 'file'; }
