/* ==========================================================================
   账户界面
   - 账户门：首次注册 / 启动解锁（全屏，只在桌面端出现）
   - 云端绑定：载体卡片 + 凭证表单（账户门第 2 步与设置页共用同一套）
   交互事件统一在 actions.js 里处理，这里只负责结构与局部刷新
   ========================================================================== */

/* ---------- 状态 ---------- */
function authSt() {
  if (!state.auth) {
    state.auth = {
      ready: false,
      status: null,
      step: 'register',          /* register | bind | unlock */
      bind: { carrier: 'webdav', busy: false, error: '', okMsg: '' }
    };
  }
  if (!state.auth.bind) state.auth.bind = { carrier: 'webdav', busy: false, error: '', okMsg: '' };
  return state.auth;
}

const AUTH_PROVIDER_ICON = {
  webdav: 'database',
  folder: 'folderOpen',
  onedrive: 'globe',
  dropbox: 'globe'
};

/* ==========================================================================
   载体卡片
   ========================================================================== */
function carrierCardsHTML(activeId, { compact } = {}) {
  const list = (authSt().status && authSt().status.providers) || [];
  if (!list.length) return '';
  return `<div class="carrier-grid">
    ${list.map(p => {
      const planned = p.status === 'planned';
      return `<button class="carrier-card ${p.id === activeId ? 'active' : ''} ${planned ? 'disabled' : ''}"
        data-act="${planned ? 'noop' : 'carrier-pick'}" data-id="${esc(p.id)}" ${planned ? 'title="还没接入"' : ''}>
        <span class="carrier-ico">${icon(AUTH_PROVIDER_ICON[p.id] || 'database', 'width:14px;height:14px')}</span>
        <span class="carrier-body">
          <span class="carrier-t">${esc(p.name)}
            ${p.recommended ? '<span class="chip emerald" style="font-size:9px;padding:1px 5px">推荐</span>' : ''}
            ${planned ? '<span class="chip gray" style="font-size:9px;padding:1px 5px">未接入</span>' : ''}
          </span>
          ${compact ? '' : `<span class="carrier-d" style="display:block">${esc(p.desc)}</span>`}
        </span>
      </button>`;
    }).join('')}
  </div>`;
}

/* 选中载体后要填的字段 */
function carrierFormHTML(carrier, cur = {}) {
  const st = authSt().status || {};
  const prov = (st.providers || []).find(p => p.id === carrier) || {};

  if (carrier === 'webdav') {
    const preset = prov.preset || {};
    return `<div class="field">
        <label>服务器地址</label>
        <input class="input" data-role="bind-url" value="${esc(cur.url || preset.url || '')}" placeholder="https://dav.jianguoyun.com/dav/">
        <div class="field-hint">坚果云固定是这个地址；用 Nextcloud / 群晖时换成你自己的 WebDAV 地址</div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>账号</label>
          <input class="input" data-role="bind-user" value="${esc(cur.user || '')}" placeholder="坚果云注册邮箱" autocomplete="off">
        </div>
        <div class="field">
          <label>应用密码</label>
          <input class="input" type="password" data-role="bind-pass" value="${esc(cur.pass || '')}" placeholder="不是登录密码" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label>云端目录</label>
        <input class="input" data-role="bind-dir" value="${esc(cur.dir || preset.dir || '/ResearchWorkspace')}" placeholder="/ResearchWorkspace">
        <div class="field-hint">数据都写在这个目录里，不会和网盘里的其它文件混在一起。不存在会自动创建</div>
      </div>
      <div class="auth-tip">${icon('alert', 'width:12px;height:12px;flex:none;margin-top:1px')}
        <span><b>要用「应用密码」，不是登录密码。</b><br>
        坚果云网页版 → 右上角账号名 → 账户信息 → 安全选项 → 第三方应用管理 → 添加应用密码。
        <a href="https://www.jianguoyun.com/" target="_blank" rel="noopener">打开坚果云</a></span>
      </div>`;
  }

  if (carrier === 'folder') {
    return `<div class="field">
        <label>本地目录</label>
        <div class="row" style="gap:6px">
          <input class="input" data-role="bind-dir" value="${esc(cur.dir || '')}" placeholder="选一个空文件夹，或局域网共享盘路径" readonly style="flex:1">
          <button class="btn sm" data-act="bind-pick-dir">${icon('folderOpen')}选择</button>
        </div>
        <div class="field-hint">可以是局域网共享：<span class="mono">\\\\另一台电脑\\共享目录</span>。两台设备要选同一个目录</div>
      </div>`;
  }

  return `<div class="auth-tip">${icon('alert', 'width:12px;height:12px;flex:none;margin-top:1px')}
    <span>${esc(prov.desc || '这个载体还没接入')}<br>
    现在可以选「本地或局域网目录」，把本机 OneDrive / Dropbox 的文件夹指过去，效果一样。</span></div>`;
}

