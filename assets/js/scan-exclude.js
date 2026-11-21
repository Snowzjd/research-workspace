/* 材料浅扫描的排除名单。默认只排除知识库引擎相关目录名。
   具体课题名不要写进源码；需要时由 settings.materialScanExclude 配置。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScanExclude = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_PATTERNS = Object.freeze([
    'rag[_-]?snowz',
    'RAG引擎',
    '知识库引擎'
  ]);

  function listPatterns(settings) {
    const raw = settings && settings.materialScanExclude;
    if (Array.isArray(raw)) {
      return raw.map(String).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return DEFAULT_PATTERNS.slice();
  }

  function isExcluded(name, settings) {
    const text = String(name || '');
    if (!text) return false;
    const patterns = listPatterns(settings);
    for (let i = 0; i < patterns.length; i++) {
      const pat = patterns[i];
      try {
        if (new RegExp(pat, 'i').test(text)) return true;
      } catch (_) {
        if (text.toLowerCase() === String(pat).toLowerCase()) return true;
      }
    }
    return false;
  }

  return {
    DEFAULT_PATTERNS: DEFAULT_PATTERNS,
    listPatterns: listPatterns,
    isExcluded: isExcluded
  };
});
