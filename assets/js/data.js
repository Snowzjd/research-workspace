/* ==========================================================================
   个人 AI 科研工程工作台 · 数据层
   - 项目 / Agent / 任务 / 知识库 / 软件 / 流程 / 活动 / 待办
   - 项目缩略图为程序化生成的 SVG（无外部图片依赖）
   ========================================================================== */

/* ---------- 伪随机（保证每次渲染一致） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (n) => Math.round(n * 100) / 100;

/* ==========================================================================
   项目缩略图生成器
   ========================================================================== */

/* 1. TPMS 多孔点阵结构 */
function thumbTPMS(seed) {
  const rnd = mulberry32(seed);
  let horiz = '', vert = '';
  for (let i = 0; i < 8; i++) {
    const base = 4 + i * 15, amp = 5 + rnd() * 4, k = 0.035 + rnd() * 0.02, ph = rnd() * 6.28;
    let d = `M -10 ${r2(base + amp * Math.sin(ph))}`;
    for (let x = 0; x <= 250; x += 5) d += ` L ${x} ${r2(base + amp * Math.sin(k * x + ph))}`;
    horiz += `<path d="${d}" fill="none" stroke="url(#tpL)" stroke-width="1.5" opacity="${r2(0.35 + rnd() * 0.4)}"/>`;
  }
  for (let i = 0; i < 14; i++) {
    const base = 3 + i * 18, amp = 4 + rnd() * 4, k = 0.05 + rnd() * 0.03, ph = rnd() * 6.28;
    let d = `M ${r2(base + amp * Math.sin(ph))} -10`;
    for (let y = 0; y <= 120; y += 5) d += ` L ${r2(base + amp * Math.sin(k * y + ph))} ${y}`;
    vert += `<path d="${d}" fill="none" stroke="url(#tpL)" stroke-width="1.3" opacity="${r2(0.28 + rnd() * 0.35)}"/>`;
  }
  return `<svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="tpB" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#431040"/><stop offset=".45" stop-color="#7c1355"/><stop offset="1" stop-color="#2a0b2c"/>
    </linearGradient>
    <linearGradient id="tpL" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fce7f3"/><stop offset=".55" stop-color="#f472b6"/><stop offset="1" stop-color="#a21caf"/>
    </linearGradient>
    <radialGradient id="tpV" cx=".5" cy=".45" r=".75">
      <stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1a0419" stop-opacity=".7"/>
    </radialGradient>
  </defs>
  <rect width="240" height="110" fill="url(#tpB)"/>${horiz}${vert}
  <rect width="240" height="110" fill="url(#tpV)"/></svg>`;
}

/* 2. LNG 冷能利用 · 工业储罐 */
function thumbLNG(seed) {
  const rnd = mulberry32(seed);
  let lights = '';
  for (let i = 0; i < 26; i++) lights += `<circle cx="${r2(rnd() * 240)}" cy="${r2(28 + rnd() * 10)}" r="${r2(0.5 + rnd())}" fill="#bae6fd" opacity="${r2(0.3 + rnd() * 0.6)}"/>`;
  const tank = (x, w, h) => `
    <rect x="${x}" y="${110 - h}" width="${w}" height="${h}" rx="4" fill="url(#lnT)"/>
    <ellipse cx="${x + w / 2}" cy="${110 - h}" rx="${w / 2}" ry="${w * 0.16}" fill="#e2e8f0"/>
    <rect x="${x + 6}" y="${110 - h * 0.62}" width="${w - 12}" height="2" fill="#94a3b8" opacity=".5"/>
    <rect x="${x + w * 0.46}" y="${110 - h}" width="3" height="${h}" fill="#f1f5f9" opacity=".55"/>`;
  return `<svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="lnS" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1a30"/><stop offset=".55" stop-color="#1c3a5e"/><stop offset="1" stop-color="#2b4f74"/>
    </linearGradient>
    <linearGradient id="lnT" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8fa6bd"/><stop offset=".32" stop-color="#e8eef5"/><stop offset=".7" stop-color="#c3d2e0"/><stop offset="1" stop-color="#7c93aa"/>
    </linearGradient>
    <linearGradient id="lnG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#334155"/><stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="240" height="110" fill="url(#lnS)"/>${lights}
  <circle cx="196" cy="34" r="13" fill="#fef9c3" opacity=".18"/>
  <rect y="86" width="240" height="24" fill="url(#lnG)"/>
  ${tank(24, 44, 52)}${tank(78, 36, 44)}
  <circle cx="146" cy="72" r="18" fill="url(#lnT)"/><ellipse cx="146" cy="72" rx="18" ry="6" fill="#b6c7d8" opacity=".55"/>
  <rect x="0" y="82" width="240" height="3" fill="#64748b"/>
  <path d="M24 76 H240" stroke="#94a3b8" stroke-width="2.5" opacity=".8" fill="none"/>
  <path d="M120 76 V60 H170 V76" stroke="#94a3b8" stroke-width="2.5" fill="none" opacity=".8"/>
  <rect x="108" y="52" width="10" height="10" rx="2" fill="#facc15" opacity=".9"/>
  <circle cx="182" cy="90" r="2.2" fill="#f87171"/><circle cx="192" cy="90" r="2.2" fill="#4ade80"/>
</svg>`;
}

/* 3. CFD 涡量场 */
function thumbCFD(seed) {
  const rnd = mulberry32(seed);
  const pal = [
    ['#22d3ee', '#0891b2'], ['#f472b6', '#be185d'], ['#facc15', '#ea580c'],
    ['#a78bfa', '#6d28d9'], ['#34d399', '#047857'], ['#60a5fa', '#1d4ed8']
  ];
  let defs = '', blobs = '';
  for (let i = 0; i < 22; i++) {
    const [c1, c2] = pal[i % pal.length];
    defs += `<radialGradient id="cf${i}"><stop offset="0" stop-color="${c1}" stop-opacity=".95"/><stop offset=".55" stop-color="${c2}" stop-opacity=".55"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient>`;
    const cx = rnd() * 240, cy = rnd() * 110, rx = 18 + rnd() * 34, ry = 12 + rnd() * 26, rot = rnd() * 180;
    blobs += `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="url(#cf${i})" transform="rotate(${r2(rot)} ${r2(cx)} ${r2(cy)})"/>`;
  }
  let lines = '';
  for (let i = 0; i < 12; i++) {
    let d = `M -5 ${r2(rnd() * 110)}`, y = rnd() * 110;
    for (let x = 0; x <= 245; x += 12) { y += (rnd() - 0.5) * 16; d += ` Q ${x + 6} ${r2(y)} ${x + 12} ${r2(y + (rnd() - .5) * 10)}`; }
    lines += `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${r2(0.35 + rnd() * 0.5)}" opacity="${r2(0.15 + rnd() * 0.35)}"/>`;
  }
  return `<svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
  <defs>${defs}
    <radialGradient id="cfV" cx=".5" cy=".5" r=".72"><stop offset=".4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#020617" stop-opacity=".72"/></radialGradient>
  </defs>
  <rect width="240" height="110" fill="#071129"/>${blobs}${lines}
  <rect width="240" height="110" fill="url(#cfV)"/>
  <rect x="10" y="10" width="46" height="3" rx="1.5" fill="#fff" opacity=".18"/>
  <rect x="10" y="17" width="30" height="3" rx="1.5" fill="#fff" opacity=".12"/>
</svg>`;
}

/* 4. 多目标优化 · Pareto 前沿 */
function thumbPareto(seed) {
  const rnd = mulberry32(seed);
  let cont = '';
  for (let i = 6; i >= 1; i--) {
    cont += `<ellipse cx="120" cy="72" rx="${r2(i * 26 + 14)}" ry="${r2(i * 11 + 6)}" fill="none" stroke="#c084fc" stroke-width=".8" opacity="${r2(0.10 + (7 - i) * 0.07)}"/>`;
  }
  let pts = '';
  const front = [];
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    front.push([28 + t * 186, 92 - Math.pow(1 - t, 0.62) * 66]);
  }
  for (let i = 0; i < 95; i++) {
    const x = 22 + rnd() * 196, y = 18 + rnd() * 82;
    const near = front.some(p => Math.abs(p[0] - x) < 12 && Math.abs(p[1] - y) < 12);
    pts += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(1.1 + rnd() * 1.9)}" fill="${near ? '#ec4899' : (y < 55 ? '#a78bfa' : '#94a3b8')}" opacity="${near ? 0.95 : r2(0.22 + rnd() * 0.4)}"/>`;
  }
  const path = front.map((p, i) => `${i ? 'L' : 'M'} ${r2(p[0])} ${r2(p[1])}`).join(' ');
  return `<svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="paB" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff7fb"/><stop offset="1" stop-color="#f3e8ff"/></linearGradient></defs>
  <rect width="240" height="110" fill="url(#paB)"/>${cont}
  <path d="M22 100 H226 M22 100 V12" stroke="#a99cb4" stroke-width="1.2" opacity=".7" fill="none"/>
  ${pts}
  <path d="${path}" fill="none" stroke="#ec4899" stroke-width="2.2" stroke-dasharray="5 3"/>
  ${front.map(p => `<circle cx="${r2(p[0])}" cy="${r2(p[1])}" r="2.6" fill="#fff" stroke="#db2777" stroke-width="1.6"/>`).join('')}
  <rect x="154" y="12" width="72" height="18" rx="6" fill="#fff" opacity=".88"/>
  <text x="162" y="25" font-size="10" font-family="monospace" fill="#be185d">Pareto 前沿</text>
</svg>`;
}

/* 5. 试验台 · 换热器测试回路 */
function thumbBench(seed) {
  const rnd = mulberry32(seed);
  let tubes = '';
  for (let i = 0; i < 9; i++) tubes += `<path d="M78 ${r2(38 + i * 5.4)} H178" stroke="#cbd5e1" stroke-width="2.6" stroke-linecap="round"/>`;
  let gauges = '';
  [104, 132, 160].forEach((cx, i) => {
    gauges += `<circle cx="${cx}" cy="24" r="9" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.6"/>
      <path d="M${cx} 24 L${cx + (i % 2 ? 5 : -4)} ${18 + i}" stroke="#ef4444" stroke-width="1.4" stroke-linecap="round"/>`;
  });
  return `<svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="beB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8eef5"/><stop offset="1" stop-color="#c9d6e3"/></linearGradient>
    <linearGradient id="beM" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f5f9"/><stop offset=".5" stop-color="#b8c6d6"/><stop offset="1" stop-color="#8b9cb0"/></linearGradient>
  </defs>
  <rect width="240" height="110" fill="url(#beB)"/>
  <rect x="0" y="86" width="240" height="24" fill="#9aa8b8"/>
  <rect x="0" y="86" width="240" height="4" fill="#e2e8f0"/>
  <!-- 换热器筒体 -->
  <rect x="66" y="30" width="124" height="56" rx="9" fill="url(#beM)" stroke="#7f8fa3" stroke-width="1.4"/>
  <rect x="58" y="34" width="10" height="48" rx="3" fill="#64748b"/>
  <rect x="188" y="34" width="10" height="48" rx="3" fill="#64748b"/>
  ${tubes}
  <!-- 管路 -->
  <path d="M20 92 V58 H66" stroke="#7f8fa3" stroke-width="4" fill="none" stroke-linejoin="round"/>
  <path d="M198 58 H222 V92" stroke="#7f8fa3" stroke-width="4" fill="none" stroke-linejoin="round"/>
  <rect x="30" y="66" width="12" height="12" rx="3" fill="#f472b6"/>
  <rect x="204" y="66" width="12" height="12" rx="3" fill="#38bdf8"/>
  ${gauges}
  <circle cx="86" cy="92" r="3" fill="#4ade80"/><circle cx="98" cy="92" r="3" fill="#facc15"/>
  <rect x="10" y="13" width="42" height="21" rx="4" fill="#1e293b"/>
  <text x="16" y="27.5" font-size="9.5" font-family="monospace" fill="#4ade80">24.6℃</text>
  ${Array.from({ length: 16 }, () => `<circle cx="${r2(rnd() * 240)}" cy="${r2(rnd() * 110)}" r=".6" fill="#fff" opacity="${r2(rnd() * .3)}"/>`).join('')}
</svg>`;
}

/* 6. RAG 知识库 */
function thumbRAG(seed) {
  const rnd = mulberry32(seed);
  const nodes = [[52, 30], [98, 20], [150, 34], [196, 24], [78, 62], [128, 56], [178, 68], [40, 84], [110, 88], [196, 88]];
  let edges = '', dots = '';
  nodes.forEach((n, i) => {
    if (i === 0) return;
    const a = nodes[i - 1], b = nodes[i];
    edges += `<path d="M${a[0]} ${a[1]} Q ${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2 - 10} ${b[0]} ${b[1]}" fill="none" stroke="#c084fc" stroke-width=".8" opacity=".45"/>`;
  });
  edges += `<path d="M52 30 L128 56 M150 34 L128 56 M78 62 L40 84 M128 56 L110 88 M178 68 L196 88" fill="none" stroke="#f472b6" stroke-width=".8" opacity=".4"/>`;
  nodes.forEach((n, i) => {
    const big = i === 5;
    dots += `<circle cx="${n[0]}" cy="${n[1]}" r="${big ? 6 : 3 + rnd() * 2}" fill="${big ? '#ec4899' : '#a78bfa'}" opacity=".9"/>
      <circle cx="${n[0]}" cy="${n[1]}" r="${(big ? 6 : 4) + 3}" fill="none" stroke="${big ? '#f472b6' : '#c4b5fd'}" stroke-width=".7" opacity=".4"/>`;
  });
  return `<svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="rgB" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff5fa"/><stop offset="1" stop-color="#f5f0ff"/></linearGradient></defs>
  <rect width="240" height="110" fill="url(#rgB)"/>
  <g opacity=".95">
    <rect x="16" y="20" width="58" height="74" rx="5" fill="#fff" stroke="#e9d5ff" stroke-width="1"/>
    <rect x="24" y="30" width="42" height="3.4" rx="1.7" fill="#c4b5fd"/>
    <rect x="24" y="38" width="34" height="3.4" rx="1.7" fill="#ddd6fe"/>
    <rect x="24" y="46" width="40" height="3.4" rx="1.7" fill="#ddd6fe"/>
    <rect x="24" y="54" width="26" height="3.4" rx="1.7" fill="#ddd6fe"/>
    <rect x="24" y="68" width="42" height="16" rx="3" fill="#fbcfe8"/>
  </g>
  <rect x="10" y="14" width="58" height="74" rx="5" fill="#fff" stroke="#e9d5ff" stroke-width="1" opacity=".7"/>
  <rect x="4" y="8" width="58" height="74" rx="5" fill="#fff" stroke="#e9d5ff" stroke-width="1"/>
  <rect x="12" y="18" width="42" height="3.4" rx="1.7" fill="#f9a8d4"/>
  <rect x="12" y="26" width="34" height="3.4" rx="1.7" fill="#fbcfe8"/>
  <rect x="12" y="34" width="40" height="3.4" rx="1.7" fill="#fbcfe8"/>
  ${edges}${dots}
  <rect x="166" y="11" width="68" height="18" rx="9" fill="#ec4899" opacity=".92"/>
  <text x="173" y="24" font-size="10" font-family="monospace" fill="#fff">RAG · 召回</text>
</svg>`;
}

const THUMBS = { tpms: thumbTPMS, lng: thumbLNG, cfd: thumbCFD, pareto: thumbPareto, bench: thumbBench, rag: thumbRAG };
const thumbSVG = (kind, seed) => (THUMBS[kind] || thumbCFD)(seed);

/* ==========================================================================
   应用数据
   ========================================================================== */

const AGENT_COLORS = {
  Architect:  { bg: 'linear-gradient(135deg,#8A7ED6,#5B4C9E)', ico: 'layers' },
  Researcher: { bg: 'linear-gradient(135deg,#5B87C9,#2C5688)', ico: 'search' },
  Engineer:   { bg: 'linear-gradient(135deg,#D9578A,#A81E58)', ico: 'cpu' },
  Analyst:    { bg: 'linear-gradient(135deg,#C79A3E,#8A5E14)', ico: 'chart' },
  Writer:     { bg: 'linear-gradient(135deg,#3A9E70,#14603C)', ico: 'pencil' },
  Verifier:   { bg: 'linear-gradient(135deg,#3A9CAD,#0D5B66)', ico: 'target' }
};

