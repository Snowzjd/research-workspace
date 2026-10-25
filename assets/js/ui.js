/* ==========================================================================
   UI 基础组件：轻提示 / 模态弹窗 / 表单
   ========================================================================== */

/* ---------- 轻提示 ---------- */
function toast(msg, kind) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const colors = { brand: '#E0668E', ok: '#5BD6A0', err: '#FB8A8E', sky: '#6EA8FE', amber: '#F0B357' };
  const k = kind === 'emerald' ? 'ok' : kind === 'amber' ? 'amber' : kind === 'sky' ? 'sky' : kind === 'err' ? 'err' : 'brand';
  const el = document.createElement('div');
  el.className = 'toast fade-in' + (k === 'err' ? ' err' : k === 'ok' ? ' ok' : '');
  el.innerHTML = `<span class="t-dot" style="background:${colors[k]}"></span><span>${msg}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(16px)'; }, 2600);
  setTimeout(() => el.remove(), 3100);
}

/* ---------- 模态弹窗 ---------- */
let _escHandler = null;

function openModal(opts) {
  closeModal();
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="grow">
          <h3>${opts.title || ''}</h3>
          ${opts.sub ? `<div class="modal-sub">${opts.sub}</div>` : ''}
        </div>
        <button class="modal-close" data-act="modal-close" aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="modal-body">${opts.body || ''}</div>
      ${opts.footer !== undefined ? `<div class="modal-foot">${opts.footer || ''}</div>` : ''}
    </div>`;
  document.body.appendChild(mask);

  mask.addEventListener('mousedown', e => { if (e.target === mask) closeModal(); });
  mask.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.tagName === 'INPUT')) {
      const primary = mask.querySelector('[data-submit]');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  });

  _escHandler = e => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', _escHandler);

  const modal = mask.querySelector('.modal');
  const focusable = modal.querySelector('input:not([type=hidden]), textarea, select');
  if (focusable) setTimeout(() => focusable.focus(), 40);
  if (opts.onMount) opts.onMount(modal);
  return modal;
}

function closeModal() {
  document.querySelectorAll('.modal-mask').forEach(m => m.remove());
  if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
}

/* ---------- 确认框 ---------- */
function confirmDialog({ title, message, okText = '确定', danger = false, onOk, extra = '' }) {
  openModal({
    title,
    body: `<p style="font-size:12px;color:var(--text-2);line-height:1.7">${message}</p>${extra}`,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-act="modal-confirm">${okText}</button>`,
    onMount(modal) {
      modal.querySelector('[data-act="modal-confirm"]').addEventListener('click', () => {
        /* 先把附加选项读出来，closeModal 之后 DOM 就没了 */
        const checks = {};
        modal.querySelectorAll('input[type="checkbox"][name]').forEach(i => { checks[i.name] = i.checked; });
        closeModal();
        onOk && onOk(checks);
      });
    }
  });
}

/* ---------- 表单字段 ---------- */
function fText(name, label, value, opts = {}) {
  return `<div class="field" data-field="${name}">
    <label>${label}${opts.req ? '<span class="req">*</span>' : ''}</label>
    <input class="input" name="${name}" value="${esc(value || '')}" placeholder="${esc(opts.ph || '')}" ${opts.list ? `list="${opts.list}"` : ''}>
    ${opts.hint ? `<div class="field-hint">${opts.hint}</div>` : ''}
    <div class="field-err">${opts.err || '该项为必填'}</div>
  </div>`;
}
function fArea(name, label, value, opts = {}) {
  return `<div class="field" data-field="${name}">
    <label>${label}${opts.req ? '<span class="req">*</span>' : ''}</label>
    <textarea class="input" name="${name}" rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(value || '')}</textarea>
    ${opts.hint ? `<div class="field-hint">${opts.hint}</div>` : ''}
    <div class="field-err">${opts.err || '该项为必填'}</div>
  </div>`;
}
function fSelect(name, label, value, items, opts = {}) {
  return `<div class="field" data-field="${name}">
    <label>${label}</label>
    <select class="select" name="${name}">
      ${items.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}
    </select>
    ${opts.hint ? `<div class="field-hint">${opts.hint}</div>` : ''}
  </div>`;
}
function fSeg(name, label, value, items, opts = {}) {
  return `<div class="field" data-field="${name}">
    <label>${label}</label>
    <div class="seg" data-seg="${name}">
      ${items.map(([v, l]) => `<button type="button" data-val="${esc(v)}" class="${String(v) === String(value) ? 'active' : ''}">${esc(l)}</button>`).join('')}
    </div>
    ${opts.hint ? `<div class="field-hint">${opts.hint}</div>` : ''}
  </div>`;
}
function fCheckbox(name, label, checked, opts = {}) {
  return `<div class="field" data-field="${name}">
    <label class="check-line"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}> <span>${label}</span></label>
    ${opts.hint ? `<div class="field-hint">${opts.hint}</div>` : ''}
  </div>`;
}

function fStatic(label, html, hint) {
  return `<div class="field">
    <label>${label}</label>${html}
    ${hint ? `<div class="field-hint">${hint}</div>` : ''}
  </div>`;
}

/* 读取表单值 */
function formValues(root) {
  const out = {};
  root.querySelectorAll('.field[data-field]').forEach(f => {
    const key = f.dataset.field;
    const input = f.querySelector('[name]');
    if (input) { out[key] = input.value.trim(); return; }
    const seg = f.querySelector('.seg');
    if (seg) out[key] = (seg.querySelector('.active') || {}).dataset ? seg.querySelector('.active').dataset.val : '';
  });
  return out;
}

/* 校验必填 */
function validate(root, required) {
  let ok = true;
  required.forEach(name => {
    const f = root.querySelector(`.field[data-field="${name}"]`);
    if (!f) return;
    const input = f.querySelector('[name]');
    const v = input ? input.value.trim() : '';
    const bad = !v;
    f.classList.toggle('invalid', bad);
    if (bad) ok = false;
  });
  return ok;
}
