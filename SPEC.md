# CVFilterX — 飞书招聘简历智能筛选插件 技术规格说明

## 1. 项目概述

### 1.1 背景
招聘人员在飞书招聘中逐条审阅简历效率低下，缺乏标准化评估体系。本插件通过自动提取简历信息和岗位 JD，调用 LLM 对每位候选人进行多维度评分，并将结果直接叠加展示在飞书招聘页面上，辅助快速筛选决策。

### 1.2 目标用户
个人使用，招聘负责人在已登录飞书招聘 Web 版后使用。

### 1.3 支持浏览器
- Google Chrome（Manifest V3）
- Microsoft Edge（Manifest V3）

---

## 2. 核心功能

| 功能模块 | 描述 |
|---------|------|
| JD 自动抓取 | 从飞书招聘当前岗位页面自动提取职位描述 |
| 简历自动翻页 | 自动翻阅候选人列表，逐条抓取简历内容 |
| 字段配置 | 用户可配置需要提取的简历字段范围 |
| LLM 评分 | 调用 OpenAI 兼容接口，对简历进行多维度打分 |
| 结果叠加展示 | 在飞书招聘页面内嵌显示评分结果 |
| 持久化存储 | 保存历史评分，刷新后可查阅 |
| 设置管理 | 配置 API Key、Base URL、模型、Prompt 模板等 |

---

## 3. 技术架构

```
┌─────────────────────────────────────────────────────┐
│                   Chrome Extension                   │
│                                                     │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │   Popup UI  │    │     Content Script        │   │
│  │  (设置入口)  │    │  - DOM 解析（JD + 简历）  │   │
│  │  (进度展示)  │    │  - 自动翻页控制           │   │
│  └──────┬──────┘    │  - 结果浮层渲染           │   │
│         │           └────────────┬─────────────┘   │
│         │                        │                  │
│  ┌──────▼────────────────────────▼─────────────┐   │
│  │           Background Service Worker          │   │
│  │  - LLM API 调用（绕过 CORS）                 │   │
│  │  - 任务队列管理                              │   │
│  │  - chrome.storage 读写                       │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         │
         ▼
   OpenAI Compatible API
   (configurable base URL)
```

### 3.1 Extension 文件结构

```
cvfilterx/
├── manifest.json
├── background/
│   └── service-worker.js       # API 调用 + 存储管理
├── content/
│   ├── content.js              # 主逻辑：DOM 解析 + 翻页 + UI 注入
│   ├── extractor.js            # 简历/JD 字段提取
│   ├── paginator.js            # 自动翻页控制器
│   └── overlay.js              # 评分结果浮层组件
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html            # 完整设置页面
│   ├── options.js
│   └── options.css
└── assets/
    └── icon*.png
```

---

## 4. 飞书招聘页面分析

### 4.1 目标页面 URL 模式

```
# 招聘职位列表
https://recruitment.feishu.cn/*/position/*

# 候选人列表（含简历）
https://recruitment.feishu.cn/*/candidate/*

# 候选人详情
https://recruitment.feishu.cn/*/candidate/detail/*
```

### 4.2 数据抓取策略

飞书招聘为 SPA（单页应用），DOM 动态渲染。抓取策略：

1. **JD 抓取**：在职位详情页通过 `MutationObserver` 监听 DOM 就绪后提取
2. **简历抓取**：在候选人详情页 DOM 渲染完成后提取目标字段
3. **翻页控制**：模拟点击候选人列表中的"下一个"按钮，等待新候选人详情加载完成后再提取

### 4.3 DOM 等待机制

```javascript
// 等待目标元素出现（最长 10s）
async function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, timeout);
  });
}
```

---

## 5. 数据模型

### 5.1 简历字段（ResumeData）