/* 绑定表单（账户门第 2 步与设置页向导共用） */
function bindFormHTML() {
  const b = authSt().bind;
  return `<div id="bind-body">
    <div class="auth-sub" style="margin-bottom:10px">数据会写到云端的一个目录里。选一个地方：</div>
    ${carrierCardsHTML(b.carrier)}
    <div style="margin-top:12px" id="bind-form">${carrierFormHTML(b.carrier)}</div>
    <div class="auth-err ${b.error ? 'show' : ''}" id="bind-err">${esc(b.error || '')}</div>
    ${b.okMsg ? `<div class="auth-tip" style="background:var(--green-bg);color:var(--green)">${icon('check', 'width:12px;height:12px;flex:none')}<span>${esc(b.okMsg)}</span></div>` : ''}
  </div>`;
}

/* 只换表单区，不动已选中的载体卡片 */
function refreshBindForm() {
  const b = authSt().bind;
  const box = document.getElementById('bind-form');
  if (box) box.innerHTML = carrierFormHTML(b.carrier);
  document.querySelectorAll('.carrier-card[data-act="carrier-pick"], .carrier-card[data-act="noop"]').forEach(el => {
    el.classList.toggle('active', el.dataset.id === b.carrier);
  });
}

function setBindError(msg) {
  const b = authSt().bind;
  b.error = msg || '';
  const el = document.getElementById('bind-err');
  if (el) {
    el.textContent = b.error;
    el.classList.toggle('show', !!b.error);
  }
}

/* 从绑定表单里读值（gate 与 modal 都用 data-role，互不冲突） */
function readBindForm(root) {
  const scope = root || document;
  const val = sel => {
    const el = scope.querySelector(sel);
    return el ? String(el.value || '').trim() : '';
  };
  return {
    kind: authSt().bind.carrier,
    url: val('[data-role="bind-url"]'),
    user: val('[data-role="bind-user"]'),
    pass: val('[data-role="bind-pass"]'),
    dir: val('[data-role="bind-dir"]')
  };
}

/* ==========================================================================
   账户门
   ========================================================================== */
function authMaskNeeded() {
  if (!Bridge.desktop) return false;        /* 浏览器降级模式不拦 */
  const st = authSt();
  if (!st.status) return false;
  if (st.status.locked) return true;        /* 有密码，等解锁 */
  if (!st.status.hasAccount) return true;   /* 还没注册 */
  if (st.step === 'bind') return true;      /* 刚注册完：继续走绑定云端这一步 */
  return false;
}

function registerGateHTML() {
  return `<div class="auth-mask" id="auth-mask">
    <div class="auth-card">
      <div class="auth-brand">
        <span class="mark">${icon('flask', 'width:16px;height:16px')}</span>
        <div><h1>个人科研工作台</h1><p>Research OS</p></div>
      </div>
      <div class="auth-steps"><i class="on"></i><i></i></div>
      <div class="auth-title">建立你的工作台身份</div>
      <div class="auth-sub">数据只存在这台电脑上。身份会跟着数据同步到其它设备，
        用来认出「这是同一个工作台」——这也是后面绑定云端时唯一要认的 id。</div>

      <div class="field">
        <label>你的名字</label>
        <input class="input" data-role="reg-name" maxlength="24" placeholder="比如 张三" autocomplete="off">
      </div>
      <div class="field">
        <label>本机解锁密码<span style="color:var(--text-4);font-weight:400">（可选）</span></label>
        <input class="input" type="password" data-role="reg-pass" placeholder="留空就直接进入" autocomplete="new-password">
        <div class="field-hint">只是这台电脑的门锁，防止别人随手打开。忘了可以清除，数据不会丢。</div>
      </div>

      <div class="auth-err" id="auth-err"></div>
      <button class="btn primary" data-act="auth-register" style="width:100%;margin-top:16px">进入工作台</button>
      <div class="auth-foot">下一步会让你选择数据存到哪个云端（坚果云 / 本地目录），也可以先跳过。</div>
    </div>
  </div>`;
}