const SEED = {
  user: { name: '研究员', initial: '研', greet: '下午好，研究员', mode: '科研模式已开启' },

  /* 数据根目录（可在设置中修改，任务材料路径均以此为基准拼接） */
  rootDir: 'F:\\ResearchWorkspace',

  stats: [
    { key: 'todayTask', ico: '📋', val: '8', suf: '/12', label: '今日任务', bg: 'linear-gradient(135deg,#f472b6,#db2777)' },
    { key: 'projects',  ico: '📁', val: '6', suf: '',    label: '进行中项目', bg: 'linear-gradient(135deg,#a78bfa,#7c3aed)' },
    { key: 'agents',    ico: '🤖', val: '4', suf: '',    label: '运行Agent', bg: 'linear-gradient(135deg,#60a5fa,#2563eb)' }
  ],

  /* ---------- 项目 ---------- */
  projects: [
    {
      id: 'tpms', name: 'TPMS换热器', subtitle: '多孔结构换热器设计与性能优化',
      accent: '#ec4899', thumb: 'tpms', seed: 11, progress: 75,
      stage: '仿真计算', next: '优化结构参数',
      tools: ['Fluent', 'Python', 'Tecplot'],
      agents: ['Engineer', ''],
      nodes: [
        { l: '建模', s: 'done', d: '10.05' }, { l: '网格', s: 'done', d: '10.11' },
        { l: '仿真', s: 'current', d: '10.15' }, { l: '优化', s: 'todo', d: '11.05' }, { l: '论文', s: 'todo', d: '12.01' }
      ],
      goal: '基于 TPMS 多孔结构的高效换热器设计与性能优化研究',
      period: '2026.10 - 2027.06', tags: ['能源与热科学'],
      members: [{ n: '研究员', r: '负责人' }, { n: '研究生B', r: '（合作）' }, { n: '研究生A', r: '（合作）' }],
      intro: '基于 TPMS 多孔结构设计新型换热器，结合 CFD 数值模拟与多目标优化方法，实现换热性能与低流动阻力的平衡，探索其在低品位能源系统中的应用前景。',
      points: [
        '完成三种 TPMS 结构的建模与网格生成',
        '开展不同雷诺数下的换热性能仿真',
        '初步得到结构参数与换热效率的关系',
        '整理仿真结果并生成对比图表'
      ],
      plan: [
        '优化结构参数并开展多目标优化',
        '增加不同工况的对比仿真',
        '形成初步的论文框架',
        '准备组会汇报材料'
      ],
      owner: { n: '我', r: '项目负责人', agent: 'Engineer' },
      files: ['TPMS结构参数_v3.xlsx', '网格无关性验证.docx', '仿真结果汇总.csv'],
      git: 'gitlab.local/tpms-heat-exchanger', kb: 'TPMS换热器知识库',
      flow: ['建模', '仿真', '数据处理', '优化', '文档/汇报']
    },
    {
      id: 'lng', name: 'LNG冷能利用', subtitle: '低温能源梯级利用系统研究',
      accent: '#60a5fa', thumb: 'lng', seed: 22, progress: 40,
      stage: '系统方案设计', next: '建模流程搭建',
      tools: ['Fluent', 'Tecplot'],
      agents: ['Architect', ''],
      nodes: [
        { l: '建模', s: 'done', d: '09.20' }, { l: '仿真', s: 'current', d: '10.15' },
        { l: '优化', s: 'todo', d: '11.10' }, { l: '报告', s: 'todo', d: '12.05' }
      ],
      goal: 'LNG 冷能回收与梯级利用系统的流程建模与能效分析',
      period: '2026.09 - 2027.05', tags: ['能源系统'],
      members: [{ n: '研究员', r: '负责人' }, { n: '研究生C', r: '（合作）' }],
      intro: '面向 LNG 气化过程中释放的大量冷能，设计梯级利用流程并建立热力学模型，评估不同工况下的冷能回收效率与经济效益。',
      points: ['完成文献综述与工况梳理', '确定三种候选流程方案', '搭建朗肯循环热力学模型'],
      plan: ['建立完整流程仿真', '开展㶲分析', '对比不同方案的回收效率'],
      owner: { n: '我', r: '项目负责人', agent: 'Architect' },
      files: ['LNG工况数据.xlsx', '流程方案对比.pptx'],
      git: 'gitlab.local/lng-cascade', kb: 'LNG冷能知识库',
      flow: ['建模', '仿真', '数据处理', '优化', '文档/汇报']
    },
    {
      id: 'cfd', name: 'CFD对比分析', subtitle: '不同湍流模型的对比研究',
      accent: '#a78bfa', thumb: 'cfd', seed: 33, progress: 60,
      stage: '结果对比分析', next: '撰写对比报告',
      tools: ['Fluent', 'Tecplot'],
      agents: ['Analyst', ''],
      nodes: [
        { l: '建模', s: 'done', d: '09.28' }, { l: '仿真', s: 'done', d: '10.09' },
        { l: '对比', s: 'current', d: '10.15' }, { l: '报告', s: 'todo', d: '10.28' }
      ],
      goal: 'k-ε / SST / LES 三种湍流模型在复杂通道流动中的适用性评估',
      period: '2026.09 - 2026.11', tags: ['数值方法'],
      members: [{ n: '研究员', r: '负责人' }],
      intro: '以典型复杂通道为对象，系统评估不同湍流模型在压降、分离与换热预测上的差异，为后续仿真选型提供依据。',
      points: ['完成三套网格与求解设置', '获得 12 组工况结果', '绘制速度/压力场对比图'],
      plan: ['量化误差指标', '给出模型选型建议', '归档算例配置'],
      owner: { n: '我', r: '项目负责人', agent: 'Analyst' },
      files: ['湍流模型对比.xlsx', '速度场对比.png'],
      git: 'gitlab.local/cfd-turbulence-bench', kb: 'CFD方法库',
      flow: ['建模', '仿真', '数据处理', '优化', '文档/汇报']
    },
    {
      id: 'opt', name: '多目标优化', subtitle: '换热器多目标拓扑优化',
      accent: '#f59e0b', thumb: 'pareto', seed: 44, progress: 30,
      stage: '算法开发', next: '多目标运行优化',
      tools: ['Python', '自研Agent'],
      agents: ['Engineer', ''],
      nodes: [
        { l: '建模', s: 'done', d: '10.08' }, { l: '算法', s: 'current', d: '10.15' },
        { l: '运行', s: 'todo', d: '10.30' }, { l: '分析', s: 'todo', d: '11.15' }, { l: '报告', s: 'todo', d: '11.30' }
      ],
      goal: '构建换热-阻力双目标优化框架并求解 Pareto 前沿',
      period: '2026.10 - 2027.01', tags: ['优化算法'],
      members: [{ n: '研究员', r: '负责人' }, { n: '研究生A', r: '（合作）' }],
      intro: '基于 NSGA-II 与代理模型，构建换热性能与流动阻力双目标优化框架，输出可供工程权衡的 Pareto 前沿。',
      points: ['确定设计变量与约束', '搭建代理模型管线', '完成单目标验证算例'],
      plan: ['实现多目标求解器', '批量提交算例', '前沿分析与可视化'],
      owner: { n: '我', r: '项目负责人', agent: 'Engineer' },
      files: ['优化脚本_v2.py', 'Pareto结果.csv'],
      git: 'gitlab.local/moo-heat-exchanger', kb: '优化算法库',
      flow: ['建模', '仿真', '数据处理', '优化', '文档/汇报']
    },
    {
      id: 'bench', name: '试验台接手', subtitle: '换热性能试验台调试与数据分析',
      accent: '#10b981', thumb: 'bench', seed: 55, progress: 50,
      stage: '设备调试', next: '开展首轮试验',
      tools: ['数据采集', 'Python'],
      agents: ['Verifier', ''],
      nodes: [
        { l: '建模', s: 'done', d: '10.02' }, { l: '仿真', s: 'done', d: '10.10' },
        { l: '调试', s: 'current', d: '10.15' }, { l: '优化', s: 'todo', d: '11.08' }, { l: '报告', s: 'todo', d: '11.28' }
      ],
      goal: '完成试验台交接、标定与首轮换热性能试验',
      period: '2026.10 - 2026.12', tags: ['实验测量'],
      members: [{ n: '研究员', r: '负责人' }, { n: '师兄', r: '（交接）' }],
      intro: '接手既有换热性能试验台，完成设备清点、传感器标定与数据采集链路搭建，为后续实验验证提供可靠平台。',
      points: ['完成设备清单与线路核对', '传感器标定 3 支', '数据采集脚本跑通'],
      plan: ['完成首轮空白试验', '与仿真结果交叉验证', '整理实验操作规程'],
      owner: { n: '我', r: '项目负责人', agent: 'Verifier' },
      files: ['试验台清单.xlsx', '标定记录.docx'],
      git: 'gitlab.local/test-bench', kb: '实验数据知识库',
      flow: ['建模', '仿真', '数据处理', '优化', '文档/汇报']
    },
    {
      id: 'rag', name: 'RAG知识库', subtitle: '构建科研知识库与智能问答',
      accent: '#8b5cf6', thumb: 'rag', seed: 66, progress: 20,
      stage: '知识库搭建', next: '导入文献数据',
      tools: ['本地LLM', '向量库'],
      agents: ['Researcher', 'Writer'],
      nodes: [
        { l: '建模', s: 'done', d: '10.06' }, { l: '算法', s: 'current', d: '10.15' },
        { l: '运行', s: 'todo', d: '10.26' }, { l: '分析', s: 'todo', d: '11.12' }, { l: '报告', s: 'todo', d: '11.26' }
      ],
      goal: '搭建个人科研 RAG 知识库，支持文献检索与智能问答',
      period: '2026.10 - 2027.02', tags: ['AI 工具'],
      members: [{ n: '研究员', r: '负责人' }],
      intro: '将个人积累的论文、实验数据、代码与报告统一入库，结合本地大模型与向量检索实现可溯源的科研问答。',
      points: ['确定文档切分与检索策略', '完成向量库选型', '导入首批 120 篇文献'],
      plan: ['导入实验数据与代码', '接入 Agent 自动问答', '建立引用溯源机制'],
      owner: { n: '我', r: '项目负责人', agent: 'Researcher' },
      files: ['knowledge_base/', '索引说明.md'],
      git: 'gitlab.local/research-rag', kb: '个人科研知识库',
      flow: ['建模', '仿真', '数据处理', '优化', '文档/汇报']
    }
  ],

  /* ---------- Agent ---------- */
  agents: [
    { name: 'Architect', role: '项目规划 / 技术路线设计', status: 'running', tags: ['路线设计', '需求拆解', '里程碑'],
      task: '为 LNG 冷能利用项目设计三阶段技术路线，输出可行性对比。', stats: [12, 3, 96] },
    { name: 'Researcher', role: '文献调研 / 知识整理', status: 'busy', tags: ['文献检索', '综述', '知识图谱'],
      task: '检索 TPMS 换热器近三年文献 48 篇，生成结构化综述摘要。', stats: [86, 5, 92] },
    { name: 'Engineer', role: 'CAD / CFD / 代码实现', status: 'running', tags: ['建模', '仿真', 'Python'],
      task: '执行 TPMS 晶胞参数扫描，批量提交 24 组 Fluent 算例。', stats: [148, 2, 94] },
    { name: 'Analyst', role: '数据处理 / 可视化 / 结论分析', status: 'busy', tags: ['数据处理', '绘图', '统计'],
      task: '对 CFD 湍流模型对比结果做误差量化与敏感性分析。', stats: [64, 4, 90] },
    { name: 'Writer', role: '论文 / 报告 / 专利撰写', status: 'idle', tags: ['论文', '报告', '专利'],
      task: '待分配：TPMS 换热器论文方法章节初稿。', stats: [9, 0, 88] },
    { name: 'Verifier', role: '结果校验 / 复现 / 质检', status: 'idle', tags: ['校验', '复现', '质检'],
      task: '待分配：试验台标定数据一致性核查。', stats: [21, 0, 95] }
  ],

  /* ---------- 任务（dir = 相对项目目录的材料所在文件夹） ---------- */
  tasks: [
    { t: '优化 TPMS 晶胞参数',        p: 'tpms',  agent: 'Engineer',   tool: 'Python',   due: '10-18', pri: 'high', st: 'doing',  dir: '04_优化' },
    { t: '批量提交 Fluent 算例（24 组）', p: 'tpms', agent: 'Engineer',  tool: 'Fluent',   due: '10-20', pri: 'high', st: 'doing',  dir: '03_仿真' },
    { t: '整理仿真结果对比图表',      p: 'tpms',  agent: 'Analyst',    tool: 'Tecplot',  due: '10-22', pri: 'mid',  st: 'todo',   dir: '03_仿真' },
    { t: '支撑材料与图表归档',        p: 'tpms',  agent: 'Writer',     tool: '文档',     due: '10-25', pri: 'low',  st: 'todo',   dir: '05_文档' },
    { t: '网格无关性验证',            p: 'tpms',  agent: 'Engineer',   tool: 'Fluent',   due: '10-12', pri: 'mid',  st: 'done',   dir: '02_网格' },
    { t: '组会汇报 PPT 制作',         p: 'tpms',  agent: 'Writer',     tool: '文档',     due: '10-18', pri: 'mid',  st: 'done',   dir: '05_文档' },
    { t: 'LNG 梯级利用方案对比',      p: 'lng',   agent: 'Architect',  tool: '文档',     due: '10-19', pri: 'mid',  st: 'doing',  dir: '02_流程方案' },
    { t: '㶲分析模型搭建',            p: 'lng',   agent: 'Engineer',   tool: 'Python',   due: '10-27', pri: 'mid',  st: 'todo',   dir: '03_仿真' },
    { t: '湍流模型误差量化',          p: 'cfd',   agent: 'Analyst',    tool: 'Python',   due: '10-17', pri: 'high', st: 'review', dir: '03_对比分析' },
    { t: '撰写湍流模型对比报告',      p: 'cfd',   agent: 'Writer',     tool: '文档',     due: '10-28', pri: 'mid',  st: 'todo',   dir: '03_对比分析' },
    { t: '实现 NSGA-II 求解器',       p: 'opt',   agent: 'Engineer',   tool: 'Python',   due: '10-21', pri: 'high', st: 'doing',  dir: '01_算法' },
    { t: 'Pareto 前沿可视化',         p: 'opt',   agent: 'Analyst',    tool: 'Python',   due: '10-30', pri: 'low',  st: 'todo',   dir: '03_前沿分析' },
    { t: '传感器标定复核',            p: 'bench', agent: 'Verifier',   tool: '数据采集', due: '10-16', pri: 'high', st: 'review', dir: '02_标定' },
    { t: '首轮空白试验方案',          p: 'bench', agent: 'Verifier',   tool: '文档',     due: '10-23', pri: 'mid',  st: 'todo',   dir: '03_试验数据' },
    { t: '导入首批文献 120 篇',       p: 'rag',   agent: 'Researcher', tool: '向量库',   due: '10-24', pri: 'mid',  st: 'doing',  dir: '01_文献库' },
    { t: '检索增强问答链路联调',      p: 'rag',   agent: 'Engineer',   tool: 'Python',   due: '10-29', pri: 'low',  st: 'todo',   dir: '03_服务' }
  ],
  taskStatus: [
    { key: 'todo',   label: '待处理', color: '#a99cb4' },
    { key: 'doing',  label: '进行中', color: '#ec4899' },
    { key: 'review', label: '待复核', color: '#f59e0b' },
    { key: 'done',   label: '已完成', color: '#10b981' }
  ],

  /* ---------- 软件（kind: exe=可执行文件 / folder=文件夹 / builtin=内置视图） ---------- */
  apps: [
    { n: 'Fluent',     ico: 'FL',  kind: 'exe',    args: [], bg: 'linear-gradient(135deg,#4A7FB5,#1E4A7D)', path: 'C:\\Program Files\\ANSYS Inc\\v231\\fluent\\ntbin\\win64\\fluent.exe', run: true, bound: 'tpms' },
    { n: 'SpaceClaim', ico: 'SC',  kind: 'exe',    args: [], bg: 'linear-gradient(135deg,#7A6AD6,#4636A0)', path: 'C:\\Program Files\\ANSYS Inc\\v231\\scdm\\SpaceClaim.exe', run: null, bound: '' },
    { n: 'Workbench',  ico: 'WB',  kind: 'exe',    args: [], bg: 'linear-gradient(135deg,#3A9CAD,#17616F)', path: 'C:\\Program Files\\ANSYS Inc\\v231\\Framework\\bin\\Win64\\RunWB2.exe', run: null, bound: '' },
    { n: 'Tecplot',    ico: 'TP',  kind: 'exe',    args: [], bg: 'linear-gradient(135deg,#C79A3E,#8A5E14)', path: 'C:\\Program Files\\Tecplot\\Tecplot 360 EX 2023 R1\\bin\\tecplot360ex.exe', run: true, bound: 'tpms' },
    { n: 'Python',     ico: 'PY',  kind: 'exe',    args: [], bg: 'linear-gradient(135deg,#4E88C0,#2A5C8C)', path: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe', run: true, bound: 'opt' },
    { n: 'Jupyter',    ico: 'JT',  kind: 'exe',    args: ['lab'], bg: 'linear-gradient(135deg,#CC7B45,#8E4D22)', path: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\jupyter-lab.exe', run: null, bound: '' },
    { n: 'MATLAB',     ico: 'ML',  kind: 'exe',    args: [], bg: 'linear-gradient(135deg,#BE5159,#852E36)', path: 'C:\\Program Files\\MATLAB\\R2024a\\bin\\matlab.exe', run: null, bound: '' },
    { n: 'VS Code',    ico: 'VS',  kind: 'exe',    args: [], bg: 'linear-gradient(135deg,#4E8CC8,#245E92)', path: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', run: null, bound: '' },
    { n: '浏览器',      ico: 'WEB', kind: 'builtin', args: [], bg: 'linear-gradient(135deg,#7A6AD6,#4636A0)', path: '', run: null, bound: '' },
    { n: '文档',        ico: 'DOC', kind: 'folder', args: [], bg: 'linear-gradient(135deg,#BE5590,#7E2E56)', path: 'F:\\ResearchWorkspace', run: null, bound: '' }
  ],
  sidebarLaunch: ['Fluent', 'SpaceClaim', 'Tecplot', 'Python', '浏览器', '文档'],

  /* ---------- 自动化流程 ---------- */
  automations: [
    { n: '参数扫描 → 批量仿真 → 汇总', on: true, last: '2 小时前 · 24/24 组完成',
      nodes: [['zap', '参数生成'], ['cpu', 'Fluent 批量'], ['chart', '结果汇总'], ['pencil', '图表归档']].map(([i, l]) => ({ i, l })) },
    { n: '文献周更 → 向量入库 → 摘要', on: true, last: '今天 09:00 · 新增 12 篇',
      nodes: [['book', '文献抓取'], ['filter', '切分清洗'], ['sparkles', '向量入库'], ['file', '摘要生成']].map(([i, l]) => ({ i, l })) },
    { n: '试验数据采集 → 清洗 → 入库', on: false, last: '昨天 18:40 · 待启用',
      nodes: [['link', 'DAQ 采集'], ['filter', '异常清洗'], ['database', '入库'], ['chart', '自动绘图']].map(([i, l]) => ({ i, l })) },
    { n: '每日进度汇总 → 日报推送', on: true, last: '今天 21:00 · 已推送',
      nodes: [['layers', '汇总变更'], ['bot', 'Agent 摘要'], ['send', '日报推送']].map(([i, l]) => ({ i, l })) }
  ],

  /* ---------- 最近活动 ---------- */
  activities: [
    { c: '#3E63DD', i: 'terminal', t: '<b>Python 优化脚本</b> 完成第 3 组参数扫描，生成 12 个结果文件', time: '14:32' },
    { c: '#6E56CF', i: 'file',     t: '更新了 <b>TPMS 结构参数表</b> (v3)，新增 2 组工况', time: '11:20' },
    { c: '#C9256B', i: 'cpu',      t: 'Fluent 算例 <b>tpms_re4500</b> 收敛，残差 &lt; 1e-5', time: '10:48' },
    { c: '#218358', i: 'pencil',   t: '<b>Writer Agent</b> 生成组会汇报 PPT 初稿', time: '10:05' },
    { c: '#AD5700', i: 'chart',    t: '<b>Analyst Agent</b> 完成湍流模型误差量化分析', time: '09:41' },
    { c: '#0D7485', i: 'search',   t: '<b>Researcher Agent</b> 检索到 12 篇高相关文献', time: '09:12' }
  ],

  /* ---------- 待办 ---------- */
  todos: [
    { t: '整理多目标优化的参数化仿真文件', due: '今天 16:00', pri: 'high', done: false, cat: 'task' },
    { t: '阅读 2 篇最新湍流领域文献', due: '今天 20:00', pri: 'mid', done: false, cat: 'task' },
    { t: '准备组会汇报 PPT', due: '明天 10:00', pri: 'mid', done: false, cat: 'meeting' },
    { t: '与师兄对接试验台标定数据', due: '明天 14:30', pri: 'high', done: false, cat: 'meeting' },
    { t: '提交本月项目阶段性小结', due: '10-20 18:00', pri: 'mid', done: false, cat: 'deadline' },
    { t: '备份本周仿真结果数据', due: '已完成', pri: 'low', done: true, cat: 'task' }
  ],

  /* ---------- 研究资源（dir = 相对项目目录） ---------- */
  resources: [
    { n: 'TPMS换热器_综述整理.pdf',  ext: 'pdf',  size: '2.4 MB', date: '2026-10-12', cat: 'ref',  tag: '参考文献', p: 'tpms',  dir: '06_参考资料' },
    { n: 'CFD对比分析结果汇总.docx', ext: 'docx', size: '1.1 MB', date: '2026-10-08', cat: 'doc',  tag: '研究文档', p: 'cfd',   dir: '03_对比分析' },
    { n: '多目标优化结果_Pareto.csv',ext: 'csv',  size: '3.2 MB', date: '2026-10-09', cat: 'data', tag: '数据集',   p: 'opt',   dir: '03_前沿分析' },
    { n: '优化脚本集_v2.zip',        ext: 'zip',  size: '5.6 MB', date: '2026-10-05', cat: 'code', tag: '代码',     p: 'opt',   dir: '01_算法' },
    { n: '试验台标定记录表.xlsx',    ext: 'xlsx', size: '860 KB', date: '2026-10-11', cat: 'data', tag: '数据集',   p: 'bench', dir: '02_标定' },
    { n: 'TPMS仿真方法说明.pdf',     ext: 'pdf',  size: '786 KB', date: '2026-10-07', cat: 'ref',  tag: '参考文献', p: 'tpms',  dir: '03_仿真' }
  ],

  /* ---------- 知识库 ---------- */
  kbDocs: [
    { n: 'TPMS 多孔结构换热机理综述', type: '论文', ext: 'pdf',  size: '2.4 MB', date: '2026-10-12', score: 0.94 },
    { n: 'Gyroid 结构流动与传热数值研究', type: '论文', ext: 'pdf', size: '3.8 MB', date: '2026-10-10', score: 0.91 },
    { n: 'CFD 湍流模型应用指南 v3', type: '报告', ext: 'docx', size: '1.2 MB', date: '2026-10-09', score: 0.88 },
    { n: 'LNG 冷能梯级利用专利汇编', type: '专利', ext: 'pdf', size: '2.1 MB', date: '2026-10-06', score: 0.86 },
    { n: '换热器多目标优化数据集', type: '数据', ext: 'csv',  size: '12.4 MB', date: '2026-10-08', score: 0.83 },
    { n: 'NSGA-II 实现与调参笔记', type: '代码', ext: 'py',   size: '640 KB', date: '2026-10-05', score: 0.81 },
    { n: '试验台操作规程（接手版）', type: '报告', ext: 'docx', size: '980 KB', date: '2026-10-11', score: 0.79 },
    { n: 'TPMS 增材制造成型文献集', type: '论文', ext: 'pdf',  size: '5.2 MB', date: '2026-10-03', score: 0.76 }
  ],

  /* ---------- 时间线 ---------- */
  timeline: [
    { p: 'TPMS换热器', bars: [ { s: 0, e: 3, l: '需求分析', c: '#f472b6' }, { s: 3, e: 6, l: '结构设计', c: '#ec4899' }, { s: 6, e: 9, l: 'CFD仿真', c: '#c026d3' }, { s: 9, e: 12, l: '优化与论文', c: '#a78bfa' } ] },
    { p: 'LNG冷能利用', bars: [ { s: 0, e: 4, l: '文献与方案', c: '#60a5fa' }, { s: 4, e: 8, l: '流程建模', c: '#3b82f6' }, { s: 8, e: 11, l: '仿真与㶲分析', c: '#818cf8' } ] },
    { p: 'CFD对比分析', bars: [ { s: 0, e: 3, l: '模型设置', c: '#a78bfa' }, { s: 3, e: 7, l: '批量计算', c: '#8b5cf6' }, { s: 7, e: 9, l: '对比报告', c: '#c084fc' } ] },
    { p: '多目标优化', bars: [ { s: 4, e: 7, l: '算法开发', c: '#fbbf24' }, { s: 7, e: 10, l: '批量求解', c: '#f59e0b' }, { s: 10, e: 12, l: '前沿分析', c: '#fcd34d' } ] },
    { p: '试验台接手', bars: [ { s: 3, e: 6, l: '设备交接与标定', c: '#34d399' }, { s: 6, e: 9, l: '首轮试验', c: '#10b981' }, { s: 9, e: 11, l: '数据整理', c: '#6ee7b7' } ] },
    { p: 'RAG知识库', bars: [ { s: 6, e: 8, l: '方案选型', c: '#8b5cf6' }, { s: 8, e: 11, l: '文献入库', c: '#a78bfa' }, { s: 11, e: 12, l: '问答联调', c: '#c4b5fd' } ] }
  ],
  months: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],

  /* ---------- 底部状态 ---------- */
  workspace: { project: 'TPMS换热器', running: ['Fluent', 'Python', 'Tecplot'], agents: 3 },

  /* ---------- AI 接入配置（API Key 不在这里，由主进程 safeStorage 单独加密保存） ---------- */
  ai: {
    enabled: false,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.3,
    maxTokens: 0,
    autoApprove: true
  },

  /* ---------- 按项目保存的 AI 会话：{ [projectId]: Message[] } ---------- */
  chats: {}
};

/* ==========================================================================
   项目模板
   新建项目时套用的骨架：材料目录 / 阶段 / 起始任务。
   这里只定义「一类项目通常长什么样」，不含任何具体项目的数据。
   ========================================================================== */
const PROJECT_TEMPLATE = {
  id: 'standard',
  builtin: true,
  name: '标准科研项目',
  desc: '文献 → 建模 → 仿真/实验 → 分析 → 文档',
  dirs: ['01_文献', '02_数据', '03_仿真', '04_分析', '05_文档', '06_参考'],
  flow: ['文献', '建模', '仿真', '分析', '文档'],
  nodes: [
    { l: '文献', s: 'current', d: '—' },
    { l: '建模', s: 'todo', d: '—' },
    { l: '仿真', s: 'todo', d: '—' },
    { l: '分析', s: 'todo', d: '—' },
    { l: '文档', s: 'todo', d: '—' }
  ],
  stage: '文献调研',
  next: '确定技术路线',
  /* 起始任务：每个新项目都要先想清楚的三件事，可以删改 */
  tasks: [
    /* 起始任务的负责人留空 = 未指派；不再引用已删除的演示 Agent 名 */
    ['梳理研究目标与边界', ''],
    ['整理参考文献与已有数据', '科研写作·综述'],
    ['确定技术路线与里程碑', '']
  ]
};

const TPL_ACCENTS = ['#C9256B', '#6E56CF', '#0D7485', '#218358', '#AD5700', '#3A6EA5'];

/* ==========================================================================
   同步用：稳定记录 id
   - 老数据没有 id，按「集合 + 名称」派生，保证两台设备算出同一个值
   - 与 desktop/sync-merge.js 的 keyOf 算法保持一致（FNV-1a 32 位）
   ========================================================================== */
function hashKey(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const SYNC_COLLECTIONS = [
  'projects', 'tasks', 'todos', 'kbDocs', 'resources',
  'automations', 'agents', 'templates', 'timeline'
];

function recordKey(coll, rec) {
  if (!rec || typeof rec !== 'object') return '';
  if (rec.id) return String(rec.id);
  let label = '';
  ['n', 't', 'name', 'l', 'key'].some(f => {
    if (rec[f] != null && rec[f] !== '') { label = String(rec[f]); return true; }
    return false;
  });
  if (!label && coll === 'timeline') label = String(rec.p || '');
  return 'k' + hashKey(coll + '|' + label);
}

/* 给缺 id 的记录补齐（幂等） */
function assignRecordIds(d) {
  let n = 0;
  SYNC_COLLECTIONS.forEach(coll => {
    const arr = Array.isArray(d[coll]) ? d[coll] : null;
    if (!arr) return;
    const used = new Set();
    arr.forEach(rec => {
      if (!rec || typeof rec !== 'object') return;
      if (!rec.id) { rec.id = recordKey(coll, rec); n++; }
      if (used.has(rec.id)) { rec.id = rec.id + '_' + hashKey(JSON.stringify(rec)).slice(0, 4); n++; }
      used.add(rec.id);
    });
  });
  return n;
}

/* ---------- 模板集合：内置一套 + 用户自存的若干套 ---------- */
function customTemplates() {
  return Array.isArray(DB.templates) ? DB.templates : [];
}
function allTemplates() {
  return [PROJECT_TEMPLATE, ...customTemplates()];
}
/* 'blank' 或找不到时返回 null（= 只建空壳） */
function templateById(id) {
  const key = String(id || '').trim();
  if (!key || key === 'blank') return null;
  return allTemplates().find(t => t.id === key) || PROJECT_TEMPLATE;
}
function templateOptions() {
  return [
    ...allTemplates().map(t => [t.id, t.name + (t.builtin ? '' : '（自定义）')]),
    ['blank', '空白项目（只有 01_资料 目录）']
  ];
}

/* 新建表单里显示的一行模板说明 */
function templateDesc(id) {
  const t = templateById(id);
  if (!t) return '只建一个项目空壳和「01_资料」目录，阶段由你自己定';
  const dirs = (t.dirs || []).length;
  const flow = (t.flow || []).length;
  const tasks = (t.tasks || []).length;
  return [
    t.desc || '',
    dirs ? `${dirs} 个材料目录` : '',
    flow ? `${flow} 个阶段` : '',
    tasks ? `${tasks} 条起始任务` : ''
  ].filter(Boolean).join(' · ');
}

/* Windows 合法文件夹名：去掉 \ / : * ? " < > |，首尾空白与点 */
function safeFolderName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80) || '未命名项目';
}

/* 进度：只接受有限数字，夹到 0–100 后取整。
   空串、NaN、Infinity、非数字一律返回 null，调用方保持原值。
   不要用范围滑块的缺省中点（min 0 / max 100 → 50）当回退。 */
function parseProjectProgress(raw) {
  if (typeof raw === 'boolean' || raw == null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* 编辑窗滑块的初始状态。无效进度不写 value=""，否则浏览器会把 .value 报成 50。 */
function editorProgressControl(stored) {
  if (typeof stored === 'number' && Number.isFinite(stored)) {
    const value = Math.max(0, Math.min(100, Math.round(stored)));
    return { value, unset: false, label: value + '%' };
  }
  return { value: 0, unset: true, label: '—' };
}

/* touched 为假时忽略滑块读数（可能是浏览器补的 50，或 step 吸附）。 */
function progressFromEditor(stored, inputValue, touched) {
  if (!touched) return { progress: stored, changed: false, rejected: false };
  const parsed = parseProjectProgress(inputValue);
  if (parsed == null) return { progress: stored, changed: false, rejected: true };
  return { progress: parsed, changed: parsed !== stored, rejected: false };
}

/* folder 只记录工作区根目录下的相对名。绝对路径不收；外部目录用 junction 链到这个名字。 */
function parseProjectFolder(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { error: 'folder 不能为空。请填工作区根目录下的相对文件夹名，不要填绝对路径' };
  if (/[\\/]/.test(s) || /^[a-zA-Z]:/.test(s) || s.startsWith('\\\\')) {
    return { error: 'folder 只能是工作区根目录下的相对文件夹名。外部目录请在该位置建立目录联接（junction），接口不复制文件，也不保存绝对路径' };
  }
  if (s === '.' || s === '..') return { error: 'folder 不能是 . 或 ..' };
  const folder = safeFolderName(s);
  if (!folder) return { error: 'folder 不是合法的文件夹名' };
  return { folder };
}

const FLOW_STATE_IN = {
  done: 'done', current: 'current', todo: 'todo',
  '已完成': 'done', '进行中': 'current', '待开始': 'todo', '待开展': 'todo'
};

function copyFlowNode(n) {
  if (!n || !n.l) return null;
  const o = {
    l: String(n.l),
    s: n.s === 'done' || n.s === 'current' || n.s === 'todo' ? n.s : 'todo',
    d: String(n.d || '')
  };
  if (n.id) o.id = String(n.id);
  if (n.criterion) o.criterion = String(n.criterion);
  if (Array.isArray(n.evidence) && n.evidence.length) o.evidence = n.evidence.map(x => String(x));
  if (n.dateKind === 'done' || n.dateKind === 'planned') o.dateKind = n.dateKind;
  return o;
}

function parseFlowNodes(raw) {
  if (!Array.isArray(raw)) return { error: 'nodes 必须是流程节点数组' };
  const nodes = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const l = item.trim();
      if (l) nodes.push({ l: l.slice(0, 200), s: 'todo', d: '' });
      continue;
    }
    if (!item || typeof item !== 'object') return { error: '流程节点必须是对象或阶段名称' };
    const l = String(item.l != null ? item.l : (item.label != null ? item.label : (item.name != null ? item.name : ''))).trim();
    if (!l) continue;
    const rawS = String(item.s != null ? item.s : (item.state != null ? item.state : (item.status != null ? item.status : 'todo'))).trim();
    const s = FLOW_STATE_IN[rawS] || 'todo';
    const d = String(item.d != null ? item.d : (item.date != null ? item.date : '')).trim().slice(0, 40);
    const node = { l: l.slice(0, 200), s, d };
    const id = item.id != null ? String(item.id).trim() : '';
    if (id) node.id = id.slice(0, 40);
    const criterion = item.criterion != null ? item.criterion : item.done_when;
    if (criterion != null) node.criterion = String(criterion).trim().slice(0, 400);
    if (Array.isArray(item.evidence)) node.evidence = item.evidence.map(x => String(x)).filter(Boolean).slice(0, 20);
    const dateKind = item.date_kind != null ? item.date_kind : item.dateKind;
    if (dateKind === 'done' || dateKind === 'planned' || dateKind === '完成' || dateKind === '计划') {
      node.dateKind = (dateKind === 'done' || dateKind === '完成') ? 'done' : 'planned';
    }
    nodes.push(node);
  }
  if (!nodes.length) return { error: '至少要有一个有名字的流程节点' };
  if (nodes.length > 40) return { error: '流程节点最多 40 个' };
  return { nodes };
}

/* 与界面「保存流程」同一套推进规则：至多一个进行中；一个都没有时把第一个未完成接上。
   不写盘。progress 按已完成节点占比计算，调用方可以再用显式进度盖掉。 */
function settleFlowNodes(previousNodes, incoming) {
  const prev = Array.isArray(previousNodes) ? previousNodes : [];
  const used = new Set();
  const list = (incoming || []).map((n, index) => {
    const label = String((n && n.l) || '');
    const state = n && (n.s === 'done' || n.s === 'current' || n.s === 'todo') ? n.s : 'todo';
    let prevNode = null;
    if (n && n.id) prevNode = prev.find(x => x && x.id === n.id && !used.has(x));
    if (!prevNode && label) prevNode = prev.find(x => x && String(x.l) === label && !used.has(x));
    if (prevNode) used.add(prevNode);
    const id = String((n && n.id) || (prevNode && prevNode.id) || ('n' + hashKey(label + '#' + index)));
    const criterion = n && Object.prototype.hasOwnProperty.call(n, 'criterion')
      ? String(n.criterion || '')
      : (prevNode && prevNode.criterion ? String(prevNode.criterion) : '');
    const evidence = n && Object.prototype.hasOwnProperty.call(n, 'evidence')
      ? (Array.isArray(n.evidence) ? n.evidence.map(x => String(x)).filter(Boolean) : [])
      : (prevNode && Array.isArray(prevNode.evidence) ? prevNode.evidence.map(x => String(x)) : []);
    const dateKind = n && (n.dateKind === 'done' || n.dateKind === 'planned')
      ? n.dateKind
      : ((prevNode && (prevNode.dateKind === 'done' || prevNode.dateKind === 'planned')) ? prevNode.dateKind : '');
    const node = { id, l: label, s: state, d: String((n && n.d) || '') };
    if (criterion) node.criterion = criterion;
    if (evidence.length) node.evidence = evidence;
    if (dateKind) node.dateKind = dateKind;
    return node;
  });
  const hadCurrent = (previousNodes || []).some(n => n && n.s === 'current');
  const curCount = list.filter(n => n.s === 'current').length;
  let advanced = '';
  if (curCount === 0) {
    const firstOpen = list.find(n => n.s !== 'done');
    if (firstOpen) {
      firstOpen.s = 'current';
      if (hadCurrent) advanced = firstOpen.l;
    }
  } else if (curCount > 1) {
    let seen = false;
    list.forEach(n => {
      if (n.s !== 'current') return;
      if (seen) n.s = 'todo';
      seen = true;
    });
  }
  const total = list.length || 1;
  const done = list.filter(n => n.s === 'done').length;
  const cur = list.find(n => n.s === 'current');
  const last = list[list.length - 1] || {};
  return {
    nodes: list,
    flow: list.map(n => n.l),
    stage: cur ? cur.l : (last.l || ''),
    progress: Math.round(done / total * 100),
    advanced,
    total,
    done
  };
}

/* 阶段文案写回 migrate 会当成当前阶段的那个节点，避免重启后 stage 被旧节点名盖掉。
   已有「进行中」就只改它的名字。全是已完成时只改最后一个名字，不把完成态改回去。 */
function renameCurrentFlowNode(p, stage) {
  const label = String(stage || '').trim().slice(0, 80);
  if (!p || !label) return false;
  const nodes = (Array.isArray(p.nodes) ? p.nodes : [])
    .filter(n => n && n.l)
    .map(n => copyFlowNode(n))
    .filter(Boolean);
  if (!nodes.length) return false;
  const cur = nodes.find(n => n.s === 'current');
  if (cur) {
    cur.l = label;
  } else {
    const firstOpen = nodes.find(n => n.s !== 'done');
    if (firstOpen) {
      firstOpen.l = label;
      firstOpen.s = 'current';
    } else {
      nodes[nodes.length - 1].l = label;
    }
  }
  p.nodes = nodes;
  p.flow = nodes.map(n => n.l);
  p.stage = label;
  return true;
}

function parseProjectPlan(raw) {
  let items;
  if (typeof raw === 'string') items = raw.split(/\r?\n/);
  else if (Array.isArray(raw)) items = raw;
  else return { error: 'plan 必须是字符串数组，或按行分隔的文本' };
  const plan = [];
  for (const item of items) {
    const s = String(item == null ? '' : item).trim();
    if (!s) continue;
    plan.push(s.slice(0, 200));
  }
  if (plan.length > 40) return { error: '详细计划最多 40 条' };
  return { plan };
}

/* ==========================================================================
   项目管理闭环（界面与 API 共用）
   进度、周期、封面、负责人、材料索引、成果、活动归属。
   不复制源文件，不启动软件，不把无效进度写成 50。
   ========================================================================== */
const SCHEDULE_STATES = new Set(['unconfirmed', 'planned', 'active', 'done']);
const COVER_KINDS = new Set(['builtin', 'local_reference', 'none']);
const COVER_FITS = new Set(['contain', 'cover']);
const OUTCOME_STATUS = {
  draft: 'draft', review: 'review', confirmed: 'confirmed', submitted: 'submitted',
  '草稿': 'draft', '待复核': 'review', '已确认': 'confirmed', '已提交': 'submitted'
};
const OUTCOME_TYPES = {
  paper: 'paper', review: 'review', patent: 'patent', cad: 'cad', mesh: 'mesh',
  dataset: 'dataset', figure: 'figure', report: 'report', other: 'other',
  '论文': 'paper', '综述': 'review', '专利': 'patent', '模型': 'cad', '网格': 'mesh',
  '数据集': 'dataset', '图表': 'figure', '报告': 'report', '其他': 'other'
};
const SCAN_STATES = new Set(['unscanned', 'scanning', 'ok', 'empty', 'failed', 'junction_broken', 'excluded', 'stale']);
const OWNER_PLACEHOLDERS = new Set(['', '研究员', '我', '—', '-', '未指定', '待指定']);
const PROJECT_PATCH_KEYS = new Set([
  'project', 'id_only', 'dry_run', 'dryRun', 'revision', 'batch_id',
  'progress', 'progress_mode', 'progress_note',
  'stage', 'next_stage', 'goal', 'subtitle', 'intro', 'display_name', 'short_name',
  'folder', 'folder_name', 'nodes', 'plan', 'detailed_plan',
  'schedule', 'period', 'cover', 'owner', 'junction_target', 'suggested_tools',
  'link_outcome', 'update_outcome', 'unlink_outcome',
  'bind_software', 'unbind_software', 'material_scan'
]);

function hasOwn(obj, key) { return !!obj && Object.prototype.hasOwnProperty.call(obj, key); }

function shanghaiToday(now) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now || new Date());
  } catch (_) {
    const d = now || new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
}

