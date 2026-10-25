/* ==========================================================================
   Agent 员工派单（Grok Bot 式）
   - Agent 在「AI 助手 · 派任务」里管理；AI 助手是派活、看进度、看产出的界面
   - 每个 Agent 是一名员工，可单独派任务、跟踪执行步骤与产出
   - 执行沿用同一套 AI 接入与工具，但每个任务独立会话，不占用 AI 助手主对话
   ========================================================================== */

const AGENT_JOB_ROUNDS = 6;

/* ---------- 数据访问 ---------- */
function jobsAll() {
  if (!Array.isArray(DB.agentJobs)) DB.agentJobs = [];
  return DB.agentJobs;
}
function jobsOf(name) {
  return jobsAll().filter(j => j.agent === name).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function jobById(id) {
  return jobsAll().find(j => j.id === id) || null;
}
function jobRunning(name) {
  return jobsAll().find(j => j.agent === name && j.status === 'running') || null;
}
function agentStaffStats(name) {
  const list = jobsOf(name);
  return {
    total: list.length,
    running: list.filter(j => j.status === 'running').length,
    done: list.filter(j => j.status === 'done').length,
    failed: list.filter(j => j.status === 'failed').length,
    last: list[0] || null
  };
}

const JOB_STATUS_TEXT = { queued: '排队中', running: '执行中', done: '已完成', failed: '失败', canceled: '已取消' };
const JOB_STATUS_CHIP = { queued: 'gray', running: 'accent', done: 'green', failed: 'red', canceled: 'gray' };

/* ---------- 派单 ---------- */
function createAgentJob({ agent, task, projectId }) {
  const job = {
    id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    agent,
    task: String(task || '').trim(),
    projectId: projectId || state.project || '',
    status: 'queued',
    createdAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    result: '',
    error: '',
    steps: []
  };
  jobsAll().unshift(job);
  if (jobsAll().length > 100) jobsAll().splice(100);
  return job;
}

/* ---------- 执行引擎（每个 Agent 串行，全局一条队列） ---------- */
async function runAgentJob(jobId) {
  const job = jobById(jobId);
  if (!job || job.status === 'running') return;

  const agent = A(job.agent);
  const p = P(job.projectId) || DB.projects[0];
  if (!agent) {
    job.status = 'failed'; job.error = '这个 Agent 已被删除'; job.finishedAt = Date.now();
    persist(); render(); return;
  }
  if (!p) {
    job.status = 'failed'; job.error = '没有项目可供执行（Agent 需要项目上下文）'; job.finishedAt = Date.now();
    persist(); render(); return;
  }

  job.status = 'running';
  job.startedAt = Date.now();
  job.finishedAt = 0;
  job.result = '';
  job.error = '';
  job.steps = [];
  agent.status = 'running';
  persist();
  render();

  const cfg = {
    provider: DB.ai.provider,
    baseUrl: DB.ai.baseUrl,
    model: DB.ai.model,
    temperature: DB.ai.temperature,
    maxTokens: DB.ai.maxTokens
  };
  const messages = [
    { role: 'system', content: buildAgentSystemPrompt(p, agent) },
    { role: 'user', content: job.task }
  ];

  try {
    for (let round = 1; round <= AGENT_JOB_ROUNDS; round++) {
      const r = await Bridge.aiChat({ ...cfg, messages, tools: AI_TOOLS });
      if (!r || !r.ok) {
        job.status = 'failed';
        job.error = (r && r.error) || 'AI 调用失败';
        break;
      }

      const calls = (r.toolCalls || []).map(tc => {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
        if (!args || typeof args !== 'object') args = {};
        return {
          id: tc.id || ('call_' + Math.random().toString(36).slice(2, 10)),
          name: tc.function.name,
          args,
          label: describeToolCall(tc.function.name, args)
        };
      });

      const asst = { role: 'assistant', content: r.content || '' };
      if (calls.length) {
        asst.tool_calls = calls.map(c => ({
          id: c.id, type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) }
        }));
      }
      messages.push(asst);

      if (!calls.length) {
        job.status = 'done';
        job.result = r.content || '（模型没有返回文字内容）';
        break;
      }

      for (const c of calls) {
        job.steps.push({ label: c.label, ok: null });
        persist(); render();
        const res = await runTool(c);
        job.steps[job.steps.length - 1] = { label: c.label, ok: !(res && res.ok === false) };
        messages.push({
          role: 'tool',
          tool_call_id: c.id,
          content: JSON.stringify(res == null ? { ok: false, error: '工具无返回' } : res)
        });
        persist(); render();
      }

      if (round === AGENT_JOB_ROUNDS) {
        job.status = 'failed';
        job.error = `达到 ${AGENT_JOB_ROUNDS} 轮工具调用上限，任务没有收敛。建议拆细后再派一次。`;
      }
    }
  } catch (err) {
    job.status = 'failed';
    job.error = '执行出错：' + String((err && err.message) || err);
  } finally {
    job.finishedAt = Date.now();
    const a2 = A(job.agent);
    if (a2) {
      a2.stats = Array.isArray(a2.stats) ? a2.stats : [0, 0, 0];
      if (job.status === 'done') a2.stats[0] = (a2.stats[0] || 0) + 1;
      a2.status = 'idle';
      a2.lastRunAt = job.finishedAt;
    }
    logActivity(
      `<b>${esc(job.agent)}</b> ${job.status === 'done' ? '完成' : '未完成'}任务：${esc(String(job.task).slice(0, 30))}`,
      'agent',
      job.status === 'done' ? '#218358' : '#AD5700'
    );
    persist();
    render();

    /* 队列：还有排队的就接着跑下一单 */
    const next = jobsAll().filter(j => j.status === 'queued').pop();
    if (next) setTimeout(() => runAgentJob(next.id), 200);
  }
}