```typescript
interface ResumeData {
  candidateId: string;          // 飞书候选人唯一 ID（从 URL 或 DOM 提取）
  candidateName: string;
  extractedAt: number;          // Unix timestamp

  // 以下字段可通过「字段配置」开启/关闭
  basicInfo?: {
    age?: string;
    gender?: string;
    location?: string;
    phone?: string;
    email?: string;
    currentTitle?: string;
    currentCompany?: string;
    yearsOfExperience?: string;
  };
  education?: Array<{
    school: string;
    degree: string;             // 本科/硕士/博士/专科
    major: string;
    startYear: string;
    endYear: string;
  }>;
  workExperience?: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate: string;
    description: string;
  }>;
  projectExperience?: Array<{
    name: string;
    role: string;
    description: string;
  }>;
  skills?: string[];            // 技能标签列表
  selfIntroduction?: string;
}
```

### 5.2 评分结果（ScoreResult）

```typescript
interface ScoreResult {
  candidateId: string;
  jobId: string;                // 关联的岗位 ID
  scoredAt: number;

  // 三档建议
  recommendation: 'pass' | 'hold' | 'reject';

  // 多维度评分（每项 0-10 分，权重可配置）
  dimensions: {
    educationMatch: { score: number; comment: string; };
    experienceMatch: { score: number; comment: string; };
    skillMatch:      { score: number; comment: string; };
    stabilityScore:  { score: number; comment: string; }; // 工作稳定性
    growthPotential: { score: number; comment: string; }; // 成长潜力
    // 用户可在设置中增删维度
  };

  overallScore: number;         // 加权总分 0-100
  summary: string;              // 100 字内综合点评
  highlights: string[];         // 亮点列表（1-3条）
  concerns: string[];           // 关注点列表（1-3条）

  modelUsed: string;
  promptVersion: string;        // 便于复现和回溯
}
```

### 5.3 JD 数据（JobData）

```typescript
interface JobData {
  jobId: string;
  jobTitle: string;
  department?: string;
  rawJD: string;               // 原始 JD 文本
  capturedAt: number;
}
```

### 5.4 存储结构（chrome.storage.local）

```
{
  // 设置
  "settings": {
    "apiKey": string,
    "baseUrl": string,          // 默认 "https://api.openai.com/v1"
    "model": string,            // 默认 "gpt-4o-mini"
    "promptTemplate": string,
    "fieldConfig": FieldConfig,
    "dimensionConfig": DimensionConfig,
    "autoPaginateDelay": number // 翻页间隔，单位 ms，默认 2000
  },

  // 当前会话 JD（按 jobId 缓存）
  "jobs": { [jobId]: JobData },

  // 评分结果（按 candidateId 存储）
  "scores": { [candidateId]: ScoreResult },

  // 任务状态（用于 Popup 展示进度）
  "taskState": {
    "isRunning": boolean,
    "current": number,
    "total": number,
    "currentCandidateName": string,
    "errors": string[]
  }
}
```

---

## 6. 核心流程

### 6.1 完整运行流程

```
用户打开飞书招聘候选人列表
        │
        ▼
Content Script 检测到目标页面
        │
        ├──► 自动抓取当前岗位 JD（若未缓存）
        │
        ▼
用户点击插件 Popup → 「开始筛选」按钮
        │
        ▼
┌─── 翻页循环 ────────────────────────────────┐
│   1. 等待候选人详情页 DOM 渲染完成           │
│   2. 提取简历字段（按 FieldConfig 过滤）     │
│   3. 若已有评分 → 跳过（显示缓存结果）       │
│   4. 构建 Prompt → 发送给 Background Worker │
│   5. Background Worker 调用 OpenAI API      │
│   6. 解析返回结果 → 写入 chrome.storage     │
│   7. Content Script 渲染评分浮层            │
│   8. 等待 autoPaginateDelay ms             │
│   9. 点击「下一个」候选人                   │
│  10. 检测是否到达末尾 → 若是，结束循环       │
└─────────────────────────────────────────────┘
        │
        ▼
Popup 展示完成统计（通过/待定/淘汰 各多少人）
```

### 6.2 Prompt 构建