function emptySchedule() {
  return { state: 'unconfirmed', planned_start: null, planned_end: null, actual_start: null, actual_end: null };
}

function cloneSchedule(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    state: SCHEDULE_STATES.has(s.state) ? s.state : 'unconfirmed',
    planned_start: s.planned_start || null,
    planned_end: s.planned_end || null,
    actual_start: s.actual_start || null,
    actual_end: s.actual_end || null
  };
}

function validISODate(raw) {
  if (raw == null || raw === '') return { value: null };
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { error: '必须是 YYYY-MM-DD，或 null 清空' };
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { error: '不是有效日期：' + s };
  }
  return { value: s };
}

function normalizeSchedule(raw, current) {
  if (raw === null) return { schedule: emptySchedule(), cleared: true };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'schedule 必须是对象或 null' };
  const next = cloneSchedule(current);
  if (hasOwn(raw, 'state')) {
    if (!SCHEDULE_STATES.has(raw.state)) return { error: 'schedule.state 只能是 unconfirmed、planned、active、done' };
    next.state = raw.state;
  }
  for (const key of ['planned_start', 'planned_end', 'actual_start', 'actual_end']) {
    if (!hasOwn(raw, key)) continue;
    const parsed = validISODate(raw[key]);
    if (parsed.error) return { error: key + '：' + parsed.error };
    next[key] = parsed.value;
  }
  const anyDate = next.planned_start || next.planned_end || next.actual_start || next.actual_end;
  if (next.state === 'unconfirmed' && anyDate) {
    return { error: '周期未核定时不能带起止日期。请把 state 设为 planned、active 或 done，或把日期传 null' };
  }
  if (next.state === 'unconfirmed') {
    next.planned_start = null;
    next.planned_end = null;
    next.actual_start = null;
    next.actual_end = null;
  }
  return { schedule: next };
}