/* 员工执行用的系统提示：工作台总则 + 该 Agent 的职责与人设 */
function buildAgentSystemPrompt(p, agent) {
  const tags = (agent.tags || []).filter(Boolean).join('、');
  return [
    '你是「个人 AI 科研工程工作台」里的一名科研 Agent，正在执行用户派给你的一个具体任务。',
    `当前项目「${p.name}」（项目 ID：${p.id}）。`,
    '',
    '你可以调用工具读取并修改项目数据，修改会立即写入本地数据文件并在界面上生效。',
    '工作准则：',
    '1. 涉及项目现状时先调用 get_project_context 等查询工具，不要凭猜测。',
    '2. 需要改数据就直接调用工具完成，不要只给建议让用户自己做。',
    '3. 完成后用简洁中文说明「做了什么、结果如何」，不要罗列原始 JSON。',
    '4. 查不到或做不到就如实说明，不要编造。',
    '',
    `【你的身份】${agent.name}`,
    `职责：${agent.role || '（未填写）'}`,
    tags ? `擅长：${tags}` : '',
    agent.prompt ? `\n【专属工作规范】\n${agent.prompt}` : ''
  ].filter(Boolean).join('\n');
}

/* ---------- 界面：员工面板（AI 助手右侧） ---------- */
function staffPanelHTML() {
  const agents = DB.agents || [];
  const active = jobsAll().filter(j => j.status === 'running' || j.status === 'queued');
  const recent = jobsAll().slice(0, 6);

  if (!agents.length) {
    return `<div class="card panel">
      <div class="panel-head"><h3>${icon('bot')}员工</h3><span class="head-sub">0 人</span></div>
      <div class="staff-empty">
        <p>还没有员工。新建一个 Agent，它就会出现在这里，可以单独派活。</p>
        <button class="btn sm primary" data-act="new-agent">${icon('plus')}新建 Agent</button>
      </div>
    </div>`;
  }

  const rows = agents.map(a => {
    const running = jobRunning(a.name);
    const st = agentStaffStats(a.name);
    const sub = running
      ? `<span class="staff-running">执行中：${esc(String(running.task).slice(0, 24))}</span>`
      : (st.last
        ? `上次${JOB_STATUS_TEXT[st.last.status] || ''} · ${esc(String(st.last.task).slice(0, 18))}`
        : '空闲');
    return `<div class="staff-row">
      ${agentTile(a.name, 30)}
      <div class="grow" style="min-width:0">
        <div class="staff-name">${esc(a.name)}</div>
        <div class="staff-sub">${sub}</div>
      </div>
      <button class="btn sm" data-act="agent-edit" data-a="${esc(a.name)}" title="编辑职责、标签和提示词">编辑</button>
      <button class="btn sm ${running ? '' : 'primary'}" data-act="staff-assign" data-a="${esc(a.name)}"
        ${running ? 'disabled' : ''}>${running ? '忙碌' : '派单'}</button>
    </div>`;
  }).join('');

  const recentRows = recent.length
    ? recent.map(j => `<div class="job-row" data-act="job-view" data-id="${j.id}">
        <span class="job-dot ${esc(JOB_STATUS_CHIP[j.status] || 'gray')}"></span>
        <div class="grow" style="min-width:0">
          <div class="job-task">${esc(String(j.task).slice(0, 32))}</div>
          <div class="job-meta">${esc(j.agent)} · ${JOB_STATUS_TEXT[j.status] || j.status}${j.steps && j.steps.length ? ' · ' + j.steps.length + ' 步' : ''}</div>
        </div>
      </div>`).join('')
    : '<div class="staff-empty-mini">还没有派过任务</div>';

  return `<div class="card panel">
    <div class="panel-head">
      <h3>${icon('bot')}员工</h3>
      <span class="head-sub">${agents.length} 人${active.length ? ` · ${active.length} 个在跑` : ''}</span>
      <span class="grow"></span>
      <button class="btn sm" data-act="goto-agents" title="管理员工">${icon('settings')}</button>
    </div>
    <div class="staff-list">${rows}</div>
    <div class="panel-head" style="padding:8px 12px 2px"><h3 style="font-size:11px">${icon('clock')}最近任务</h3></div>
    <div class="job-list">${recentRows}</div>
  </div>`;
}