```
[System Prompt]
你是一名专业的招聘评估助手。根据提供的岗位描述（JD）和候选人简历，
按照指定维度对候选人进行客观评估。输出严格遵循 JSON 格式。

[User Prompt]
## 岗位描述
{jobData.rawJD}

## 候选人简历
{JSON.stringify(resumeData)}

## 评估要求
请从以下维度评分（0-10分），并给出三档推荐（pass/hold/reject）：
{dimensionConfig 中的维度列表及权重}

## 输出格式
{ScoreResult JSON Schema}
```

### 6.3 错误处理

| 场景 | 处理方式 |
|------|---------|
| API Key 未配置 | Popup 提示，跳转设置页 |
| API 调用失败（网络/超时） | 重试 1 次，失败后标记该候选人为 error，继续下一个 |
| API 返回非 JSON | 尝试正则提取 JSON，失败则记录原始响应供调试 |
| DOM 元素未找到（页面结构变更） | 超时后跳过，在 Popup 中显示警告 |
| 翻页到末尾无下一条 | 正常终止循环 |
| 用户手动停止 | Popup 提供「停止」按钮，通过 Message 通知 Content Script |

---

## 7. UI 设计

### 7.1 评分浮层（Overlay）

注入在候选人详情页的右上角，固定定位，不干扰原有布局。

```
┌─────────────────────────────────┐
│  CVFilterX         ● 已评分     │
├─────────────────────────────────┤
│  综合评分         78 / 100      │
│  推荐建议      ✅ 通过          │
├─────────────────────────────────┤
│  学历匹配        8/10  ████░    │
│  经验匹配        7/10  ███░░    │
│  技能匹配        9/10  ████░    │
│  工作稳定性      6/10  ███░░    │
│  成长潜力        8/10  ████░    │
├─────────────────────────────────┤
│  亮点                           │
│  • 5年以上相关经验               │
│  • 技术栈高度匹配                │
│  关注点                         │
│  • 最近一份工作仅8个月           │
├─────────────────────────────────┤
│  综合点评                       │
│  候选人经验丰富，技术栈匹配度高， │
│  但稳定性有待关注。              │
├─────────────────────────────────┤
│  [收起]              [重新评分]  │
└─────────────────────────────────┘
```

**状态说明：**
- `● 评分中...` — LLM 正在处理（spinner）
- `● 已评分` — 显示缓存结果（绿点）
- `● 跳过` — 该候选人被用户手动跳过
- `● 失败` — API 调用失败（红点，可重试）

### 7.2 Popup

```
┌──────────────────────────────┐
│  CVFilterX  ⚙️               │
├──────────────────────────────┤
│  当前岗位：前端工程师          │
│  JD 状态：✅ 已抓取           │
├──────────────────────────────┤
│  [▶ 开始筛选]  [⏹ 停止]      │
├──────────────────────────────┤
│  进度：12 / 35               │
│  ████████░░░░░  34%          │
│  正在处理：张三               │
├──────────────────────────────┤
│  结果统计                    │
│  ✅ 通过    5  (42%)         │
│  ⏸ 待定    4  (33%)         │
│  ❌ 淘汰    3  (25%)         │
├──────────────────────────────┤
│  [导出结果 CSV]              │
└──────────────────────────────┘
```

### 7.3 设置页（Options）

分为四个 Tab：

**① API 设置**
- API Key（密码框）
- Base URL（默认 `https://api.openai.com/v1`）
- 模型名称（文本框 + 常用模型快选：gpt-4o / gpt-4o-mini / gpt-3.5-turbo）
- [测试连接] 按钮

**② 字段配置**
- 复选框列表：基本信息 / 教育背景 / 工作经历 / 项目经历 / 技能标签 / 自我介绍
- 每个大类可展开选择子字段

**③ 评分维度**
- 维度列表（可增删），每项包含：
  - 维度名称
  - 描述（用于 Prompt）
  - 权重（滑块，所有维度权重之和自动归一化）

