/* 一次性截图探针：走 main.js 的完整 IPC，导航到指定路由后截图 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

async function run({ ROOT, route = 'agents', out }) {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true
    }
  });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise(r => setTimeout(r, 2600));
  /* 临时目录等同全新设备：真注册一个身份，避免账户门遮挡截图 */
  await win.webContents.executeJavaScript("Bridge.accountRegister({ name: '截图', pass: '' })");
  await win.webContents.reload();
  await new Promise(r => setTimeout(r, 2600));
  await win.webContents.executeJavaScript(
    `(() => {
      try {
        /* 造最小可用数据（真实数据迁移验证时用 --keep-data 关闭） */
        if (!DB.projects.length) {
          DB.projects.push({
            id: 'p1', name: 'TPMS 换热器研究', folder: 'TPMS 换热器研究',
            subtitle: '多孔结构换热器设计与性能优化', goal: '基于 TPMS 多孔结构的高效换热器设计与性能优化研究',
            period: '2026.10 - 2027.06', stage: '仿真阶段', next: '优化方案',
            thumb: 'tpms', seed: 3, progress: 42,
            owner: { n: '我', r: '项目负责人', agent: '科研写作·论文' },
            nodes: [{ l: '建模', s: 'done', d: '10.05' }, { l: '网格', s: 'done', d: '10.11' },
                    { l: '仿真', s: 'current', d: '10.15' }, { l: '优化', s: 'todo', d: '11.05' }],
            tags: ['能源与热科学'], members: [{ n: '研究员', r: '负责人' }],
            agents: ['科研写作·论文'], tools: ['Fluent'], intro: ''
          });
        }
        state.project = DB.projects[0].id;
        state.aiKey = { stored: true, encrypted: true };
        if (!DB.agentJobs.length) {
          DB.agentJobs.push(
            { id: 'jdemo1', agent: '科研写作·论文', task: '根据仿真结果写论文方法章节初稿，约 800 字', projectId: 'p1', status: 'done', createdAt: Date.now() - 7200000, startedAt: Date.now() - 7190000, finishedAt: Date.now() - 7150000, result: '已完成方法章节初稿，共 812 字。', error: '', steps: [{ label: '读取项目上下文', ok: true }, { label: '检索知识库资料', ok: true }, { label: '保存写作草稿', ok: true }] },
            { id: 'jdemo2', agent: '科研写作·综述', task: '梳理 TPMS 换热器近三年文献，输出分类框架', projectId: 'p1', status: 'running', createdAt: Date.now() - 60000, startedAt: Date.now() - 55000, finishedAt: 0, result: '', error: '', steps: [{ label: '检索知识库资料', ok: true }] }
          );
        }
        state.setTab = 'general';
        if ('${route}' === 'ai-assign') { state.aiMode = 'assign'; go('ai'); }
        else if ('${route}' === 'project') { state.projectTab = 'overview'; state.project = DB.projects[0].id; go('project'); }
        else go('${route}');
      } catch (e) { return String(e.message); }
      return 'ok';
    })()`
  );
  await new Promise(r => setTimeout(r, 900));
  /* 隐藏窗口里 DOM 变化后合成帧可能没刷新，先显示一次并强制重绘 */
  win.showInactive();
  win.webContents.invalidate();
  await new Promise(r => setTimeout(r, 600));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  const info = await win.webContents.executeJavaScript(`(() => {
    const v = document.getElementById('view');
    const head = v ? v.innerHTML.slice(0, 700) : '';
    const cs = v ? getComputedStyle(v) : null;
    const first = v && v.firstElementChild;
    return {
      agents: (typeof DB !== 'undefined' ? DB.agents.length : -1),
      cards: document.querySelectorAll('.agent-card').length,
      hasEmpty: /还没有 Agent/.test(v ? v.innerHTML : ''),
      htmlLen: v ? v.innerHTML.length : 0,
      viewH: v ? v.getBoundingClientRect().height : 0,
      firstH: first ? first.getBoundingClientRect().height : -1,
      firstCls: first ? first.className : '',
      opacity: cs ? cs.opacity : '',
      head
    };
  })()`);
  console.log('[shot]', out, fs.statSync(out).size, 'bytes', JSON.stringify(info));
  try { win.destroy(); } catch (_) {}
  return { ok: true, file: out, info };
}

module.exports = { run };