function bindGateHTML() {
  const st = authSt().status || {};
  return `<div class="auth-mask" id="auth-mask">
    <div class="auth-card">
      <div class="auth-brand">
        <span class="mark">${icon('flask', 'width:16px;height:16px')}</span>
        <div><h1>个人科研工作台</h1><p>Research OS</p></div>
      </div>
      <div class="auth-steps"><i class="on"></i><i class="on"></i></div>
      <div class="auth-title">数据放在哪？</div>
      <div class="auth-sub">${esc((st.account && st.account.name) || '')}，选一个云端，多台设备就能对上同一份数据。
        这一步可以跳过，之后在「设置 → 账户」里随时能绑。</div>

      ${bindFormHTML()}

      <div class="row" style="gap:8px;margin-top:16px">
        <button class="btn" data-act="auth-skip" style="flex:none">稍后再说</button>
        <button class="btn primary" data-act="bind-test" data-where="gate" style="flex:1">测试并绑定</button>
      </div>
      <div class="auth-foot">换云端、解绑都在「设置 → 账户」里，随时可以改。</div>
    </div>
  </div>`;
}

function unlockGateHTML() {
  const st = authSt().status || {};
  const name = (st.account && st.account.name) || '工作台';
  const initial = name.slice(0, 1).toUpperCase();
  return `<div class="auth-mask" id="auth-mask">
    <div class="auth-card" style="text-align:center">
      <div class="auth-avatar">${esc(initial)}</div>
      <div class="auth-title">${esc(name)}的工作台</div>
      <div class="auth-sub">输入本机密码继续</div>
      <input class="input" type="password" data-role="unlock-pass" placeholder="本机密码"
        style="text-align:center" autocomplete="current-password">
      <div class="auth-err" id="auth-err"></div>
      <button class="btn primary" data-act="auth-unlock" style="width:100%;margin-top:14px">解锁</button>
      <div class="auth-foot">忘了密码？<a data-act="auth-forgot">清除本机授权</a> —— 只是重设密码，数据不动。</div>
    </div>
  </div>`;
}

/* 全量重绘账户门。
   render() 每次都会调到这里，所以必须按「签名」判断：同一个步骤不重建，
   否则用户正在输入的名字/密码会在任何一次重绘时被清掉。 */
function renderAuthGate() {
  const old = document.getElementById('auth-gate');
  if (!authMaskNeeded()) {
    if (old) old.remove();
    document.body.classList.remove('auth-on');
    return;
  }
  const st = authSt();
  const kind = st.status.locked ? 'unlock' : (st.step === 'bind' ? 'bind' : 'register');
  if (old && old.dataset.kind === kind) return;

  const html = kind === 'unlock' ? unlockGateHTML()
    : (kind === 'bind' ? bindGateHTML() : registerGateHTML());

  if (old) old.remove();
  const host = document.createElement('div');
  host.id = 'auth-gate';
  host.dataset.kind = kind;
  host.innerHTML = html;
  document.body.appendChild(host);
  document.body.classList.add('auth-on');
  bindAuthEnter();

  /* 注册页自动聚焦，少一次点击 */
  const first = host.querySelector('[data-role="reg-name"], [data-role="unlock-pass"]');
  if (first) setTimeout(() => { try { first.focus(); } catch (_) {} }, 60);
}

function setAuthError(msg) {
  const el = document.getElementById('auth-err');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
}

/* 解锁页回车即提交 */
function bindAuthEnter() {
  const host = document.getElementById('auth-gate');
  if (!host) return;
  host.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    e.preventDefault();
    if (t.dataset.role === 'unlock-pass') {
      document.querySelector('[data-act="auth-unlock"]')?.click();
    } else if (t.dataset.role === 'reg-name' || t.dataset.role === 'reg-pass') {
      document.querySelector('[data-act="auth-register"]')?.click();
    }
  });
}

/* ==========================================================================
   设置页的绑定向导
   ========================================================================== */
function openBindWizard() {
  const b = authSt().bind;
  b.error = '';
  b.okMsg = '';
  if (!b.carrier) b.carrier = 'webdav';

  openModal({
    title: '绑定云端',
    sub: '一个工作台同时只绑一个云端，随时可以换',
    body: bindFormHTML(),
    footer: `<button class="btn" data-act="modal-close">取消</button>
      <span class="grow"></span>
      <button class="btn primary" data-act="bind-test" data-where="wizard">测试并绑定</button>`,
    onMount(modal) {
      if (typeof bindAuthEnter === 'function') {
        /* 向导里回车也提交 */
        modal.addEventListener('keydown', e => {
          if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
            e.preventDefault();
            modal.querySelector('[data-act="bind-test"]')?.click();
          }
        });
      }
    }
  });
}