function scheduleView(p) {
  const schedule = cloneSchedule(p && p.schedule);
  const legacy = String((p && (p.periodLegacy || p.period)) || '').trim();
  const dated = schedule.state !== 'unconfirmed' && (schedule.planned_start || schedule.planned_end || schedule.actual_start || schedule.actual_end);
  let label = '周期待确认';
  if (schedule.state === 'planned' && dated) label = '已计划 ' + [schedule.planned_start, schedule.planned_end].filter(Boolean).join(' — ');
  else if (schedule.state === 'active' && dated) label = '进行中 ' + [schedule.actual_start || schedule.planned_start, schedule.planned_end].filter(Boolean).join(' — ');
  else if (schedule.state === 'done' && dated) label = '已完成 ' + [schedule.actual_start, schedule.actual_end].filter(Boolean).join(' — ');
  else if (schedule.state === 'planned') label = '已计划（日期未填全）';
  else if (schedule.state === 'active') label = '进行中（日期未填全）';
  else if (schedule.state === 'done') label = '已完成（日期未填全）';
  return { schedule, label, legacy: legacy && legacy !== '—' ? legacy : '', confirmed: schedule.state !== 'unconfirmed' && !!dated };
}

function normalizeCover(raw) {
  if (raw === null) return { cover: { kind: 'builtin', resource: '', alt: '', fit: 'contain', focus: '' }, cleared: true };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'cover 必须是对象或 null' };
  const kind = String(raw.kind || raw.type || 'builtin');
  if (!COVER_KINDS.has(kind)) return { error: 'cover.kind 只能是 builtin、local_reference 或 none' };
  const fit = String(raw.fit || 'contain');
  if (!COVER_FITS.has(fit)) return { error: 'cover.fit 只能是 contain 或 cover' };
  const resource = String(raw.resource != null ? raw.resource : (raw.resource_id != null ? raw.resource_id : (raw.path != null ? raw.path : ''))).trim();
  if (kind === 'local_reference' && !resource) return { error: '本地封面需要 resource 路径。接口不上传图片' };
  if (/^https?:\/\//i.test(resource)) return { error: '封面只接受本地路径，不会发到网络' };
  return {
    cover: {
      kind,
      resource,
      alt: String(raw.alt || '').trim().slice(0, 200),
      fit,
      focus: String(raw.focus || '').trim().slice(0, 40)
    }
  };
}

function coverView(p) {
  const c = p && p.cover && typeof p.cover === 'object' ? p.cover : {};
  const kind = COVER_KINDS.has(c.kind) ? c.kind : 'builtin';
  const resource = String(c.resource || '');
  const unavailable = kind === 'local_reference' && !resource;
  return {
    kind,
    resource,
    alt: String(c.alt || ''),
    fit: COVER_FITS.has(c.fit) ? c.fit : 'contain',
    focus: String(c.focus || ''),
    thumb: (p && p.thumb) || 'cfd',
    unavailable
  };
}

function milestoneStats(p) {
  const nodes = Array.isArray(p && p.nodes) ? p.nodes.filter(n => n && n.l) : [];
  const total = nodes.length;
  const done = nodes.filter(n => n.s === 'done').length;
  if (!total) {
    return { done: 0, total: 0, percent: null, unknown: true, label: '进度未知（没有里程碑）', basis: '没有节点，不记为 0%' };
  }
  const percent = Math.round(done / total * 100);
  return {
    done, total, percent, unknown: false,
    label: `里程碑 ${done}/${total}，约 ${percent}%`,
    basis: '等权：已完成节点数 / 总节点数。节点完成表示该节点交付标准已满足，不是整个课题结论已验证'
  };
}

function ownerView(p) {
  const owner = (p && p.owner) || {};
  const name = String(owner.n || '').trim();
  const confirmed = owner.confirmed === true && !OWNER_PLACEHOLDERS.has(name);
  const placeholder = !name || OWNER_PLACEHOLDERS.has(name) || owner.confirmed === false;
  const members = Array.isArray(p && p.members) ? p.members : [];
  const confirmedMembers = members.filter(m => m && m.confirmed === true && !OWNER_PLACEHOLDERS.has(String(m.n || '').trim()));
  return {
    name: confirmed ? name : (placeholder ? '' : name),
    label: placeholder || !name ? '待指定' : (confirmed ? name : name),
    confirmed: !!confirmed,
    pending: !confirmed,
    role: placeholder ? '' : String(owner.r || ''),
    agent: String(owner.agent || ''),
    confirmed_count: confirmedMembers.length + (confirmed ? 0 : 0),
    note: placeholder || !name ? '尚未绑定具体人员，默认称呼不计入已确认成员' : (confirmed ? '' : '姓名未标记为已确认，不计入已确认成员数')
  };
}

function materialDirExcluded(name) {
  return /曹妃甸|rag[_-]?snowz|RAG引擎|知识库引擎/i.test(String(name || ''));
}

function materialStatusView(projectId) {
  const registeredFiles = typeof materialsIn === 'function' ? materialsIn(projectId).length : 0;
  const registeredDirs = typeof projectFolderCount === 'function' ? projectFolderCount(projectId) : 0;
  const scan = (DB && DB.materialScans && DB.materialScans[projectId]) || {};
  const state = SCAN_STATES.has(scan.state) ? scan.state : 'unscanned';
  const outcomes = typeof outcomesForProject === 'function' ? outcomesForProject(projectId).length : 0;
  let label = '已关联目录，尚未建立材料索引';
  if (state === 'scanning') label = '正在更新材料列表';
  else if (state === 'empty') label = '此目录当前没有符合条件的文件';
  else if (state === 'ok') label = `已发现 ${Number(scan.files) || 0} 项，关联成果 ${outcomes} 项`;
  else if (state === 'failed') label = scan.error ? `无法读取目录：${scan.error}` : '无法读取目录，请检查路径或权限';
  else if (state === 'junction_broken') label = '原位关联目标不可用';
  else if (state === 'excluded') label = '该目录按隐私规则跳过';
  else if (state === 'stale') label = '材料可能已变化，可刷新';
  const proj = typeof P === 'function' ? P(projectId) : null;
  return {
    state,
    label,
    registered_files: registeredFiles,
    registered_dirs: registeredDirs,
    scanned_files: (state === 'ok' || state === 'empty' || state === 'stale') ? (Number(scan.files) || 0) : null,
    error: scan.error || '',
    entry: proj ? (proj.folder || proj.name || '') : '',
    target: (proj && proj.junctionTarget) || scan.target || '',
    at: scan.at || ''
  };
}

const UNSCHEDULED_DUE = /^(待确认|待定|未设置|待排期|—|-|无|tbd|n\/a)?$/i;