/* ---------- 派单弹窗 ---------- */
function openStaffAssign(agentName) {
  const agent = A(agentName);
  if (!agent) return toast('这个 Agent 已被删除', 'err');
  if (!Bridge.desktop) return toast('派单需要桌面端运行（要调用 AI）', 'err');
  if (!DB.projects.length) return toast('先新建一个项目 —— Agent 需要项目上下文才能干活', 'err');
  if (!(state.aiKey && state.aiKey.stored)) return toast('还没有配置 AI 密钥，先到 AI 助手页或设置里配置接入', 'err');

  const projOpts = DB.projects.map(p =>
    `<option value="${p.id}"${p.id === (state.project || '') ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  const quick = (agent.tags || []).slice(0, 4);

  openModal({
    title: `给 ${agentName} 派任务`,
    sub: `${agent.role || '未填写职责'} · 与 AI 助手共用同一接入配置`,
    body: `<div class="field"><label>所属项目</label>
        <select class="select" name="project">${projOpts}</select></div>
      <div class="field"><label>任务内容</label>
        <textarea class="textarea" name="task" rows="5" placeholder="要它具体做什么？例如：基于项目里的仿真结果，写出论文方法章节初稿约 800 字，用纯文本全角标点">${esc(agent.task || '')}</textarea>
        ${quick.length ? `<div class="field-hint">它擅长：${quick.map(t => esc(t)).join('、')}</div>` : ''}
      </div>
      <div class="set-pending-note">${icon('alert')}派发后立刻开始执行，最多 ${AGENT_JOB_ROUNDS} 轮工具调用；可以关掉弹窗，进度在员工面板里看。</div>`,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-submit data-act="staff-dispatch" data-a="${esc(agentName)}">派发并执行</button>`
  });
}