/* ==========================================================================
   设置页「账户」内容
   ========================================================================== */
function accountRows() {
  const st = authSt().status || {};
  const acc = st.account || {};
  const c = st.cloud;

  const bindCtl = c
    ? `<div class="bind-line">
        <span class="bind-dot"></span>
        <span class="set-path" style="max-width:150px" title="${esc(c.dir || c.url || '')}">${esc(c.providerName)}${c.user ? ' · ' + esc(c.user) : ''}</span>
        <button class="btn sm" data-act="account-bind">${icon('refresh')}更换</button>
        <button class="btn sm danger" data-act="account-unbind" title="解绑">${icon('x')}</button>
      </div>`
    : `<div class="bind-line">
        <span class="bind-dot off"></span>
        <span class="chip gray">未绑定</span>
        <button class="btn sm primary" data-act="account-bind">${icon('plus')}绑定云端</button>
      </div>`;

  const passCtl = st.hasPass
    ? `<div class="bind-line"><span class="chip emerald">已设置</span>
        <button class="btn sm" data-act="account-lock">${icon('shield')}立即锁定</button>
        <button class="btn sm danger" data-act="account-clearpass" title="取消密码">${icon('x')}</button></div>`
    : `<div class="bind-line"><span class="chip gray">未设置</span>
        <button class="btn sm" data-act="account-setpass">${icon('shield')}设置密码</button></div>`;

  const syncCtl = (() => {
    if (!c) return `<span class="chip gray">未绑定云端</span>`;
    const at = state.sync && state.sync.lastSyncAt ? new Date(state.sync.lastSyncAt) : null;
    const p2 = n => String(n).padStart(2, '0');
    const when = at ? `${p2(at.getMonth() + 1)}-${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}` : '还没同步过';
    const n = ((state.sync && state.sync.peers) || []).length;
    return `<div class="bind-line">
      <span class="chip ${at ? 'emerald' : 'amber'}">${esc(when)}</span>
      <span class="muted" style="font-size:10px">${n ? n + ' 台其它设备' : '暂无其它设备'}</span>
      <button class="btn sm primary" data-act="sync-now">${icon('refresh')}立即同步</button>
    </div>`;
  })();

  const secretWarn = (c && c.secretMode === 'plain')
    ? `<div class="auth-tip" style="margin-top:6px">${icon('alert', 'width:12px;height:12px;flex:none;margin-top:1px')}
        <span>系统未提供加密存储，云端凭证以明文保存在本机配置里。介意的话改用「本地目录」载体。</span></div>`
    : '';

  return [
    ['工作台身份', '身份存在数据里，跟着同步走；其它设备据此认出是同一个工作台', (() => {
      if (!acc.id) return `<span class="chip gray">还没有身份</span>`;
      const short = acc.id.length > 10 ? acc.id.slice(0, 10) : acc.id;
      return `<div class="bind-line">
        <span class="chip violet mono" title="${esc(acc.id)}">${esc(short)}</span>
        <b style="font-size:11.5px">${esc(acc.name || '')}</b>
        <button class="btn sm ghost" data-act="account-rename">${icon('pencil')}改名</button>
      </div>`;
    })()],
    ['本机解锁密码', '只是这台电脑的门锁，不是磁盘加密；字段散列存本机，不进数据文件', passCtl],
    ['云端绑定', '一个工作台同时只绑一个；换绑只影响之后的同步，云端旧数据不会被动删', bindCtl],
    ['云同步', '把本机数据发布到云端，并拉取其它设备的改动做三方合并', syncCtl],
    ['云端凭证存储', '应用密码用系统加密（Windows DPAPI）保存在本机', (() => {
      const m = (c && c.secretMode) || st.secretMode || 'none';
      const text = m === 'os' ? '系统加密' : (m === 'plain' ? '明文（系统加密不可用）' : '未保存凭证');
      return `<span class="chip ${m === 'os' ? 'emerald' : (m === 'plain' ? 'amber' : 'gray')}">${esc(text)}</span>${secretWarn}`;
    })()],
    ['清除本机授权', '解绑云端 + 删掉本机密码，回到未登录状态。身份和项目数据都不动', (() => {
      const any = st.binding || st.hasPass;
      return `<button class="btn sm danger" data-act="account-reset" ${any ? '' : 'disabled'}>${icon('trash')}清除</button>`;
    })()]
  ];
}