function parseTaskDate(raw, today) {
  const s = String(raw == null ? '' : raw).trim();
  const day = today || shanghaiToday();
  if (!s || UNSCHEDULED_DUE.test(s)) return { kind: 'unscheduled', label: '待排期', iso: '' };
  if (/今天|今日/.test(s)) return { kind: 'today', label: '今天到期', iso: day };
  let iso = '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (!iso) {
    m = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
    if (m) iso = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  if (!iso) {
    m = s.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) iso = `${day.slice(0, 4)}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  if (!iso) return { kind: 'unscheduled', label: '待排期', iso: '', raw: s };
  const check = validISODate(iso);
  if (check.error) return { kind: 'unscheduled', label: '待排期', iso: '', raw: s };
  if (iso === day) return { kind: 'today', label: '今天到期', iso };
  if (iso < day) return { kind: 'overdue', label: '逾期 ' + iso, iso };
  return { kind: 'future', label: iso, iso };
}

function taskScheduleStats(tasks, now) {
  const today = shanghaiToday(now);
  const list = Array.isArray(tasks) ? tasks : [];
  const stats = { open: 0, dueToday: 0, overdue: 0, unscheduled: 0, scheduled: 0, done: 0, today, scope: '未完成项目任务。今日到期按 Asia/Shanghai。待排期不计入今日到期。' };
  list.forEach(t => {
    if (!t) return;
    if (t.st === 'done') { stats.done += 1; return; }
    stats.open += 1;
    const due = parseTaskDate(t.due, today);
    if (due.kind === 'today') stats.dueToday += 1;
    else if (due.kind === 'overdue') stats.overdue += 1;
    else if (due.kind === 'future') stats.scheduled += 1;
    else stats.unscheduled += 1;
  });
  return stats;
}

function outcomesForProject(projectId) {
  const all = (DB && Array.isArray(DB.outcomes)) ? DB.outcomes : [];
  return all.filter(o => o && Array.isArray(o.project_ids) && o.project_ids.includes(projectId));
}

function todosForProject(projectId) {
  return (DB && Array.isArray(DB.todos) ? DB.todos : []).filter(t => t && t.projectId && t.projectId === projectId);
}

function globalTodos() {
  return (DB && Array.isArray(DB.todos) ? DB.todos : []).filter(t => t && !t.projectId);
}

function activityPlain(a) {
  return String((a && (a.t || a.text)) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function activitiesForProject(projectId) {
  return (DB && Array.isArray(DB.activities) ? DB.activities : []).filter(a => {
    if (!a || !a.projectId || a.projectId !== projectId) return false;
    if (a.kind === 'switch' || a.kind === 'nav' || a.kind === 'view') return false;
    return !/切换工作区|进入项目|当前工作区/.test(activityPlain(a));
  });
}

function groupActivities(list) {
  const groups = [];
  const byBatch = new Map();
  (list || []).forEach(a => {
    const batch = a && a.batchId ? String(a.batchId) : '';
    if (batch) {
      if (!byBatch.has(batch)) {
        const g = { batchId: batch, projectId: a.projectId || '', items: [] };
        byBatch.set(batch, g);
        groups.push(g);
      }
      byBatch.get(batch).items.push(a);
    } else {
      groups.push({ batchId: '', projectId: (a && a.projectId) || '', items: [a] });
    }
  });
  groups.forEach(g => {
    if (g.items.length < 2) {
      g.summary = activityPlain(g.items[0]);
      return;
    }
    const creates = g.items.filter(i => /新建任务|新增任务|创建任务/.test(activityPlain(i))).length;
    g.summary = creates
      ? `项目资料已更新，新增 ${creates} 项任务`
      : `一批更新（${g.items.length} 条，可展开）`;
  });
  return groups;
}

function newOutcomeId() {
  return 'oc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function publicOutcome(o) {
  if (!o) return null;
  return {
    id: o.id,
    project_ids: (o.project_ids || []).slice(),
    type: o.type || 'other',
    title: o.title || '',
    file: o.file || '',
    version: o.version || '',
    status: o.status || 'draft',
    note: o.note || '',
    source: o.source || '',
    current: o.current !== false,
    previous_id: o.previous_id || '',
    updated_at: o.updated_at || ''
  };
}

function ensureOutcomeStore() {
  if (!DB.outcomes || !Array.isArray(DB.outcomes)) DB.outcomes = [];
  if (!DB.materialScans || typeof DB.materialScans !== 'object') DB.materialScans = {};
}

function linkOutcomeRecord(project, spec) {
  ensureOutcomeStore();
  if (!spec || typeof spec !== 'object') return { error: 'link_outcome 必须是对象' };
  const key = String(spec.idempotency_key || spec.client_key || '').trim();
  if (key) {
    const exist = DB.outcomes.find(o => o && o.idempotency_key === key);
    if (exist) {
      if (!exist.project_ids.includes(project.id)) exist.project_ids.push(project.id);
      return { outcome: exist, created: false };
    }
  }
  const title = String(spec.title || '').trim();
  const file = String(spec.file || spec.path || '').trim();
  if (!title) return { error: '关联成果需要 title' };
  if (!file) return { error: '关联成果需要原位 file 路径，不会复制或上传文件' };
  const type = OUTCOME_TYPES[String(spec.type || 'other')] || 'other';
  const status = OUTCOME_STATUS[String(spec.status || 'draft')] || '';
  if (!status) return { error: '成果状态只能是草稿、待复核、已确认、已提交' };
  const same = DB.outcomes.find(o => o && o.file === file && o.title === title && (o.project_ids || []).includes(project.id));
  if (same) return { outcome: same, created: false };
  const outcome = {
    id: spec.id ? String(spec.id) : newOutcomeId(),
    idempotency_key: key,
    project_ids: [project.id],
    type, title, file,
    version: String(spec.version || '').slice(0, 80),
    status,
    note: String(spec.note || spec.evidence || '').slice(0, 500),
    source: String(spec.source || 'linked').slice(0, 80),
    current: spec.current !== false,
    previous_id: spec.previous_id ? String(spec.previous_id) : '',
    updated_at: new Date().toISOString()
  };
  if (outcome.previous_id) {
    const prev = DB.outcomes.find(o => o.id === outcome.previous_id);
    if (prev && outcome.current) prev.current = false;
  }
  DB.outcomes.unshift(outcome);
  return { outcome, created: true };
}

function updateOutcomeRecord(project, spec) {
  ensureOutcomeStore();
  if (!spec || !spec.id) return { error: 'update_outcome 需要 id' };
  const outcome = DB.outcomes.find(o => o.id === spec.id);
  if (!outcome) return { error: `未找到成果 ${spec.id}` };
  if (spec.title != null) outcome.title = String(spec.title).trim().slice(0, 200);
  if (spec.file != null || spec.path != null) outcome.file = String(spec.file != null ? spec.file : spec.path).trim();
  if (spec.type != null) {
    const type = OUTCOME_TYPES[String(spec.type)];
    if (!type) return { error: '成果类型无法识别' };
    outcome.type = type;
  }
  if (spec.status != null) {
    const status = OUTCOME_STATUS[String(spec.status)];
    if (!status) return { error: '成果状态只能是草稿、待复核、已确认、已提交' };
    outcome.status = status;
  }
  if (spec.version != null) outcome.version = String(spec.version).slice(0, 80);
  if (spec.note != null) outcome.note = String(spec.note).slice(0, 500);
  if (spec.current != null) outcome.current = !!spec.current;
  if (spec.previous_id != null) outcome.previous_id = String(spec.previous_id || '');
  if (outcome.current && outcome.previous_id) {
    const prev = DB.outcomes.find(o => o.id === outcome.previous_id);
    if (prev) prev.current = false;
  }
  if (!(outcome.project_ids || []).includes(project.id)) outcome.project_ids.push(project.id);
  outcome.updated_at = new Date().toISOString();
  return { outcome, created: false };
}

function unlinkOutcomeRecord(project, spec) {
  ensureOutcomeStore();
  const id = spec && (spec.id || spec);
  const outcome = DB.outcomes.find(o => o.id === id);
  if (!outcome) return { error: `未找到成果 ${id}` };
  outcome.project_ids = (outcome.project_ids || []).filter(x => x !== project.id);
  return { outcome, unlinked: true, file_kept: true, file: outcome.file || '' };
}

function bindSoftwareRecord(project, spec) {
  if (!spec || typeof spec !== 'object') return { error: 'bind_software 必须是对象' };
  const name = String(spec.name || '').trim();
  if (!name) return { error: 'bind_software 需要 name' };
  if (!Array.isArray(DB.apps)) DB.apps = [];
  let app = DB.apps.find(a => a && (a.n === name || a.displayName === name));
  if (!app) {
    app = {
      n: name, displayName: name, ico: name.slice(0, 2),
      kind: 'ref', args: [], cwd: '', path: '', icon: '',
      source: 'binding', run: null, bound: project.id, pending: false,
      available: 'unknown'
    };
    DB.apps.push(app);
  }
  app.bound = project.id;
  app.run = null;
  if (spec.path != null) app.path = String(spec.path);
  if (spec.available != null) {
    const ok = ['unknown', 'ready', 'missing'].includes(spec.available) ? spec.available : '';
    if (!ok) return { error: 'software.available 只能是 unknown、ready、missing' };
    app.available = ok;
  } else if (!app.available) app.available = 'unknown';
  return { app, launched: false };
}

function normalizeMaterialScan(project, raw) {
  if (!raw || typeof raw !== 'object') return { error: 'material_scan 必须是对象' };
  const state = String(raw.state || '');
  if (!SCAN_STATES.has(state) || state === 'unscanned') {
    return { error: 'material_scan.state 只能是 scanning、ok、empty、failed、junction_broken、excluded、stale' };
  }
  const filesIn = Array.isArray(raw.dirs) ? raw.dirs : [];
  let files = 0;
  let excluded = 0;
  const seen = new Set();
  filesIn.forEach(d => {
    const name = String((d && (d.dir || d.name)) || '');
    if (materialDirExcluded(name) || (d && d.excluded)) { excluded += 1; return; }
    const target = String((d && (d.target || d.real)) || name);
    if (target && seen.has(target)) return;
    if (target) seen.add(target);
    if (d && d.junction_broken) return;
    files += Number(d && (d.count != null ? d.count : (Array.isArray(d.files) ? d.files.length : 0))) || 0;
  });
  if (!filesIn.length && raw.files != null) files = Math.max(0, Number(raw.files) || 0);
  let nextState = state;
  if ((state === 'ok' || state === 'scanning') && files === 0 && excluded > 0 && !raw.error) nextState = 'excluded';
  else if ((state === 'ok' || state === 'scanning') && files === 0 && excluded === 0 && !raw.error) nextState = 'empty';
  if (state === 'failed' && !raw.error) return { error: '扫描失败时必须给出 error' };
  return {
    scan: {
      state: nextState,
      files,
      dirs: filesIn.length,
      excluded,
      error: String(raw.error || ''),
      target: String(raw.target || ''),
      at: new Date().toISOString()
    }
  };
}

function milestoneProgressChange(before, after) {
  if (!before || !after || before.unknown || after.unknown) return null;
  if (before.done === after.done && before.total === after.total) return null;
  const direction = after.percent < before.percent ? '比例下降' : (after.percent > before.percent ? '比例上升' : '比例不变');
  return {
    from: { done: before.done, total: before.total, percent: before.percent },
    to: { done: after.done, total: after.total, percent: after.percent },
    reason: `节点由 ${before.total} 个变为 ${after.total} 个，已完成 ${before.done} → ${after.done}。等权${direction}（${before.percent}% → ${after.percent}%）。这是里程碑口径变化，不是科研结论倒退或推进。`
  };
}

function applyProjectPatch(p, args, opts) {
  const dry = !!(opts && opts.dryRun);
  if (!p) return { ok: false, code: 'not_found', error: '项目不存在' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: '请求体必须是对象' };
  const unknown = Object.keys(args).filter(k => !PROJECT_PATCH_KEYS.has(k));
  if (unknown.length) {
    return { ok: false, code: 'invalid', error: `未识别字段：${unknown.join('、')}。未写入`, unknown_fields: unknown };
  }
  if (hasOwn(args, 'revision')) {
    const cur = p.revision || 1;
    if (String(args.revision) !== String(cur)) {
      return {
        ok: false, code: 'conflict', saved: false,
        error: `修订冲突：当前修订是 ${cur}，请求写的是 ${args.revision}。未覆盖新内容`,
        revision: cur
      };
    }
  }
  const errors = [];
  const has = (k) => hasOwn(args, k);
  let progressRejected = false;
  let nextProgress = null;
  if (has('progress')) {
    if (args.progress == null) {
      progressRejected = true;
      errors.push('进度 null 不能当清空。要回到自动里程碑请传 progress_mode:"auto"；要写百分比请传 0–100 的整数');
    } else {
      const v = parseProjectProgress(args.progress);
      if (v == null) {
        progressRejected = true;
        errors.push('进度不是 0–100 的有效数字，未保存（不会改成 50%）');
      } else nextProgress = v;
    }
  }
  let settled = null;
  if (has('nodes')) {
    const parsed = parseFlowNodes(args.nodes);
    if (parsed.error) errors.push(parsed.error);
    else settled = settleFlowNodes(p.nodes, parsed.nodes);
  }
  let nextFolder = null;
  if (has('folder') || has('folder_name')) {
    const fromFolder = has('folder') ? parseProjectFolder(args.folder) : null;
    const fromName = has('folder_name') ? parseProjectFolder(args.folder_name) : null;
    if (fromFolder && fromFolder.error) errors.push(fromFolder.error);
    if (fromName && fromName.error) errors.push(fromName.error);
    if (fromFolder && fromName && !fromFolder.error && !fromName.error && fromFolder.folder !== fromName.folder) {
      errors.push('folder 与 folder_name 不一致');
    }
    if (fromFolder && !fromFolder.error || fromName && !fromName.error) {
      nextFolder = ((fromFolder && !fromFolder.error) ? fromFolder : fromName).folder;
      if (DB.projects.some(x => x.id !== p.id && (x.folder || x.name) === nextFolder)) {
        errors.push(`工作区里已有文件夹「${nextFolder}」，请换一个相对名`);
      }
    }
  }
  let nextPlan = null;
  if (has('plan') || has('detailed_plan')) {
    const fromPlan = has('plan') ? parseProjectPlan(args.plan) : null;
    const fromAlias = has('detailed_plan') ? parseProjectPlan(args.detailed_plan) : null;
    if (fromPlan && fromPlan.error) errors.push(fromPlan.error);
    if (fromAlias && fromAlias.error) errors.push(fromAlias.error);
    if (fromPlan && fromAlias && !fromPlan.error && !fromAlias.error && JSON.stringify(fromPlan.plan) !== JSON.stringify(fromAlias.plan)) {
      errors.push('plan 与 detailed_plan 不一致');
    }
    if ((fromPlan && !fromPlan.error) || (fromAlias && !fromAlias.error)) nextPlan = (fromPlan && !fromPlan.error ? fromPlan : fromAlias).plan;
  }
  let nextSchedule = null;
  if (has('schedule')) {
    const parsed = normalizeSchedule(args.schedule, p.schedule);
    if (parsed.error) errors.push(parsed.error);
    else nextSchedule = parsed.schedule;
  }
  let clearPeriod = false;
  let nextPeriod = null;
  if (has('period')) {
    if (args.period == null || String(args.period).trim() === '' || String(args.period).trim() === '—') {
      clearPeriod = true;
      if (!nextSchedule) nextSchedule = emptySchedule();
    } else {
      nextPeriod = String(args.period).trim().slice(0, 80);
      if (!has('schedule')) {
        errors.push('period 文本不能当成已核定周期。请改传 schedule（state 与 YYYY-MM-DD），或传空字符串只做清空');
      }
    }
  }
  let nextCover = null;
  if (has('cover')) {
    const parsed = normalizeCover(args.cover);
    if (parsed.error) errors.push(parsed.error);
    else nextCover = parsed.cover;
  }
  let progressMode = null;
  let progressNote = null;
  if (has('progress_mode')) {
    if (args.progress_mode !== 'auto' && args.progress_mode !== 'manual') errors.push('progress_mode 只能是 auto 或 manual');
    else progressMode = args.progress_mode;
  }
  if (has('progress_note')) progressNote = String(args.progress_note == null ? '' : args.progress_note).trim().slice(0, 400);
  if (progressMode === 'manual') {
    const note = progressNote != null ? progressNote : String(p.progressNote || '').trim();
    if (!note) errors.push('手动进度必须填写 progress_note，不能无说明覆盖自动里程碑');
    if (nextProgress == null && !(typeof p.progress === 'number' && Number.isFinite(p.progress))) {
      errors.push('手动进度需要一个 0–100 的整数');
    }
  }
  let nextOwner = null;
  if (has('owner')) {
    if (args.owner === null) nextOwner = { n: '', r: '', agent: '', confirmed: false };
    else if (!args.owner || typeof args.owner !== 'object') errors.push('owner 必须是对象或 null');
    else {
      const name = String(args.owner.name != null ? args.owner.name : (args.owner.n || '')).trim();
      nextOwner = {
        n: name,
        r: String(args.owner.role != null ? args.owner.role : (args.owner.r || '')).trim(),
        agent: String(args.owner.agent || '').trim(),
        confirmed: args.owner.confirmed === true && !!name && !OWNER_PLACEHOLDERS.has(name)
      };
    }
  }
  let nextTools = null;
  if (has('suggested_tools')) {
    if (!Array.isArray(args.suggested_tools)) errors.push('suggested_tools 必须是字符串数组');
    else nextTools = args.suggested_tools.map(x => String(x || '').trim()).filter(Boolean).slice(0, 40);
  }
  let junction = null;
  if (has('junction_target')) {
    if (args.junction_target == null || String(args.junction_target).trim() === '') junction = '';
    else junction = String(args.junction_target).trim().slice(0, 260);
  }
  const stageText = has('stage') ? String(args.stage == null ? '' : args.stage).trim() : '';
  if (has('stage') && !stageText) errors.push('stage 为空不会改当前阶段。要改节点请传 nodes');

  if (errors.length || progressRejected) {
    return {
      ok: false,
      code: 'invalid',
      saved: false,
      error: errors[0] || '进度不是 0–100 的有效数字，未保存（不会改成 50%）',
      errors,
      progress_unchanged: progressRejected,
      unknown_fields: []
    };
  }

  const beforeMile = milestoneStats(p);
  const changed = [];
  const changes = [];
  const warnings = [];
  let outcomeResult = null;
  let softwareResult = null;
  let scanResult = null;

  const will = settled || nextFolder != null || nextPlan != null || nextProgress != null
    || stageText || has('next_stage') || has('goal') || has('subtitle') || has('intro')
    || has('display_name') || has('short_name') || nextSchedule || nextCover || nextOwner
    || nextTools || junction != null || progressMode
    || has('link_outcome') || has('update_outcome') || has('unlink_outcome')
    || has('bind_software') || has('unbind_software') || has('material_scan')
    || clearPeriod;
  if (!will) return { ok: false, saved: false, error: '没有提供任何要修改的字段' };

  if (has('link_outcome')) {
    const spec = args.link_outcome;
    if (!spec || typeof spec !== 'object' || !String(spec.title || '').trim() || !String(spec.file || spec.path || '').trim()) {
      return { ok: false, code: 'invalid', saved: false, error: '关联成果需要 title 和原位 file，不会复制或上传' };
    }
  }
  if (has('update_outcome')) {
    if (!args.update_outcome || !args.update_outcome.id) return { ok: false, code: 'invalid', saved: false, error: 'update_outcome 需要 id' };
    ensureOutcomeStore();
    if (!DB.outcomes.find(o => o.id === args.update_outcome.id)) {
      return { ok: false, code: 'invalid', saved: false, error: `未找到成果 ${args.update_outcome.id}` };
    }
  }
  if (has('unlink_outcome')) {
    const id = args.unlink_outcome && (args.unlink_outcome.id || args.unlink_outcome);
    if (!id) return { ok: false, code: 'invalid', saved: false, error: 'unlink_outcome 需要 id' };
    ensureOutcomeStore();
    if (!DB.outcomes.find(o => o.id === id)) return { ok: false, code: 'invalid', saved: false, error: `未找到成果 ${id}` };
  }
  if (has('bind_software')) {
    if (!args.bind_software || !String(args.bind_software.name || '').trim()) {
      return { ok: false, code: 'invalid', saved: false, error: 'bind_software 需要 name。绑定不会启动程序' };
    }
  }
  if (has('unbind_software')) {
    const name = String((args.unbind_software && args.unbind_software.name) || args.unbind_software || '').trim();
    const app = (DB.apps || []).find(a => a && (a.n === name || a.displayName === name) && a.bound === p.id);
    if (!app) return { ok: false, code: 'invalid', saved: false, error: `本项目没有绑定软件「${name}」` };
  }
  if (has('material_scan')) {
    scanResult = normalizeMaterialScan(p, args.material_scan);
    if (scanResult.error) return { ok: false, code: 'invalid', saved: false, error: scanResult.error };
  }

  if (dry) {
    const diff = {};
    if (settled) diff.nodes = settled.nodes.map(n => n.l);
    if (nextFolder != null) diff.folder = nextFolder;
    if (nextPlan != null) diff.plan = nextPlan;
    if (nextProgress != null) diff.progress = nextProgress;
    if (stageText) diff.stage = stageText;
    if (has('next_stage')) diff.next_stage = String(args.next_stage == null ? '' : args.next_stage);
    if (has('goal')) diff.goal = String(args.goal == null ? '' : args.goal);
    if (has('subtitle')) diff.subtitle = String(args.subtitle == null ? '' : args.subtitle);
    if (has('intro')) diff.intro = String(args.intro == null ? '' : args.intro);
    if (has('display_name')) diff.display_name = String(args.display_name == null ? '' : args.display_name);
    if (has('short_name')) diff.short_name = String(args.short_name == null ? '' : args.short_name);
    if (nextSchedule) diff.schedule = nextSchedule;
    if (nextCover) diff.cover = nextCover;
    if (nextOwner) diff.owner = nextOwner;
    if (nextTools) diff.suggested_tools = nextTools;
    if (junction != null) diff.junction_target = junction;
    if (progressMode) diff.progress_mode = progressMode;
    if (outcomeResult) diff.outcome = publicOutcome(outcomeResult.outcome);
    if (softwareResult) diff.software = { name: softwareResult.app.n, bound: has('unbind_software') ? '' : p.id, launched: false };
    if (scanResult) diff.material_scan = scanResult.scan;
    if (has('link_outcome')) diff.link_outcome = { title: String(args.link_outcome.title || ''), file: String(args.link_outcome.file || args.link_outcome.path || '') };
    if (has('update_outcome')) diff.update_outcome = args.update_outcome.id;
    if (has('unlink_outcome')) diff.unlink_outcome = (args.unlink_outcome && args.unlink_outcome.id) || args.unlink_outcome;
    if (has('bind_software')) diff.bind_software = { name: String(args.bind_software.name), launched: false };
    if (has('unbind_software')) diff.unbind_software = String((args.unbind_software && args.unbind_software.name) || args.unbind_software || '');
    return {
      ok: true, dryRun: true, saved: false, project_id: p.id,
      changed_fields: Object.keys(diff),
      diff, warnings, revision: p.revision || 1,
      message: '预览：已完成校验和差异计算，项目、任务、修订和磁盘都没有改'
    };
  }

  const beforeProgress = p.progress;
  if (has('link_outcome')) {
    outcomeResult = linkOutcomeRecord(p, args.link_outcome);
    if (outcomeResult.error) return { ok: false, code: 'invalid', saved: false, error: outcomeResult.error };
  }
  if (has('update_outcome')) {
    outcomeResult = updateOutcomeRecord(p, args.update_outcome);
    if (outcomeResult.error) return { ok: false, code: 'invalid', saved: false, error: outcomeResult.error };
  }
  if (has('unlink_outcome')) {
    outcomeResult = unlinkOutcomeRecord(p, args.unlink_outcome);
    if (outcomeResult.error) return { ok: false, code: 'invalid', saved: false, error: outcomeResult.error };
  }
  if (has('bind_software')) {
    softwareResult = bindSoftwareRecord(p, args.bind_software);
    if (softwareResult.error) return { ok: false, code: 'invalid', saved: false, error: softwareResult.error };
  }
  if (has('unbind_software')) {
    const name = String((args.unbind_software && args.unbind_software.name) || args.unbind_software || '').trim();
    const app = (DB.apps || []).find(a => a && (a.n === name || a.displayName === name) && a.bound === p.id);
    softwareResult = { app, name };
  }
  if (settled) {
    p.nodes = settled.nodes;
    p.flow = settled.flow;
    p.stage = settled.stage || p.stage;
    const modeNow = progressMode || p.progressMode || 'auto';
    if (modeNow !== 'manual' && nextProgress == null) p.progress = settled.progress;
    changed.push('nodes');
    changes.push(`流程节点→${settled.nodes.length} 个`);
  }
  if (stageText) {
    const renamed = renameCurrentFlowNode(p, stageText);
    if (!renamed) p.stage = stageText;
    changed.push('stage');
    changes.push(`当前阶段→${p.stage}`);
  }
  if (progressMode === 'auto') {
    p.progressMode = 'auto';
    p.progressNote = '';
    if (nextProgress == null && !settled) {
      const mile = milestoneStats(p);
      if (!mile.unknown && mile.percent != null) p.progress = mile.percent;
    }
    changed.push('progress_mode');
    changes.push('进度改为自动里程碑');
  }
  if (progressMode === 'manual') {
    p.progressMode = 'manual';
    p.progressNote = progressNote != null ? progressNote : String(p.progressNote || '');
    changed.push('progress_mode');
    changes.push('进度改为手动');
  } else if (progressNote != null && p.progressMode === 'manual') {
    p.progressNote = progressNote;
    changed.push('progress_note');
  }
  if (nextProgress != null) {
    p.progress = nextProgress;
    changed.push('progress');
    changes.push(`进度→${nextProgress}%`);
    if (!progressMode && p.progressMode !== 'manual') {
      warnings.push('写入了显式百分比，但没有 progress_mode:"manual"。下次只改节点时，自动模式仍会按里程碑重算');
    }
  }
  if (has('next_stage')) {
    p.next = String(args.next_stage == null ? '' : args.next_stage).trim().slice(0, 200);
    changed.push('next_stage');
    changes.push(`下一阶段→${p.next || '（空）'}`);
  }
  if (has('goal')) {
    p.goal = String(args.goal == null ? '' : args.goal).trim().slice(0, 2000);
    changed.push('goal');
    changes.push('研究目标已更新');
  }
  if (has('subtitle')) {
    p.subtitle = String(args.subtitle == null ? '' : args.subtitle).trim().slice(0, 400);
    changed.push('subtitle');
    changes.push('描述已更新');
  }
  if (has('intro')) {
    p.intro = String(args.intro == null ? '' : args.intro).trim().slice(0, 4000);
    changed.push('intro');
    changes.push('长简介已更新');
  }
  if (nextFolder != null) {
    p.folder = nextFolder;
    changed.push('folder');
    changes.push(`文件夹→${nextFolder}`);
  }
  if (nextPlan != null) {
    p.plan = nextPlan;
    changed.push('plan');
    changes.push(nextPlan.length ? `详细计划→${nextPlan.length} 条` : '详细计划已清空');
  }
  if (has('display_name')) {
    const dn = String(args.display_name == null ? '' : args.display_name).trim().slice(0, 80);
    if (!dn || dn === p.name) { delete p.displayName; changes.push('显示名恢复为项目名称'); }
    else { p.displayName = dn; changes.push('显示名已更新'); }
    changed.push('display_name');
  }
  if (has('short_name')) {
    const sn = String(args.short_name == null ? '' : args.short_name).trim().slice(0, 40);
    if (!sn) delete p.shortName;
    else p.shortName = sn;
    changed.push('short_name');
    changes.push(sn ? '短名称已更新' : '短名称已清空');
  }
  if (nextSchedule) {
    p.schedule = nextSchedule;
    changed.push('schedule');
    changes.push(scheduleView(p).label);
  }
  if (clearPeriod) {
    p.period = '';
    p.periodLegacy = '';
    changed.push('period');
  } else if (nextPeriod != null) {
    p.periodLegacy = nextPeriod;
    p.period = nextPeriod;
    changed.push('period');
    warnings.push('period 只作为历史文本保留，界面以 schedule 为准');
  }
  if (nextCover) {
    p.cover = nextCover;
    changed.push('cover');
    changes.push(nextCover.kind === 'builtin' ? '封面恢复为类型占位' : '封面已更新');
  }
  if (nextOwner) {
    p.owner = nextOwner;
    changed.push('owner');
    changes.push(nextOwner.confirmed ? `负责人→${nextOwner.n}` : '负责人改为待指定');
  }
  if (nextTools) {
    p.tools = nextTools;
    changed.push('suggested_tools');
    changes.push(nextTools.length ? `建议软件→${nextTools.length} 个（未绑定、未启动）` : '建议软件已清空');
  }
  if (junction != null) {
    p.junctionTarget = junction;
    changed.push('junction_target');
    changes.push(junction ? '记录了联接目标（不复制文件）' : '联接目标已清空');
  }
  if (outcomeResult) {
    changed.push(has('unlink_outcome') ? 'unlink_outcome' : 'outcome');
    changes.push(outcomeResult.unlinked ? '已取消成果关联（磁盘文件保留）' : (outcomeResult.created ? '已关联成果' : '成果关联已存在'));
  }
  if (softwareResult && has('unbind_software')) {
    softwareResult.app.bound = '';
    softwareResult.app.run = null;
    changed.push('unbind_software');
    changes.push(`已解除软件绑定「${softwareResult.app.n}」（未启动）`);
  } else if (softwareResult) {
    changed.push('bind_software');
    changes.push(`已绑定软件「${softwareResult.app.n}」（未启动）`);
  }
  if (scanResult) {
    ensureOutcomeStore();
    DB.materialScans[p.id] = scanResult.scan;
    if (scanResult.scan.target && !p.junctionTarget) p.junctionTarget = scanResult.scan.target;
    changed.push('material_scan');
    changes.push(materialStatusView(p.id).label);
  }

  const afterMile = milestoneStats(p);
  let progressChange = null;
  if (settled || progressMode === 'auto') progressChange = milestoneProgressChange(beforeMile, afterMile);
  if (progressChange) {
    p.progressChange = progressChange.reason;
    warnings.push(progressChange.reason);
    if ((progressMode || p.progressMode) === 'manual' && beforeProgress === p.progress) {
      warnings.push('手动百分比未改。上面的比例变化只说明里程碑口径，不是工作倒退。');
    }
  }

  p.revision = (p.revision || 1) + 1;
  return {
    ok: true,
    saved: false,
    project_id: p.id,
    changed_fields: [...new Set(changed)],
    changes,
    warnings,
    revision: p.revision,
    progress_change: progressChange,
    outcome: outcomeResult ? publicOutcome(outcomeResult.outcome) : undefined,
    launched: false
  };
}

/* 用一个模板生成项目对象（不写盘，由调用方决定何时保存） */
function makeProject(input = {}) {
  const name = String(input.name || '').trim() || '未命名项目';
  const tpl = templateById(input.templateId || input.template || 'standard');
  const folder = String(input.folder || '').trim() || safeFolderName(name);
  const displayName = String(input.displayName || '').trim().slice(0, 60);
  const id = input.id || ('p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  const now = new Date();
  return {
    id, name, folder,
    ...(displayName && displayName !== name ? { displayName } : {}),
    subtitle: String(input.subtitle || '').trim() || (tpl ? tpl.name : '未填写描述'),
    accent: input.accent || TPL_ACCENTS[DB.projects.length % TPL_ACCENTS.length],
    thumb: 'tpms', seed: Math.floor(Math.random() * 900) + 100,
    progress: 0,
    stage: tpl ? tpl.stage : '起步',
    next: tpl ? tpl.next : '（待填写下一阶段）',
    tools: [], agents: [],
    nodes: tpl ? tpl.nodes.map(n => ({ ...n })) : [{ l: '开始', s: 'current', d: '—' }],
    goal: String(input.goal || '').trim(),
    tags: [], members: [],
    intro: String(input.goal || '').trim(),
    points: [], plan: [],
    owner: { n: '', r: '', agent: '', confirmed: false },
    files: [], git: '', kb: name + '知识库',
    flow: tpl ? (tpl.flow || []).slice() : ['开始', '推进', '收尾'],
    createdAt: now.toISOString().slice(0, 10),
    schedule: emptySchedule(),
    period: '',
    periodLegacy: String(input.period || '').trim(),
    cover: { kind: 'builtin', resource: '', alt: '', fit: 'contain', focus: '' },
    progressMode: 'auto',
    progressNote: '',
    revision: 1,
    junctionTarget: ''
  };
}

/* 把「2026.10 - 2027.06」这类周期换算成当年甘特图的起止月（1-12） */
function monthsFromPeriod(period) {
  const now = new Date();
  const year = now.getFullYear();
  const nums = [...String(period || '').matchAll(/(\d{4})\s*[.\-/年]\s*(\d{1,2})/g)]
    .map(m => ({ y: +m[1], m: Math.min(12, Math.max(1, +m[2])) }));
  if (nums.length >= 2) {
    const a = (nums[0].y - year) * 12 + nums[0].m;
    const b = (nums[1].y - year) * 12 + nums[1].m;
    const s = Math.min(a, b), e = Math.max(a, b);
    return { s: Math.max(1, Math.min(12, s)), e: Math.max(1, Math.min(12, e)) };
  }
  const cur = now.getMonth() + 1;
  return { s: cur, e: Math.min(12, cur + 5) };
}

/* ---------- 全新安装的初始数据：空工作区，只有模板 ---------- */
/* ==========================================================================
   预置的科研写作 Agent（移植自 SnowAgent 的 TASK_SYSTEM_PROMPTS，适配本工作台工具）
   只在「全新安装」和「老数据补齐」时各注入一次。
   用户删掉后不会再被加回来；改过的职责 / 标签 / 提示词也不会被预置文案盖掉。
   presetKey 是稳定身份：改名之后仍能认出「这是那一个预置」。
   成稿清理按 lieflat-less-ai-tone 的白名单压成短段，三条写作 Agent 共用；不贴完整研究 skill。
   ========================================================================== */
/* 只改命中条目的句子。未命中逐字保留，文章框架不动。 */
const WRITING_TONE_CLEANUP = [
  '【成稿清理】白名单改写：只动命中下列条目的句子，未命中的逐字保留；不改文章框架（标题、段落顺序、列表、表格、引文、代码）。',
  '学术与专利不强制「我/你」或短段落；公式、符号、权利要求编号、术语、引用占位、法律固定用语不动。信息守恒：不增删事实、数字与限定（可能、通常、据说）。',
  '存档前扫：翻案腔（不是…而是…/看似…实则…）；顿号罗列过密；相邻句同骨架；揭晓式破折号；提示语/空转冒号；小标题「一、二、三」通篇编号（正文首先、其次不改）；理想化拟人喻体；概括词盖住同段已有数据（无数据只恢复动词、不编造）；说白了/说穿了/先说结论；五种翻译腔（过长前置定语、当…时、对于…来说等话题壳、句首然而因此此外、这意味着式复述）；段首零主语评论补回指。',
  '不做：不调句长凑节奏、不补虚词、不改被动句/名词化/长句本身、不删问句与普通比喻、不改代码与外语段落与引文。'
].join('\n');
/* 用户写出的字数是硬约束。1000 字按汉字计，大约落在 800–1200；超出约 20% 先压缩再存档。 */
const WRITING_LENGTH_RULE = [
  '【篇幅】用户指定的字数（如 1000 字）是硬约束，按汉字（CJK 统一表意文字）计数，不计英文字母与空白。',
  '成稿应落在目标的大约 80%–120%（1000 字对应约 800–1200）。',
  '若草稿超过目标约 20%，先压缩，再调用 save_document。不要为了凑字数添加事实。'
].join('\n');
const WRITING_AGENTS = [
      {
        presetKey: 'writing-paper',
        name: '科研写作·论文', role: '期刊 / 会议论文撰写（IMRaD）', status: 'idle',
        tags: ['论文', 'LaTeX', '润色', '投稿'],
        task: '', stats: [0, 0, 0],
        prompt: [
          '你是学术写作助手，帮助撰写工程热物理领域的中英文论文。精通学术写作规范：',
          '摘要结构（背景-方法-结果-结论）、引言逻辑（问题-现状-缺口-贡献）、方法描述、结果讨论、结论提炼。',
          '遵循工程热物理学报、Int J Heat Mass Transfer 等期刊风格。支持 LaTeX 格式。',
          '',
          '【写作规范】',
          '1. 中文输出用全角标点；纯文本，禁用 Markdown 加粗/斜体，可直接粘贴进 Word 或转 LaTeX。',
          '2. 方法与结论用一般现在时；术语不随意展开；公式与符号保持原样。',
          '3. 引用观点用占位标注（如 [作者, 年份]），文末提醒用户替换为真实文献。',
          '',
          WRITING_TONE_CLEANUP,
          '',
          WRITING_LENGTH_RULE,
          '',
          '【工作流】',
          '1. 先用 search_knowledge 查工作台已有资料与文献，明确素材边界；',
          '2. 给出章节大纲请用户确认，再逐章成文；',
          '3. 每章成文后、调用 save_document 之前，按【成稿清理】通读一遍。若指定了字数且汉字数超过目标约 20%，先压缩再存档（kind=paper），并告知保存位置。'
        ].join('\n')
      },
      {
        presetKey: 'writing-review',
        name: '科研写作·综述', role: '文献综述撰写（多视角主题式组织）', status: 'idle',
        tags: ['综述', '文献梳理', '研究空白'],
        task: '', stats: [0, 0, 0],
        prompt: [
          '你是文献综述写作助手，擅长把零散文献整理成结构化综述。',
          '综述不是摘要堆砌：按"研究主题/方法流派"组织脉络，对比各路线的假设、方法与结论差异，',
          '最后落到研究空白与本文切入点。',
          '',
          '【综述结构】',
          '引言（范围与动机）→ 分类框架（怎么分的类、为什么这样分）→ 各主题脉络对比 →',
          '研究空白与展望。',
          '',
          '【写作规范】与论文相同：全角标点、纯文本、引用占位标注。',
          '',
          WRITING_TONE_CLEANUP,
          '',
          WRITING_LENGTH_RULE,
          '',
          '【工作流】',
          '1. 写综述前先检索，不要直接成文。调用 search_knowledge 时必须带 mode=search（问答才用 mode=ask）。至少用中文、英文各查一次，并换同义术语再查，目标是多个 document_id，不要停在同一篇 PDF。',
          '2. 先输出文献清单（每条写出 document_id 与 source_relative_path）和大纲，请用户确认后再写正文。',
          '3. 禁止只根据一篇综述二手扩写。若 search_knowledge 以 mode=ask 返回且 unique_docs 少于 3，或结果里带有文档不足的 warning，立刻再次调用 search_knowledge，改用 mode=search，并用更宽的中文和英文 query 各查一次。不要根据那一次 ask 展开成文。',
          '4. 每节成文后、调用 save_document 之前，按【成稿清理】通读一遍。若用户指定了字数且汉字数超过目标约 20%，先压缩到大约 80%–120% 再存档（kind=review）。'
        ].join('\n')
      },
      {
        presetKey: 'writing-patent',
        name: '科研写作·专利', role: '发明专利撰写（中国专利法 / 审查指南）', status: 'idle',
        tags: ['专利', '权利要求', '现有技术'],
        task: '', stats: [0, 0, 0],
        prompt: [
          '你是专利撰写助手，熟悉中国专利法和审查指南。帮助撰写发明专利的八个标准部分：',
          '发明名称、技术领域、背景技术、发明内容、附图说明、具体实施方式、权利要求书、摘要。',
          '侧重工程热物理领域的换热器、热管理系统、流体机械等方向。',
          '',
          '【写作要点】',
          '1. 背景技术要写出现有方案的缺点（为发明内容铺垫），但不贬低到无法实现的程度；',
          '2. 权利要求书：独立权利要求保护范围尽量大，从属权利要求逐层收窄；',
          '3. 具体实施方式要支持权利要求的每个技术特征，给出可复现的实施例；',
          '4. 全文避免"等""之类"模糊表述出现在权利要求中。',
          '',
          WRITING_TONE_CLEANUP,
          '',
          WRITING_LENGTH_RULE,
          '',
          '【工作流】',
          '1. 请用户提供技术方案（或用 search_knowledge 查已有资料）；',
          '2. 先产出权利要求书草稿请用户确认保护范围，再补齐其余部分；',
          '3. 每一部分成文后、调用 save_document 之前，按【成稿清理】通读一遍。若指定了字数且汉字数超过目标约 20%，先压缩再存档（kind=patent）。'
        ].join('\n')
      }
];
const AGENTS_PRESET_VERSION = 'writing-3@2026-10';
/* 只用于认出「还没被人改过」的旧综述工作流。改过的提示词不回写。 */
const WRITING_REVIEW_WORKFLOW_BEFORE = [
  '【工作流】',
  '1. 先用 search_knowledge 检索工作台已登记的文献与资料；',
  '2. 输出"文献清单 + 分类框架"请用户补充遗漏后，再逐节成文；',
  '3. 每节成文后、调用 save_document 之前，按【成稿清理】通读一遍，再存档（kind=review）。'
].join('\n');

function freshData() {
  const y = new Date().getFullYear();
  return {
    schemaVersion: 3,
    user: { name: '研究员', initial: '研', greet: '', mode: '本地工作台' },
    rootDir: '',
    projects: [], tasks: [], todos: [], timeline: [], kbDocs: [], resources: [], automations: [], templates: [], tombstones: [],
    activities: [], chats: {}, audit: [], outcomes: [], materialScans: {},
    ai: {
      enabled: false, provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
      temperature: 0.3, maxTokens: 0, autoApprove: true
    },
    /* 三个预置写作 Agent 见文件顶部的 WRITING_AGENTS */
    agents: JSON.parse(JSON.stringify(WRITING_AGENTS)),
    /* 员工派单任务记录（Agent 执行历史） */
    agentJobs: [],
    /* 项目材料登记索引：{ [projectId]: { '01_建模': [[名, 大小, 扩展名], ...] } } */
    materialIndex: {},
    /* 软件清单保留，但不带任何本机路径 —— 新设备需要自己绑定 */
    apps: (SEED.apps || []).map(a => ({
      ...JSON.parse(JSON.stringify(a)),
      path: '', cwd: '', run: null, bound: '', pending: a.kind !== 'builtin'
    })),
    sidebarLaunch: ['浏览器'],
    months: (SEED.months || []).slice(),
    taskStatus: JSON.parse(JSON.stringify(SEED.taskStatus || [])),
    settings: { ...SETTINGS_DEFAULT, rootDir: '', defaultWorkspace: '', structureCreated: false, onboarded: false, year: y },
    workspace: { project: '', running: [], agents: 0 }
  };
}

/* ---------- 项目材料目录（相对项目根目录，真实磁盘结构） ---------- */
const MATERIALS = {
  tpms: {
    '01_建模': [['TPMS_Gyroid_v3.scdoc', '8.4 MB', 'cad'], ['结构参数表_v3.xlsx', '248 KB', 'xlsx']],
    '02_网格': [['mesh_independence.xlsx', '96 KB', 'xlsx'], ['网格无关性验证.docx', '1.1 MB', 'docx']],
    '03_仿真': [['tpms_re4500.cas.h5', '1.8 GB', 'case'], ['tpms_re4500.dat.h5', '642 MB', 'case'], ['仿真参数汇总.csv', '58 KB', 'csv']],
    '04_优化': [['晶胞参数扫描_v3.xlsx', '248 KB', 'xlsx'], ['optimize_cell.py', '12 KB', 'py']],
    '05_文档': [['组会汇报_v2.pptx', '6.2 MB', 'pptx'], ['支撑材料清单.docx', '420 KB', 'docx']],
    '06_参考资料': [['TPMS换热器_综述整理.pdf', '2.4 MB', 'pdf']]
  },
  lng: {
    '01_文献': [['LNG冷能利用综述.pdf', '3.1 MB', 'pdf']],
    '02_流程方案': [['流程方案对比.pptx', '4.6 MB', 'pptx'], ['工况数据.xlsx', '512 KB', 'xlsx']],
    '03_仿真': [['lng_cascade.inp', '86 KB', 'case'], ['㶲分析结果.csv', '240 KB', 'csv']],
    '04_报告': [['中期报告.docx', '1.8 MB', 'docx']]
  },
  cfd: {
    '01_算例设置': [['case_matrix.xlsx', '128 KB', 'xlsx'], ['setup_notes.md', '24 KB', 'md']],
    '02_计算结果': [['kEpsilon.dat', '480 MB', 'case'], ['SST.dat', '512 MB', 'case'], ['LES.dat', '2.4 GB', 'case']],
    '03_对比分析': [['误差量化.xlsx', '186 KB', 'xlsx'], ['速度场对比.png', '3.2 MB', 'img'], ['对比报告_v1.docx', '1.4 MB', 'docx']]
  },
  opt: {
    '01_算法': [['nsga2_solver.py', '28 KB', 'py'], ['surrogate_model.py', '16 KB', 'py'], ['config.yaml', '4 KB', 'yaml']],
    '02_批量算例': [['batch_01_24', '1.2 GB', 'dir'], ['submit.log', '88 KB', 'log']],
    '03_前沿分析': [['Pareto结果.csv', '3.2 MB', 'csv'], ['pareto_front.png', '920 KB', 'img']]
  },
  bench: {
    '01_交接资料': [['设备清单.xlsx', '96 KB', 'xlsx'], ['交接记录.docx', '380 KB', 'docx']],
    '02_标定': [['标定记录表.xlsx', '860 KB', 'xlsx'], ['传感器证书.pdf', '1.2 MB', 'pdf']],
    '03_试验数据': [['blank_test_01.csv', '24 MB', 'csv'], ['试验方案_v1.docx', '640 KB', 'docx']]
  },
  rag: {
    '01_文献库': [['literature_120.zip', '186 MB', 'zip'], ['文献清单.csv', '42 KB', 'csv']],
    '02_索引': [['索引说明.md', '1 KB', 'md']],
    '03_服务': [['rag_server.py', '18 KB', 'py'], ['api_spec.md', '12 KB', 'md']]
  }
};

/* ---------- 设置默认值 ---------- */
const SETTINGS_DEFAULT = {
  glass: true, ambient: true, compact: true,
  defaultWorkspace: 'tpms',
  resumeLast: true, motion: true, notifyDot: true,
  /* agentAuto 已从设置页移除，仅由 Agent 中心的「编排策略」弹窗写入，当前无消费方 */
  agentAuto: true, agentConcurrency: '4', agentConfirm: true, localLLM: true,
  autoBackup: true, cloudSync: false,
  /* 外部 RAG：本软件不做向量化。默认接本机 RAG_Snowz（回环、无鉴权）。 */
  ragEnabled: true,
  ragEndpoint: 'http://127.0.0.1:8765',
  ragTopK: '8',
  kbEngine: 'rag_snowz',
  /* 知识库服务按需启动：检索时服务没开就运行启动命令；空闲后只停本软件启动的服务。默认不配置，不写开机自启。 */
  kbStartCommand: '',
  kbStopCommand: '',
  kbStartTimeoutSec: 60,
  kbIdleStopMinutes: 30
};

/* 交给主进程的启动 / 停止配置（随检索请求带上） */
function kbServiceConfig(S) {
  const s = S || {};
  const t = Number(s.kbStartTimeoutSec);
  const idle = Number(s.kbIdleStopMinutes);
  return {
    startCommand: String(s.kbStartCommand || '').trim(),
    stopCommand: String(s.kbStopCommand || '').trim(),
    startTimeoutSec: Number.isFinite(t) && t > 0 ? t : 60,
    idleStopMinutes: Number.isFinite(idle) && idle >= 0 ? idle : 30
  };
}

/* RAG_Snowz 默认基地址。渲染层只把它交给主进程，自己不发跨域请求。 */
const RAG_SNOWZ_DEFAULT = 'http://127.0.0.1:8765';

function ragClientConfig(settings) {
  const S = settings || {};
  const engine = S.kbEngine || (S.ragEnabled ? 'http' : 'builtin');
  let endpoint = String(S.ragEndpoint || '').trim().replace(/\/+$/, '');
  if (engine === 'rag_snowz' && (!endpoint || endpoint === 'http://127.0.0.1:8000')) {
    endpoint = RAG_SNOWZ_DEFAULT;
  }
  const topK = Math.min(Math.max(Number(S.ragTopK) || 8, 1), 50);
  return {
    engine,
    endpoint,
    topK,
    snowz: engine === 'rag_snowz',
    external: engine === 'rag_snowz' || engine === 'http'
  };
}

/* /api/health 的 knowledge_indexed。
   外部引擎已经拿到 /health 时，和文档数对齐（RAG_Snowz 的 docs，例如 266；HTTP 引擎用它上报的 indexed）。
   这不是把全文检索说成向量索引：kind=docs 时只表示语料规模。
   还没探测到、或探测失败时不要报 0，改记 external / unknown。 */
function resolveKnowledgeIndex(engine, rag) {
  const eng = String(engine || 'builtin');
  const external = eng === 'http' || eng === 'rag_snowz';
  const status = rag && rag.status;
  if (!external) {
    return {
      knowledge_indexed: 0,
      knowledge_index_status: eng === 'none' ? 'none' : 'builtin',
      knowledge_docs: 0,
      knowledge_chunks: 0,
      knowledge_index_kind: 'none'
    };
  }
  if (status !== 'ok') {
    return {
      knowledge_indexed: null,
      knowledge_index_status: status === 'fail' ? 'engine_down' : 'external',
      knowledge_docs: null,
      knowledge_chunks: null,
      knowledge_index_kind: eng === 'rag_snowz' ? 'docs' : 'vectors'
    };
  }
  const docs = Number(rag.docs) || 0;
  const chunks = Number(rag.chunks) || 0;
  const indexed = Number(rag.indexed) || 0;
  if (eng === 'rag_snowz') {
    return {
      knowledge_indexed: docs,
      knowledge_index_status: 'ok',
      knowledge_docs: docs,
      knowledge_chunks: chunks,
      knowledge_index_kind: 'docs'
    };
  }
  return {
    knowledge_indexed: indexed || docs,
    knowledge_index_status: 'ok',
    knowledge_docs: docs,
    knowledge_chunks: chunks,
    knowledge_index_kind: indexed ? 'vectors' : 'docs'
  };
}

/* 记录最近一次迁移补了多少 id，供启动时决定是否需要立刻落盘 */
let _lastMigrateInfo = { idsAdded: 0 };

/* ---------- 数据迁移：补齐旧版本数据文件缺失的字段 ---------- */
function migrate(d) {
  if (!d || typeof d !== 'object') return d;

  d.ai = {
    enabled: false, provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    temperature: 0.3, maxTokens: 0, autoApprove: true,
    ...(d.ai || {})
  };
  d.chats = d.chats || {};
  if (!Array.isArray(d.sidebarLaunch)) d.sidebarLaunch = [];

  /* 结构版本：后续结构变更在这里逐版升级，不再靠默认值合并蒙过去 */
  if (typeof d.schemaVersion !== 'number') d.schemaVersion = 2;
  /* 老数据视为已完成引导：不要给已有用户显示首次使用的欢迎页 */
  if (typeof d.onboarded === 'boolean') { delete d.onboarded; }
  if (!d.settings) d.settings = {};
  /* v3：默认紧凑密度。只在第一次升到 3 时打开，之后尊重用户在设置里关掉的选择 */
  if (d.schemaVersion < 3) {
    d.settings.compact = true;
    d.schemaVersion = 3;
  }
  if (typeof d.settings.onboarded !== 'boolean') d.settings.onboarded = true;
  ['projects', 'tasks', 'todos', 'timeline', 'kbDocs', 'agents', 'automations',
    'activities', 'templates', 'resources', 'tombstones'].forEach(k => {
    if (!Array.isArray(d[k])) d[k] = [];
  });

  /* 同步前置：补齐稳定 id（老数据第一次升级时执行一次，之后幂等） */
  _lastMigrateInfo = { idsAdded: assignRecordIds(d) };
  /* 墓碑只保留最近 90 天，避免无限增长 */
  const cut = Date.now() - 90 * 864e5;
  d.tombstones = d.tombstones.filter(t => t && t.coll && t.id && (t.at || 0) >= cut).slice(-1000);

  /* 项目文件夹名与项目名解耦：老数据没有 folder 时按名字补齐 */
  (d.projects || []).forEach(pr => {
    if (!pr) return;
    if (typeof pr.folder !== 'string' || !pr.folder) pr.folder = pr.name;
  });
  /* 自定义模板结构兜底 */
  d.templates = d.templates.filter(t => t && typeof t === 'object' && t.name).map(t => ({
    id: t.id || ('tpl' + Math.random().toString(36).slice(2, 8)),
    name: String(t.name),
    desc: String(t.desc || ''),
    dirs: Array.isArray(t.dirs) ? t.dirs.filter(Boolean).map(String) : [],
    flow: Array.isArray(t.flow) ? t.flow.filter(Boolean).map(String) : [],
    nodes: Array.isArray(t.nodes) ? t.nodes.filter(n => n && n.l).map(n => ({ l: String(n.l), s: 'todo', d: '—' })) : [],
    stage: String(t.stage || ''),
    next: String(t.next || ''),
    tasks: Array.isArray(t.tasks) ? t.tasks : [],
    builtin: false
  }));

  if (!Array.isArray(d.agentJobs)) d.agentJobs = [];

  if (!d.materialIndex || typeof d.materialIndex !== 'object') d.materialIndex = {};

  /* 流程一致性（v2.8.5）：nodes 是唯一真相，flow/stage 跟它走。
     老数据常见问题是「有 stage 但没有任何节点标记进行中」，界面就没有当前阶段。 */
  (d.projects || []).forEach(p => {
    if (!p || typeof p !== 'object') return;
    const nodes = (Array.isArray(p.nodes) ? p.nodes : [])
      .filter(n => n && n.l)
      .map((n, i) => {
        const o = copyFlowNode(n);
        if (o && !o.id) o.id = 'n' + hashKey(String(p.id || '') + '|' + o.l + '#' + i);
        return o;
      })
      .filter(Boolean);
    if (nodes.length) {
      p.nodes = nodes;
      p.flow = nodes.map(n => n.l);
      const cur = nodes.find(n => n.s === 'current');
      if (cur) {
        p.stage = cur.l;
      } else {
        const firstOpen = nodes.find(n => n.s !== 'done');
        if (firstOpen) { firstOpen.s = 'current'; p.stage = firstOpen.l; }
        else p.stage = nodes[nodes.length - 1].l;
      }
    } else if (Array.isArray(p.flow) && p.flow.length) {
      /* 只有 flow 没有 nodes：补出节点，第一个为进行中 */
      p.nodes = p.flow.map((l, i) => ({ l: String(l), s: i === 0 ? 'current' : 'todo', d: '' }));
      p.stage = p.nodes[0].l;
    }
  });

  /* S0：任务/项目里指向「已不存在的 Agent」的引用清空为未指派（老数据里的演示名） */
  const liveAgents = new Set((d.agents || []).map(a => a && a.name).filter(Boolean));
  (Array.isArray(d.tasks) ? d.tasks : []).forEach(t => {
    if (t && t.agent && !liveAgents.has(t.agent)) t.agent = '';
  });
  (d.projects || []).forEach(p => {
    if (Array.isArray(p.agents)) p.agents = p.agents.filter(n => liveAgents.has(n));
    if (p.owner && p.owner.agent && !liveAgents.has(p.owner.agent)) p.owner.agent = '';
  });

  /* S0：老任务补稳定 ID（缺失才补，已有不动） */
  let idSeq = 0;
  (Array.isArray(d.tasks) ? d.tasks : []).forEach(t => {
    if (t && !t.id) t.id = 'tk' + (Date.now().toString(36)) + (idSeq++).toString(36) + Math.random().toString(36).slice(2, 4);
  });

  /* 知识库引擎：没人改过的内置空壳（旧默认 8000、未启用）升到本机 RAG_Snowz。
     已经选过 HTTP 引擎或填过别的地址的配置保持不动。 */
  if (d.settings) {
    const ep = String(d.settings.ragEndpoint || '');
    const untouched = !d.settings.ragEnabled && (ep === '' || ep === 'http://127.0.0.1:8000');
    if (!d.settings.kbEngine) {
      d.settings.kbEngine = d.settings.ragEnabled ? 'http' : (untouched ? 'rag_snowz' : 'builtin');
    } else if (d.settings.kbEngine === 'builtin' && untouched) {
      d.settings.kbEngine = 'rag_snowz';
    }
    if (d.settings.kbEngine === 'rag_snowz') {
      d.settings.ragEnabled = true;
      if (!ep || ep === 'http://127.0.0.1:8000') d.settings.ragEndpoint = 'http://127.0.0.1:8765';
    }
    if (typeof d.settings.kbExtraRoots === 'undefined') d.settings.kbExtraRoots = [];
  }

  /* 项目字段兜底：导入/老数据缺字段时，界面按空值渲染而不是抛异常 */
  (d.projects || []).forEach(p => {
    if (!p || typeof p !== 'object') return;
    if (!p.owner || typeof p.owner !== 'object') p.owner = { n: '我', r: '', agent: '' };
    if (typeof p.owner.agent !== 'string') p.owner.agent = '';
    ['nodes', 'tags', 'members', 'agents', 'tools', 'points', 'plan', 'flow'].forEach(k => {
      if (!Array.isArray(p[k])) p[k] = [];
    });
    ['name', 'subtitle', 'goal', 'period', 'stage', 'next', 'thumb', 'intro', 'folder'].forEach(k => {
      if (typeof p[k] !== 'string') p[k] = '';
    });
    if (typeof p.progress !== 'number' || !isFinite(p.progress)) p.progress = 0;
    if (typeof p.seed !== 'number') p.seed = 1;
    if (!p.schedule || typeof p.schedule !== 'object') {
      p.periodLegacy = String(p.period || '').trim();
      p.schedule = emptySchedule();
      p.period = '';
    } else {
      p.schedule = cloneSchedule(p.schedule);
    }
    if (!p.cover || typeof p.cover !== 'object') p.cover = { kind: 'builtin', resource: '', alt: '', fit: 'contain', focus: '' };
    if (p.progressMode !== 'manual') p.progressMode = 'auto';
    if (typeof p.revision !== 'number' || !Number.isFinite(p.revision)) p.revision = 1;
    if (typeof p.junctionTarget !== 'string') p.junctionTarget = '';
    if (!p.owner || typeof p.owner !== 'object') p.owner = { n: '', r: '', agent: '', confirmed: false };
    if (typeof p.owner.confirmed !== 'boolean') {
      const nm = String(p.owner.n || '').trim();
      p.owner.confirmed = !!nm && !OWNER_PLACEHOLDERS.has(nm);
    }
    if (OWNER_PLACEHOLDERS.has(String(p.owner.n || '').trim())) p.owner.confirmed = false;
    (Array.isArray(p.nodes) ? p.nodes : []).forEach((n, i) => {
      if (n && !n.id) n.id = 'n' + hashKey(String(p.id || '') + '|' + n.l + '#' + i);
    });
  });
  if (!Array.isArray(d.outcomes)) d.outcomes = [];
  if (!d.materialScans || typeof d.materialScans !== 'object') d.materialScans = {};
  (d.activities || []).forEach(a => {
    if (!a || typeof a !== 'object') return;
    if (typeof a.projectId !== 'string') a.projectId = '';
    if (typeof a.batchId !== 'string') a.batchId = '';
  });
  (d.todos || []).forEach(t => {
    if (t && typeof t.projectId !== 'string') t.projectId = '';
  });

  /* 早期版本预置了 6 个演示 Agent（Architect/Researcher/...）和一个简版「科研写作」，
     它们没有真实内容。判据只看「真实执行次数 stats[0]」：
     演示壳自带 task 文案（如"正在执行：梳理研究目标"），不能拿 task 是否为空当"用过"。 */
  const legacyPresets = new Set([...(SEED.agents || []).map(a => a.name), '科研写作']);
  d.agents = (d.agents || []).filter(a => {
    if (!a || typeof a.name !== 'string') return false;
    if (!legacyPresets.has(a.name)) return true;                       /* 自建 Agent 保留 */
    const runs = Array.isArray(a.stats) ? (a.stats[0] || 0) : 0;
    return runs > 0;                                                   /* 真的执行过才保留 */
  });

  /* 补齐三个预置写作 Agent。
     版本标记仍是一次性的（不提升 AGENTS_PRESET_VERSION）：
     只在版本对不上时注入「还没有的」那几个，用户删掉后不会再被加回来。
     已经在册的一律不回写 role / tags / prompt —— 包括名字还和预置一样、但人设已被改过的。
     每次加载只给还没有 presetKey 的在册预置补上稳定身份，改名后不会被当成缺失再塞一份。 */
  ensureWritingPresets(d);

  (d.apps || []).forEach(a => {
    if (typeof a.path !== 'string') a.path = '';
    if (typeof a.cwd !== 'string') a.cwd = '';
    if (!Array.isArray(a.args)) a.args = [];
    if (typeof a.cwd !== 'string') a.cwd = a.kind === 'folder' ? a.path : '';
    if (typeof a.icon !== 'string') a.icon = '';
    if (typeof a.displayName !== 'string') a.displayName = a.n;
    if (typeof a.source !== 'string') a.source = 'builtin';   // builtin | imported
    if (typeof a.pending !== 'boolean') a.pending = false;
    /* run 只表示进程是否在跑。老数据把项目 id 塞进 run，绑定会在启动时被清掉，界面还把它显示成「运行中」 */
    if (typeof a.bound !== 'string') {
      const legacy = a.run;
      const known = typeof legacy === 'string' && (d.projects || []).some(p => p && p.id === legacy);
      a.bound = known ? legacy : '';
    }
    if (typeof a.run === 'string') a.run = null;
  });

  /* 左侧快捷启动里若有已不存在的软件名，剔除掉 */
  d.sidebarLaunch = d.sidebarLaunch.filter(n => (d.apps || []).some(a => a.n === n));

  /* 历史遗留：状态栏曾写死一个「同步：已完成」，实际从未有过同步能力 */
  if (d.workspace && Object.prototype.hasOwnProperty.call(d.workspace, 'sync')) delete d.workspace.sync;

  /* 清理已从界面移除的键，避免在数据文件里堆积噪音 */
  ['embeddingModel', 'startup', 'hotkey', 'procMonitor',
    'agentAuto', 'agentConcurrency', 'agentConfirm', 'localLLM', 'cloudSync'].forEach(k => {
    if (d.settings && Object.prototype.hasOwnProperty.call(d.settings, k)) delete d.settings[k];
  });

  return d;
}

/* ---------- 可变数据绑定（启动时由持久化层覆盖） ---------- */
/* ==========================================================================
   修订标记与删除墓碑
   - 每次落盘前对比「上次落盘的内容」，给真正变化的记录打 rev
   - 消失的记录写墓碑（否则同步回来会复活）
   - 只做内容比较，不依赖设备时钟
   ========================================================================== */
let _stampBase = null;

function recordContentKey(rec) {
  const c = {};
  Object.keys(rec).sort().forEach(k => { if (k !== 'rev') c[k] = rec[k]; });
  return JSON.stringify(c);
}

function initStampBase() {
  _stampBase = {};
  SYNC_COLLECTIONS.forEach(coll => {
    const m = {};
    (Array.isArray(DB[coll]) ? DB[coll] : []).forEach(r => {
      if (r && typeof r === 'object' && r.id) m[r.id] = recordContentKey(r);
    });
    _stampBase[coll] = m;
  });
}

/* 落盘前调用：补 id、打 rev、记墓碑 */
function stampChanges() {
  if (!_stampBase) { initStampBase(); return { touched: 0, removed: 0 }; }
  if (!Array.isArray(DB.tombstones)) DB.tombstones = [];
  const now = Date.now();
  const next = {};
  let touched = 0, removed = 0;

  SYNC_COLLECTIONS.forEach(coll => {
    const arr = Array.isArray(DB[coll]) ? DB[coll] : [];
    const cur = {};
    arr.forEach(r => {
      if (!r || typeof r !== 'object') return;
      if (!r.id) r.id = recordKey(coll, r);
      cur[r.id] = recordContentKey(r);
    });

    const prev = _stampBase[coll] || {};
    arr.forEach(r => {
      if (!r || !r.id) return;
      if (!(r.id in prev) || prev[r.id] !== cur[r.id]) { r.rev = now; touched++; }
    });

    Object.keys(prev).forEach(id => {
      if (id in cur) return;
      if (!DB.tombstones.some(t => t.coll === coll && t.id === id)) {
        DB.tombstones.push({ coll, id, at: now });
        removed++;
      }
    });
    next[coll] = cur;
  });

  /* 记录又回来了（撤销 / 同步）→ 去掉它的墓碑 */
  DB.tombstones = DB.tombstones.filter(t => {
    const m = next[t.coll];
    return !(m && t.id in m);
  });
  const cutoff = now - 90 * 864e5;
  DB.tombstones = DB.tombstones.filter(t => (t.at || 0) >= cutoff).slice(-1000);

  _stampBase = next;
  return { touched, removed };
}

let DB = SEED;
function setDB(next) { DB = next; _stampBase = null; initStampBase(); }

/* ---------- 路径工具 ---------- */
function rootDir() { return (DB.settings && DB.settings.rootDir) || ''; }
function projName(p) { return (p && (p.displayName || p.name)) || ''; }
function incompleteLabel(n, unit) {
  const c = Number(n) || 0;
  if (c <= 0) return '';
  return c + ' ' + (unit || '个未完成');
}
function projectDir(p) { return rootDir() + '\\' + (typeof p === 'string' ? p : (p.folder || p.name)); }

/* Agent 读项目与保存回执共用这一份字段，避免写完再读对不上。
   folder 是相对名；project_folder 只是 rootDir 拼出来的位置，磁盘上可以是 junction。 */
function projectContent(p) {
  if (!p) return null;
  const nodes = Array.isArray(p.nodes)
    ? p.nodes.filter(n => n && n.l).map(n => {
      const o = {
        l: String(n.l),
        s: n.s === 'done' || n.s === 'current' || n.s === 'todo' ? n.s : 'todo',
        d: String(n.d || '')
      };
      if (n.id) o.id = String(n.id);
      if (n.criterion) o.criterion = String(n.criterion);
      if (Array.isArray(n.evidence) && n.evidence.length) o.evidence = n.evidence.map(x => String(x));
      if (n.dateKind === 'done' || n.dateKind === 'planned') o.date_kind = n.dateKind;
      return o;
    })
    : [];
  const mile = milestoneStats(p);
  const sched = scheduleView(p);
  const cover = coverView(p);
  const who = ownerView(p);
  const index = materialStatusView(p.id);
  return {
    id: p.id,
    name: p.name,
    display_name: p.displayName || p.name,
    short_name: p.shortName || '',
    folder: p.folder || p.name,
    folder_kind: 'relative',
    project_folder: projectDir(p),
    junction_target: p.junctionTarget || '',
    subtitle: p.subtitle || '',
    intro: p.intro || '',
    goal: p.goal || '',
    stage: p.stage || '',
    next_stage: p.next || '',
    progress: p.progress,
    progress_mode: p.progressMode === 'manual' ? 'manual' : 'auto',
    progress_note: p.progressNote || '',
    progress_basis: mile.basis,
    milestone: { done: mile.done, total: mile.total, percent: mile.percent, label: mile.label, unknown: !!mile.unknown },
    period: sched.confirmed ? sched.label : '',
    period_legacy: sched.legacy,
    schedule: sched.schedule,
    schedule_label: sched.label,
    nodes,
    flow: Array.isArray(p.flow) ? p.flow.map(x => String(x)) : nodes.map(n => n.l),
    plan: Array.isArray(p.plan) ? p.plan.map(x => String(x)) : [],
    tools: Array.isArray(p.tools) ? p.tools.slice() : [],
    agents: Array.isArray(p.agents) ? p.agents.slice() : [],
    owner: who.label,
    owner_confirmed: who.confirmed,
    owner_agent: who.agent,
    cover,
    material_index: index,
    revision: p.revision || 1,
    progress_change: p.progressChange || ''
  };
}
function taskDir(task) { const p = P(task.p); return p ? projectDir(p) + '\\' + (task.dir || '') : rootDir(); }
/* 项目材料索引：DB.materialIndex 是真实登记（可持久化、可同步），
   MATERIALS 仅作内置演示项目的兜底示例 */
function materialIndexOf(projectId) {
  const idx = DB && DB.materialIndex && DB.materialIndex[projectId];
  if (idx && Object.keys(idx).length) return idx;
  return MATERIALS[projectId] || {};
}

function materialsIn(projectId, dir) {
  const m = materialIndexOf(projectId);
  if (dir) return (m[dir] || []).map(([n, size, ext]) => ({ n, size, ext }));
  return Object.entries(m).flatMap(([d, arr]) => arr.map(([n, size, ext]) => ({ n, size, ext, dir: d })));
}
function projectFolderCount(projectId) { return Object.keys(materialIndexOf(projectId)).length; }

const P = id => DB.projects.find(p => p.id === id);
const A = n => DB.agents.find(a => a.name === n);

/* 预置写作 Agent 的稳定身份。改名后仍靠它认出原预置，避免补齐时再插入一份。 */
function writingPresetKey(preset) {
  return (preset && preset.presetKey) || ('name:' + (preset && preset.name));
}

function ensureWritingPresets(d) {
  if (!Array.isArray(d.agents)) d.agents = [];
  for (const preset of WRITING_AGENTS) {
    const key = writingPresetKey(preset);
    const keyed = d.agents.find(a => a && a.presetKey === key);
    if (keyed) continue;
    const byName = d.agents.find(a => a && !a.presetKey && a.name === preset.name);
    if (byName) byName.presetKey = key;
  }
  if (d.agentsPresetVersion !== AGENTS_PRESET_VERSION) {
    for (const preset of WRITING_AGENTS) {
      const key = writingPresetKey(preset);
      const exists = d.agents.some(a => a && (a.presetKey === key || a.name === preset.name));
      if (!exists) {
        const copy = JSON.parse(JSON.stringify(preset));
        copy.presetKey = key;
        d.agents.push(copy);
      }
    }
    d.agentsPresetVersion = AGENTS_PRESET_VERSION;
  }
  upgradeStockWritingReview(d);
}

/* 旧的综述工作流原样还在时，换成多查询检索。人设或工作流被改过则不动。 */
function upgradeStockWritingReview(d) {
  const next = WRITING_AGENTS.find(a => a && a.presetKey === 'writing-review');
  if (!next || !Array.isArray(d.agents)) return;
  const freshTail = next.prompt.slice(next.prompt.indexOf('【工作流】'));
  d.agents.forEach(a => {
    if (!a || typeof a.prompt !== 'string') return;
    const isReview = a.presetKey === 'writing-review' || (!a.presetKey && a.name === '科研写作·综述');
    if (!isReview) return;
    const idx = a.prompt.indexOf('【工作流】');
    if (idx < 0) return;
    const tail = a.prompt.slice(idx).replace(/\s+$/, '');
    if (tail !== WRITING_REVIEW_WORKFLOW_BEFORE) return;
    a.prompt = a.prompt.slice(0, idx) + freshTail;
  });
}

function agentByMention(token) {
  const q = String(token || '').trim().replace(/^[「"'']+|[」"'']+$/g, '');
  if (!q || !Array.isArray(DB.agents)) return null;
  const low = q.toLowerCase();
  return DB.agents.find(a => a && (
    a.name === q || a.presetKey === q
    || String(a.name || '').toLowerCase() === low
    || String(a.presetKey || '').toLowerCase() === low
  )) || null;
}

function writingReviewAgent() {
  const list = (DB && DB.agents) || [];
  return list.find(a => a && a.presetKey === 'writing-review')
    || list.find(a => a && a.name === '科研写作·综述')
    || null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function agentList() {
  return (DB && Array.isArray(DB.agents)) ? DB.agents : [];
}

/* ASCII 短名字（如 AI）不参与裸文本匹配，避免一句话里的普通词误切换。@名字 仍精确命中。 */
function displayNameAt(raw, name) {
  const n = String(name || '');
  if (!n) return -1;
  const ascii = /^[\x00-\x7F]+$/.test(n);
  if (ascii) {
    if (n.length < 4) return -1;
    const re = new RegExp('(?:^|[^A-Za-z0-9_])' + escapeRegExp(n) + '(?:$|[^A-Za-z0-9_])', 'i');
    const m = re.exec(raw);
    return m ? m.index : -1;
  }
  if (n.length < 4) return -1;
  return raw.indexOf(n);
}

function presetKeyAt(raw, key) {
  const k = String(key || '');
  if (!k) return -1;
  const re = new RegExp('(?:^|[^A-Za-z0-9_-])' + escapeRegExp(k) + '(?:$|[^A-Za-z0-9_-])', 'i');
  const m = re.exec(raw);
  return m ? m.index : -1;
}

function earliestAgent(raw, scoreFn) {
  let best = null;
  let bestAt = Infinity;
  let bestLen = -1;
  agentList().forEach(a => {
    if (!a) return;
    const scored = scoreFn(a);
    if (!scored || scored.at < 0) return;
    if (scored.at < bestAt || (scored.at === bestAt && scored.len > bestLen)) {
      best = a;
      bestAt = scored.at;
      bestLen = scored.len;
    }
  });
  return best;
}

/* 综述 / 论文 / 专利共用。「用专利 agent」「让论文 agent」算点名；单独的「专利」「论文」不算。 */
const WRITING_AGENT_TOPICS = [
  { topic: '综述', presetKey: 'writing-review', name: '科研写作·综述' },
  { topic: '论文', presetKey: 'writing-paper', name: '科研写作·论文' },
  { topic: '专利', presetKey: 'writing-patent', name: '科研写作·专利' }
];

function writingAgentByTopic(topic) {
  const spec = WRITING_AGENT_TOPICS.find(x => x.topic === topic);
  if (!spec) return null;
  const list = agentList();
  return list.find(a => a && a.presetKey === spec.presetKey)
    || list.find(a => a && a.name === spec.name)
    || null;
}

/* 取最早一处「用/让 X agent」。同一句里论文和专利都出现时，先出现的那个生效。 */
function writingAgentAddressed(raw) {
  const text = String(raw || '');
  let best = null;
  let bestAt = Infinity;
  WRITING_AGENT_TOPICS.forEach(spec => {
    const re = new RegExp('(?:^|[^不别勿])(?:用|让|叫|请|切换到|换成|交给)[^，。；;\\n]{0,8}' + spec.topic + '\\s*agent', 'ig');
    const m = re.exec(text);
    if (!m || m.index >= bestAt) return;
    const agent = writingAgentByTopic(spec.topic);
    if (!agent) return;
    best = agent;
    bestAt = m.index;
  });
  return best;
}

/* 「写个综述」这类写作请求可以切到综述 Agent。评价、翻译、课程、否定句不切。 */
function reviewWritingRequested(raw) {
  if (/(?:不要|别|不用|无需|勿)(?:把|将|要)?(?:写成|写作|写)(?:了)?(?:一篇|一份|一个|个)?(?:文献)?综述/.test(raw)) return false;
  if (/(?:写|撰写)了?(?:一个|一篇|一份|个)(?:文献)?综述(?!课)/.test(raw)) return true;
  if (/(?<![不别勿])(?:写|撰写)综述(?!课)/.test(raw)) return true;
  const m = raw.match(/(?:写|撰写)([^，。！？\n]{0,20})综述(?!课)/);
  if (!m) return false;
  const mid = String(m[1] || '').trim();
  if (!mid) return true;
  if (/课|看|读|参考|翻译|下载|打开|找到|这篇|那篇|学习/.test(mid)) return false;
  /* 「写作…综述」是名词，不是「写个综述」。 */
  if (/^(?:得|了|过|成|作)/.test(mid)) return false;
  return /[\u4e00-\u9fffA-Za-z0-9]/.test(mid);
}

/* @名字、presetKey、Agent 显示名优先。
   综述 / 论文 / 专利在「用/让 X agent」、presetKey、显示名或 @名称 时对称切换。
   「写个综述」仍只切综述。文中仅仅出现「综述」「论文」「专利」不会切换。 */
function agentNamedInText(text) {
  const raw = String(text || '');
  const mentions = raw.match(/@([^\s@，,。；;：:、]+)/g) || [];
  for (const m of mentions) {
    const hit = agentByMention(m.slice(1));
    if (hit) return hit;
  }
  const byPreset = earliestAgent(raw, a => {
    const at = presetKeyAt(raw, a.presetKey);
    return at < 0 ? null : { at, len: String(a.presetKey || '').length };
  });
  if (byPreset) return byPreset;
  const byName = earliestAgent(raw, a => {
    const at = displayNameAt(raw, a.name);
    return at < 0 ? null : { at, len: String(a.name || '').length };
  });
  if (byName) return byName;
  const addressed = writingAgentAddressed(raw);
  if (addressed) return addressed;
  if (reviewWritingRequested(raw)) return writingReviewAgent();
  return null;
}

/* 汉字计数只取 CJK 统一表意文字。1000 字的合格区间是大约 800–1200。 */
function countCjk(text) {
  const matched = String(text == null ? '' : text).match(/[\u4e00-\u9fff]/g);
  return matched ? matched.length : 0;
}

/* 「1000 字」「约 1000 字」「1000 words」。没有写出数字就不设硬目标。 */
function parseLengthTarget(text) {
  const raw = String(text == null ? '' : text);
  const zh = raw.match(/(\d{2,6})\s*(?:个)?(?:汉字|中文字|字)/);
  if (zh) return Number(zh[1]);
  const en = raw.match(/(\d{2,6})\s*(?:words|word|characters|chars)\b/i);
  if (en) return Number(en[1]);
  return 0;
}

function cjkLengthBand(target) {
  const n = Number(target) || 0;
  if (!(n > 0)) return null;
  return { target: n, min: Math.round(n * 0.8), max: Math.round(n * 1.2) };
}

/* over：超过目标约 20%，存档前应先压缩。within：落在 80%–120%。 */
function assessCjkLength(text, target) {
  const count = countCjk(text);
  const band = cjkLengthBand(target);
  if (!band) return { count: count, target: 0, min: 0, max: 0, over: false, within: false };
  return {
    count: count,
    target: band.target,
    min: band.min,
    max: band.max,
    over: count > band.max,
    within: count >= band.min && count <= band.max
  };
}

/* 纯英文：有英文字母，且没有汉字、假名、谚文或全角标点。检索片段里的中文不在这里判断。 */
function messageIsPureEnglish(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw || !/[A-Za-z]/.test(raw)) return false;
  if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/.test(raw)) return false;
  return true;
}

function latestUserText(chat) {
  const list = Array.isArray(chat) ? chat : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && m.role === 'user' && m.content) return String(m.content);
  }
  return '';
}

function lengthConstraintClause(userText) {
  const band = cjkLengthBand(parseLengthTarget(userText));
  if (!band) return '';
  return `【篇幅硬约束】用户指定约 ${band.target} 字。按汉字（CJK）计数，成稿应落在 ${band.min}–${band.max}。超过 ${band.max}（约超过目标 20%）必须先压缩，再调用 save_document。`;
}

function replyLanguageClause(userText) {
  if (!messageIsPureEnglish(userText)) return '';
  return '【回复语言】用户这句话是纯英文。最终回复默认用英文。这优先于上文「用中文说明」以及写作规范里的中文输出要求；存档正文仍按用户要写的文体。工具返回和检索片段可以保持中文或英文原文。';
}

const ASSISTANT_LANGUAGE_RULE = '回复语言：用户最新这句话若是纯英文（有英文字母，且没有汉字、日文或韩文），最终回复默认用英文；否则默认用中文。工具返回和检索片段可以仍是中文或英文。';
const ASSISTANT_ASK_RETRY_RULE = '检索不足：若 search_knowledge 以 mode=ask 返回且 unique_docs 少于 3，或结果带有文档不足的 warning，立刻再次调用 search_knowledge，改用 mode=search，并用更宽的中文和英文 query 各查一次。不要停在这一次问答上。';

const ASSISTANT_ENGINE_DOWN_RULE = '【知识库服务未启动】search_knowledge 返回 code=engine_down 时立刻停止：不要继续检索，不要凭记忆或历史对话写稿，不要调用 save_document。直接告诉用户「知识库服务未启动（服务地址）」，并说明先启动 RAG_Snowz 服务，或到「设置 → AI 与知识库引擎」核对地址。';
const ASSISTANT_FRESH_FACTS_RULE = '【只陈述本轮事实】对话历史里较早轮次的报错、检索结果、「已写好」「已保存」都可能已经过时。只把用户最新这句话之后、本轮工具真正返回的内容当作当前事实。不要复述历史里的报错（例如旧版本的「Bridge.xxx is not a function」），也不要说「上一轮已经写好/保存」。只有本轮 save_document 返回了 savedPath，才能说文稿已保存，并写出这个路径。';

function standingChatGuidance() {
  return [WRITING_LENGTH_RULE, ASSISTANT_LANGUAGE_RULE, ASSISTANT_ASK_RETRY_RULE, ASSISTANT_ENGINE_DOWN_RULE, ASSISTANT_FRESH_FACTS_RULE].join('\n');
}

/* ---------- 知识库服务未启动：确定性停止 ---------- */
function kbEndpointHost(endpoint) {
  try {
    const u = new URL(String(endpoint || ''));
    return u.host || '127.0.0.1:8765';
  } catch (_) {
    return '127.0.0.1:8765';
  }
}

function engineDownNotice(endpoint, kbStart) {
  const host = kbEndpointHost(endpoint);
  if (kbStart && kbStart.ok === false && kbStart.code !== 'unconfigured') {
    return `知识库启动失败（${host}）：${kbStart.error || '未知原因'}。本次检索没有拿到任何文献，所以没有写稿，也没有保存任何文稿。\n请检查「设置 → 知识库引擎」里的启动命令，或手动启动知识库服务后再重新发送这句话。`;
  }
  return `知识库服务未启动（${host}）。本次检索没有拿到任何文献，所以没有写稿，也没有保存任何文稿。\n请先启动 RAG_Snowz 服务（默认端口 8765），或到「设置 → AI 与知识库引擎」核对服务地址、填写启动命令（填好后检索时会自动启动）；确认 http://${host}/health 能打开后，再重新发送这句话。`;
}

