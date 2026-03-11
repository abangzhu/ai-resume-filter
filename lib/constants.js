/**
 * CVFilterX - Shared Constants
 * Message types, default settings, default dimensions, system prompt
 */

const MSG = Object.freeze({
  SCORE_RESUME:        'SCORE_RESUME',
  SCORE_RESULT:        'SCORE_RESULT',
  GET_SETTINGS:        'GET_SETTINGS',
  SAVE_SETTINGS:       'SAVE_SETTINGS',
  GET_SCORES:          'GET_SCORES',
  TEST_CONNECTION:     'TEST_CONNECTION',
  FETCH_JD:            'FETCH_JD',
  CAPTURE_RESUME_IMAGE:'CAPTURE_RESUME_IMAGE',
  OPEN_OPTIONS:        'OPEN_OPTIONS',
  GET_TEMPLATES:       'GET_TEMPLATES',
  SAVE_TEMPLATE:       'SAVE_TEMPLATE',
  DELETE_TEMPLATE:     'DELETE_TEMPLATE',
  CLONE_TEMPLATE:      'CLONE_TEMPLATE',
  GET_JOB_TEMPLATE:    'GET_JOB_TEMPLATE',
  SET_JOB_TEMPLATE:    'SET_JOB_TEMPLATE',
  MATCH_TEMPLATE:      'MATCH_TEMPLATE',
  START_BATCH:         'START_BATCH',
  STOP_BATCH:          'STOP_BATCH',
  GET_PAGE_TYPE:       'GET_PAGE_TYPE',
  GET_CANDIDATE_COUNT: 'GET_CANDIDATE_COUNT',
  SCORE_CURRENT:       'SCORE_CURRENT',
  TEMPLATE_CHANGED:    'TEMPLATE_CHANGED',
  TASK_PROGRESS:       'TASK_PROGRESS',
  SET_DEFAULT_TEMPLATE:'SET_DEFAULT_TEMPLATE',
});

const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  autoPaginateDelay: 2000,
  skipScored: true,
  cacheExpireDays: 7,
  fieldConfig: {
    basicInfo: true,
    education: true,
    workExperience: true,
    projectExperience: true,
    skills: true,
    selfIntroduction: true,
  },
});

const DEFAULT_DIMENSIONS = Object.freeze([
  {
    key: 'educationMatch',
    label: '学历匹配',
    description: '候选人学历、专业与岗位要求的匹配程度',
    weight: 20,
  },
  {
    key: 'experienceMatch',
    label: '经验匹配',
    description: '工作年限、行业背景与岗位要求的匹配程度',
    weight: 30,
  },
  {
    key: 'skillMatch',
    label: '技能匹配',
    description: '技术技能、工具与岗位要求的匹配程度',
    weight: 30,
  },
  {
    key: 'stability',
    label: '工作稳定性',
    description: '历史工作年限分布，评估跳槽频率',
    weight: 10,
  },
  {
    key: 'growthPotential',
    label: '成长潜力',
    description: '职业发展轨迹、晋升节奏与成长空间',
    weight: 10,
  },
]);

const SYSTEM_PROMPT_DEFAULT = `你是一名专业的招聘评估助手。根据提供的岗位描述（JD）和候选人简历，按照指定维度对候选人进行客观评估。
输出必须是合法的 JSON，不要包含任何 markdown 代码块或额外说明文字。`;

const PROMPT_SECTION_DEFAULTS = Object.freeze({
  roleSetup: `你是一名专业招聘评估官，具备结构化分析能力。
你的任务是：基于给定的 JD 和候选人简历，从多个维度进行客观量化评分，并给出详细分析。
禁止主观臆测，禁止编造简历中未出现的信息。
所有结论必须基于文本证据。`,

  taskGuide: `请根据【职位描述 JD】与【候选人简历】，对候选人进行多维度评估。

你必须：
1. 逐条对比 JD 要求
2. 从多个维度打分（0-10分）
3. 给出每个维度的评分理由
4. 计算加权总分
5. 判断是否建议进入下一轮
6. 标记是否触发"硬性条件不满足"`,

  outputRules: `评分规则：
- recommendation: 根据各维度综合判断，整体契合度高为 pass，基本符合为 hold，差距较大为 reject
- 每个 highlights/concerns 控制在 1 句话内`,
});