**④ 高级设置**
- System Prompt 模板（大文本框，支持变量 `{jd}` `{resume}` `{dimensions}`）
- 翻页延迟（ms，默认 2000，范围 500-10000）
- 是否跳过已评分候选人（默认开启）
- 评分缓存有效期（天，默认 7 天，0 表示永久）

---

## 8. LLM 集成规格

### 8.1 API 调用

```javascript
// Background Service Worker
async function callLLM(prompt, settings) {
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(settings) },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },  // 强制 JSON 输出
      temperature: 0.3,   // 低随机性，保证评分一致性
      max_tokens: 1500
    })
  });
  // ...
}
```

### 8.2 Token 估算

| 内容 | 估算 Token 数 |
|------|-------------|
| System Prompt | ~300 |
| JD（典型） | ~500 |
| 简历（典型） | ~800 |
| 输出 | ~600 |
| **总计** | **~2200 / 次** |

使用 `gpt-4o-mini` 成本约 $0.00066/次，100 份简历约 $0.066。

---

## 9. manifest.json

```json
{
  "manifest_version": 3,
  "name": "CVFilterX",
  "version": "1.0.0",
  "description": "飞书招聘智能简历筛选助手",
  "permissions": [
    "storage",
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "https://recruitment.feishu.cn/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [{
    "matches": [
      "https://recruitment.feishu.cn/*"
    ],
    "js": ["content/content.js"],
    "run_at": "document_idle"
  }],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": { "32": "assets/icon32.png" }
  },
  "options_page": "options/options.html",
  "icons": { "32": "assets/icon32.png", "128": "assets/icon128.png" }
}
```

---

## 10. 模块间通信

使用 `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`：

```typescript
// 消息类型定义
type Message =
  | { type: 'START_BATCH';  jobId: string }
  | { type: 'STOP_BATCH' }
  | { type: 'SCORE_RESUME'; resumeData: ResumeData; jobData: JobData }
  | { type: 'SCORE_RESULT'; result: ScoreResult }
  | { type: 'TASK_PROGRESS'; state: TaskState }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Settings };
```

---

## 11. 开发阶段规划

### Phase 1 — 基础骨架（MVP）
- [ ] manifest.json + 项目结构搭建
- [ ] Options 页面：API 设置 + 存储
- [ ] Content Script：JD 抓取 + 单条简历提取
- [ ] Background：LLM API 调用封装
- [ ] 评分结果浮层（基础版）

### Phase 2 — 自动翻页 + 批量处理
- [ ] 自动翻页控制器（paginator.js）
- [ ] 任务队列 + 进度状态管理
- [ ] Popup：进度展示 + 开始/停止控制
- [ ] 跳过已评分候选人逻辑

### Phase 3 — 配置与体验完善
- [ ] 字段配置 Tab
- [ ] 评分维度自定义 Tab
- [ ] Prompt 模板编辑
- [ ] 错误处理 + 重试机制
- [ ] CSV 导出

### Phase 4 — 测试与发布
- [ ] 飞书招聘 DOM 结构兼容性测试
- [ ] API 兼容性测试（OpenAI / Azure / 本地代理）
- [ ] Chrome Web Store 发布准备

---

## 12. 关键约束与注意事项

1. **不存储简历原文**：`chrome.storage.local` 仅存储评分结果和配置，不缓存原始简历文本，避免隐私风险。

2. **飞书 DOM 脆弱性**：飞书招聘前端随版本更新可能调整 DOM 结构，`extractor.js` 需集中管理所有选择器，方便快速修复。建议使用多个备选选择器（fallback chain）。

3. **翻页稳定性**：每次翻页前检查「下一个」按钮是否存在且可点击，避免在最后一条候选人时死循环。

4. **API Key 安全**：API Key 存储在 `chrome.storage.local`，不会发送给任何非目标 API 端点。Options 页面以密码框显示。

5. **速率限制**：`autoPaginateDelay` 默认 2000ms，给 LLM API 调用留出时间，避免并发超出速率限制。LLM 调用本身在 Background Worker 中串行执行。