/* search_knowledge 返回 engine_down 时，界面、派单和 /api/ai/chat 都在这里停下，不再让模型往下写。 */
function isEngineDownResult(name, res) {
  return String(name || '') === 'search_knowledge' && !!res && typeof res === 'object' && res.code === 'engine_down';
}

/* 最终回复里声称「已保存 / 上一轮已写好」，但本轮没有 save_document 的 savedPath；
   或者引用了本轮工具结果里没有的「… is not a function」报错。返回附加说明，没有问题时返回空串。
   results：本轮工具结果 [{ name, result }]。 */
const SAVE_CLAIM_RE = /(?:已经?|已为你|已帮你)(?:保存|存档|落盘|写好|写完)|保存(?:到|至|在)了?\s*[`「"“]?[A-Za-z]:[\\/]|上一轮[^\n。]{0,20}(?:写好|写完|保存|生成|完成)/;
function unverifiedClaimNote(text, results) {
  const t = String(text || '');
  if (!t) return '';
  const list = Array.isArray(results) ? results : [];
  const saved = list.some(x => x && x.name === 'save_document' && x.result && x.result.ok !== false && x.result.savedPath);
  const notes = [];
  if (!saved && SAVE_CLAIM_RE.test(t)) {
    notes.push('本轮没有成功调用 save_document，文稿并未保存；上文若提到「已保存」「已写好」或「上一轮已完成」，以这条为准。');
  }
  const errs = t.match(/[A-Za-z_$][\w$.]*\s+is not a function/g) || [];
  if (errs.length) {
    const blob = list.map(x => { try { return JSON.stringify(x && x.result); } catch (_) { return ''; } }).join('\n');
    if (errs.some(e => !blob.includes(e))) notes.push('上文引用的「… is not a function」报错不是本轮工具返回的，属于历史信息，不代表当前状态。');
  }
  return notes.length ? '（系统核对）' + notes.join('') : '';
}

/* 界面 chat 里本轮的 tool 消息 → [{ name, result }] */
function chatToolResults(msgs) {
  const out = [];
  for (const m of (Array.isArray(msgs) ? msgs : [])) {
    if (!m || m.role !== 'tool') continue;
    let result = null;
    try { result = JSON.parse(m.content || 'null'); } catch (_) { result = null; }
    out.push({ name: m.name, result });
  }
  return out;
}

/* 有具体字数或纯英文时，附在系统提示最后，避免被 Agent 人设里的「用中文」盖住。 */
function turnChatGuidance(userText) {
  return [lengthConstraintClause(userText), replyLanguageClause(userText)].filter(Boolean).join('\n\n');
}

/** 与界面 aiSend 相同的系统提示和历史消息。探测接口复用这一份，避免另写一套人设。 */
function buildApiMessages(p, chat, agent) {
  const dirs = Object.keys(MATERIALS[p.id] || {});
  const userText = latestUserText(chat);
  let sys = `你是「个人 AI 科研工程工作台」的科研助理，当前协助用户管理项目「${p.name}」（项目 ID：${p.id}）。

你可以调用工具读取并修改项目数据，修改会立即写入本地数据文件并在界面上生效。

工作准则：
1. 涉及项目现状（任务、待办、进度、材料目录）时，先调用 get_project_context 或相应的查询工具，不要凭猜测回答。
2. 需要修改数据时直接调用工具完成，不要只给建议让用户自己做。
3. 完成后简洁说明「改了什么」，不要罗列原始 JSON。最终回复用哪种语言，以本提示末尾的回复语言规则为准。
4. 删除类操作先向用户确认，除非用户已明确要求删除。
5. 不要编造项目里不存在的数据；查不到就如实说明。
6. 本项目已有的材料目录：${dirs.join('、') || '（暂无）'} —— create_task 的 material_dir 只能取其中之一。
7. 工作台共有 ${DB.projects.length} 个项目：${DB.projects.map(x => x.name).join('、')}。需要新建项目用 create_project（默认套用「标准科研项目」模板，含材料目录与起始任务）；删除项目必须先征得用户明确同意，再带 confirm=true 调用。
8. 用户询问资料、文献或报告内容时调用 search_knowledge。问答用 mode=ask；写综述或论文用 mode=search，并换中英文多次查询，看 unique_docs 是否凑齐多个 document_id。若 mode=ask 且 unique_docs 少于 3，或结果带有文档不足的 warning，立刻再次调用 search_knowledge，改用 mode=search，并用更宽的中文和英文 query 各查一次。若返回 answer 与 citations，回答里必须写出每条 citation 的 source_relative_path（以及 block_ids，如果有），不要编造路径或引用不存在的片段。检索由本机主进程转发，你看不到知识库服务本身。调用 search_knowledge 时必须显式传入 mode。`;

  if (agent) {
    const tags = (agent.tags || []).filter(Boolean).join('、');
    sys += `

【本轮执行身份】你现在以工作台里的科研 Agent「${agent.name}」身份工作，但仍使用同一套工具与同一个 AI 接入配置。
职责：${agent.role || '（未填写）'}
擅长：${tags || '（未填写）'}
${agent.task ? '手上的任务：' + agent.task : ''}
回答时先一句话说明你以该身份打算怎么处理，然后直接调用工具完成；不要假装自己拥有额外能力。`;
    if (agent.prompt) sys += `

【该 Agent 的专属写作规范（优先级高于上文的一般准则，冲突时以这里为准）】
${agent.prompt}`;
  }

  sys += '\n\n' + standingChatGuidance();
  const turn = turnChatGuidance(userText);
  if (turn) sys += '\n\n' + turn;

  const out = [{ role: 'system', content: sys }];
  for (const m of chat) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id, type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) }
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content || '{}' });
    }
  }
  return out;
}

/* POST /api/ai/chat 的准备步骤：解析项目与身份，拼出和界面相同的消息。
   不往 DB.chats 追加。调用方在工具跑完后用 finishAiProbe 把项目和身份改回去。 */
function prepareAiProbe(rawArgs) {
  const args = rawArgs || {};
  const message = String(args.message || '').trim();
  if (!message) return { ok: false, error: 'message 不能为空' };
  const projectId = String(args.projectId || '').trim();
  if (!projectId) return { ok: false, error: 'projectId 不能为空' };
  const p = (DB.projects || []).find(x => x && (x.id === projectId || x.name === projectId || x.displayName === projectId));
  if (!p) return { ok: false, error: `未找到项目「${projectId}」` };

  const presetKey = String(args.presetKey || '').trim();
  const agentName = String(args.agentName || '').trim();
  let agent = null;
  let switchReason = '';
  if (presetKey) {
    agent = agentList().find(a => a && a.presetKey === presetKey) || null;
    if (!agent) return { ok: false, error: `未知 presetKey「${presetKey}」` };
    switchReason = 'presetKey';
  } else if (agentName) {
    agent = agentList().find(a => a && a.name === agentName) || null;
    if (!agent) return { ok: false, error: `未知 agentName「${agentName}」` };
    switchReason = 'agentName';
  } else {
    agent = agentNamedInText(message);
    if (agent) switchReason = 'message';
  }

  const previousAgent = (typeof state !== 'undefined' && state && state.aiAgent) || '';
  const previousProject = (typeof state !== 'undefined' && state && state.project) || '';
  const switched = !!(agent && agent.name && agent.name !== previousAgent);
  if (typeof state !== 'undefined' && state) {
    if (agent && agent.name) state.aiAgent = agent.name;
    state.project = p.id;
  }
  const messages = buildApiMessages(p, [{ role: 'user', content: message, agent: agent ? agent.name : '' }], agent);
  const ai = DB.ai || {};
  return {
    ok: true,
    projectId: p.id,
    previousProject,
    previousAgent,
    switched,
    switchReason,
    agent: agent ? { name: agent.name, presetKey: agent.presetKey || '', role: agent.role || '' } : null,
    messages,
    tools: (typeof AI_TOOLS !== 'undefined') ? AI_TOOLS : [],
    cfg: {
      provider: ai.provider,
      baseUrl: ai.baseUrl,
      model: ai.model,
      temperature: ai.temperature,
      maxTokens: ai.maxTokens
    }
  };
}

function finishAiProbe(rawArgs) {
  const args = rawArgs || {};
  if (typeof state === 'undefined' || !state) return { ok: true };
  if (Object.prototype.hasOwnProperty.call(args, 'projectId')) state.project = args.projectId || '';
  if (Object.prototype.hasOwnProperty.call(args, 'aiAgent')) state.aiAgent = args.aiAgent || '';
  return { ok: true };
}

/* 改名时把仍指向旧名字的引用一起改掉，避免任务、项目关联和派单历史变成孤儿。
   不改 Agent 自己的 name —— 由调用方写回那一条记录（保留 id / presetKey / 统计）。 */
function renameAgentRefs(data, oldName, newName) {
  if (!data) return 0;
  const from = String(oldName || '');
  const to = String(newName || '');
  if (!from || from === to) return 0;
  let n = 0;
  const hit = () => { n += 1; };

  (Array.isArray(data.tasks) ? data.tasks : []).forEach(t => {
    if (t && t.agent === from) { t.agent = to; hit(); }
  });
  (Array.isArray(data.projects) ? data.projects : []).forEach(p => {
    if (!p) return;
    if (Array.isArray(p.agents)) {
      const next = p.agents.map(name => {
        if (name !== from) return name;
        hit();
        return to;
      });
      p.agents = next.filter((name, i) => next.indexOf(name) === i);
    }
    if (p.owner && p.owner.agent === from) { p.owner.agent = to; hit(); }
  });
  (Array.isArray(data.agentJobs) ? data.agentJobs : []).forEach(j => {
    if (j && j.agent === from) { j.agent = to; hit(); }
  });
  (Array.isArray(data.templates) ? data.templates : []).forEach(tpl => {
    if (!tpl || !Array.isArray(tpl.tasks)) return;
    tpl.tasks = tpl.tasks.map(row => {
      if (Array.isArray(row)) {
        if (row[1] !== from) return row;
        hit();
        return [row[0], to].concat(row.slice(2));
      }
      if (row && typeof row === 'object' && row.agent === from) {
        hit();
        return Object.assign({}, row, { agent: to });
      }
      return row;
    });
  });
  if (data.chats && typeof data.chats === 'object') {
    Object.keys(data.chats).forEach(k => {
      const list = data.chats[k];
      if (!Array.isArray(list)) return;
      list.forEach(m => {
        if (m && m.agent === from) { m.agent = to; hit(); }
      });
    });
  }
  if (typeof AGENT_COLORS !== 'undefined' && AGENT_COLORS && AGENT_COLORS[from]) {
    if (!AGENT_COLORS[to]) AGENT_COLORS[to] = AGENT_COLORS[from];
    delete AGENT_COLORS[from];
  }
  if (typeof PROJECT_TEMPLATE !== 'undefined' && PROJECT_TEMPLATE && Array.isArray(PROJECT_TEMPLATE.tasks)) {
    PROJECT_TEMPLATE.tasks = PROJECT_TEMPLATE.tasks.map(row => {
      if (Array.isArray(row) && row[1] === from) return [row[0], to].concat(row.slice(2));
      if (row && typeof row === 'object' && row.agent === from) return Object.assign({}, row, { agent: to });
      return row;
    });
  }
  if (typeof state !== 'undefined' && state && state.aiAgent === from) state.aiAgent = to;
  return n;
}
const APP = n => DB.apps.find(a => a.n === n);
const T = i => DB.tasks[i];