/* ---------- 任务详情 ---------- */
function openJobView(jobId) {
  const job = jobById(jobId);
  if (!job) return toast('任务记录不存在', 'err');
  const p2 = n => String(n).padStart(2, '0');
  const fmt = t => {
    if (!t) return '—';
    const d = new Date(t);
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  const dur = (job.startedAt && job.finishedAt)
    ? `${Math.max(1, Math.round((job.finishedAt - job.startedAt) / 1000))} 秒`
    : (job.status === 'running' ? '进行中…' : '—');
  const proj = P(job.projectId);

  const steps = (job.steps || []).length
    ? `<div class="job-steps">${job.steps.map((s, i) =>
        `<div class="job-step"><span class="job-step-i">${i + 1}</span>
          <span class="grow">${esc(s.label)}</span>
          <span class="chip ${s.ok === null ? 'gray' : (s.ok ? 'green' : 'red')}">${s.ok === null ? '…' : (s.ok ? '完成' : '失败')}</span>
        </div>`).join('')}</div>`
    : '<div class="staff-empty-mini">没有调用工具</div>';

  openModal({
    title: `任务详情 · ${job.agent}`,
    sub: `${JOB_STATUS_TEXT[job.status] || job.status} · ${dur}${proj ? ' · ' + esc(proj.name) : ''}`,
    body: `<div class="job-detail-task">${esc(job.task)}</div>
      <div class="field-hint" style="margin:6px 0 10px">派发 ${fmt(job.createdAt)} · 开始 ${fmt(job.startedAt)} · 结束 ${fmt(job.finishedAt)}</div>
      ${job.error ? `<div class="staff-empty-mini" style="color:var(--danger)">${esc(job.error)}</div>` : ''}
      <div class="panel-head" style="padding:6px 0 4px"><h3 style="font-size:11px">执行步骤</h3><span class="head-sub">${(job.steps || []).length}</span></div>
      ${steps}
      ${job.result ? `<div class="panel-head" style="padding:10px 0 4px"><h3 style="font-size:11px">产出</h3></div>
        <div class="job-result">${renderRich(job.result)}</div>` : ''}`,
    footer: `<span class="grow"></span>
      ${job.status === 'done' || job.status === 'failed'
        ? `<button class="btn" data-act="job-retry" data-id="${job.id}">${icon('refresh')}再派一次</button>`
        : ''}
      <button class="btn primary" data-act="modal-close">关闭</button>`
  });
}

/* ---------- 派任务台（AI 助手「派任务」模式整页视图） ---------- */
function aiAssignView() {
  const agents = DB.agents || [];
  const p = P(state.project) || DB.projects[0];
  const pending = jobsAll().filter(j => j.status === 'running' || j.status === 'queued').length;

  return `<div class="fade-in">
    <div class="page-head">
      <h2>派任务</h2>
      <span class="page-sub">${agents.length} 名员工${pending ? ` · ${pending} 个在跑` : ''} · 与聊天共用同一接入配置</span>
      <span class="ph-right">
        ${aiModeSeg('assign')}
        <button class="btn sm" data-act="new-agent">${icon('plus')}新建 Agent</button>
        <button class="btn sm" data-act="goto-agents">${icon('settings')}管理员工</button>
      </span>
    </div>

    ${!agents.length ? emptyState({
      icon: 'bot',
      title: '还没有员工',
      sub: '新建一个 Agent，它就会出现在这里，可以单独派活。和聊天共用同一套接入配置。',
      primary: { act: 'new-agent', label: '新建第一个 Agent', ico: 'plus' },
      secondary: { act: 'ai-mode', label: '回到聊天', ico: 'sparkles', data: { v: 'chat' } }
    }) : `<div class="staff-board">
      ${agents.map(a => {
        const running = jobRunning(a.name);
        const st = agentStaffStats(a.name);
        const recent = jobsOf(a.name).slice(0, 3);
        return `<div class="card staff-card">
          <div class="staff-card-head">
            ${agentTile(a.name, 36)}
            <div class="grow" style="min-width:0">
              <div class="staff-card-name">${esc(a.name)}</div>
              <div class="staff-card-role">${esc(a.role || '未填写职责')}</div>
            </div>
            <span class="chip ${running ? 'accent' : (st.done ? 'green' : 'gray')}">${running ? '执行中' : (st.total ? '待命' : '空闲')}</span>
          </div>
          ${(a.tags || []).length ? `<div class="staff-card-tags">${a.tags.slice(0, 5).map(t => `<span class="chip gray">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="staff-card-stats">
            <span>已完成 <b>${st.done}</b></span>
            <span>失败 <b>${st.failed}</b></span>
            <span>共 <b>${st.total}</b> 单</span>
          </div>
          ${running ? `<div class="staff-card-running">${icon('pulse')}${esc(String(running.task).slice(0, 40))}</div>` : ''}
          ${recent.length ? `<div class="staff-card-jobs">
            ${recent.map(j => `<div class="job-row" data-act="job-view" data-id="${j.id}">
              <span class="job-dot ${esc(JOB_STATUS_CHIP[j.status] || 'gray')}"></span>
              <div class="grow" style="min-width:0">
                <div class="job-task">${esc(String(j.task).slice(0, 26))}</div>
                <div class="job-meta">${JOB_STATUS_TEXT[j.status] || j.status}</div>
              </div>
            </div>`).join('')}
          </div>` : ''}
          <div class="staff-card-actions">
            <button class="btn sm" data-act="agent-edit" data-a="${esc(a.name)}">${icon('pencil')}编辑</button>
            <button class="btn sm primary" data-act="staff-assign" data-a="${esc(a.name)}" ${running ? 'disabled' : ''}>
              ${icon('send')}${running ? '忙碌中' : '派任务'}</button>
            <button class="btn sm" data-act="job-view" data-id="${(st.last || {}).id || ''}" ${st.last ? '' : 'disabled'}>最近一单</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${p ? `<div class="field-hint" style="margin-top:12px;text-align:center">
      派单默认归属当前项目「${esc(projName(p))}」，可在派单窗里改；产出会存进 <span class="mono">${esc((p.folder || p.name))}/写作/</span></div>` : ''}`}

    <div class="card panel" style="margin-top:var(--gap)">
      <div class="panel-head"><h3>${icon('clock')}全部任务</h3><span class="head-sub">${jobsAll().length} 条</span></div>
      <div class="job-list">
        ${jobsAll().length ? jobsAll().slice(0, 20).map(j => `<div class="job-row" data-act="job-view" data-id="${j.id}">
          <span class="job-dot ${esc(JOB_STATUS_CHIP[j.status] || 'gray')}"></span>
          <div class="grow" style="min-width:0">
            <div class="job-task">${esc(String(j.task).slice(0, 50))}</div>
            <div class="job-meta">${esc(j.agent)} · ${JOB_STATUS_TEXT[j.status] || j.status}${j.steps && j.steps.length ? ' · ' + j.steps.length + ' 步' : ''}${j.finishedAt && j.startedAt ? ' · ' + Math.max(1, Math.round((j.finishedAt - j.startedAt) / 1000)) + ' 秒' : ''}</div>
          </div>
        </div>`).join('') : '<div class="staff-empty-mini">还没有派过任务</div>'}
      </div>
    </div>
  </div>`;
}
