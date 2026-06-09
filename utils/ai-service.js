/**
 * AI 服务封装
 * 支持 MiniMax（Anthropic 兼容格式）和 DeepSeek（OpenAI 兼容格式）
 */

export const MINIMAX_MODELS = [
  { value: 'MiniMax-M3', label: 'MiniMax-M3（默认，最强推理）' },
  { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7（自迭代，60 TPS）' },
  { value: 'MiniMax-M2.7-highspeed', label: 'MiniMax-M2.7-highspeed（极速，100 TPS）' },
  { value: 'MiniMax-M2.5', label: 'MiniMax-M2.5（高性价比，60 TPS）' },
  { value: 'MiniMax-M2.5-highspeed', label: 'MiniMax-M2.5-highspeed（极速，100 TPS）' }
];

const MINIMAX_BASE_URL = 'https://api.minimaxi.com/anthropic/v1/messages';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1/chat/completions';

const SYSTEM_PROMPT = `你是一位求职沟通高级助手，帮助"求职者本人"在招聘平台（如BOSS直聘）上向招聘方（HR/Boss）发送第一句打招呼语。

【关键角色定义，务必牢记】
- "我的简历"中的人 = 求职者本人 = 你要扮演的说话人（第一人称"我"）
- "职位描述(JD)"是招聘方发布的岗位，JD里出现的人名是招聘方/HR，不是求职者
- 你要生成的是：求职者主动发给招聘方的打招呼语

【输出要求】
1. 以求职者第一人称"我"的口吻书写
2. 50字以内，简洁诚恳，突出我（求职者）与该岗位最匹配的1-2个亮点
3. 不要替招聘方说话，不要把简历主人当成招聘方
4. 不要编造简历中没有的经历
5. 不要使用对方（招聘方）的姓名来称呼，开头可用"您好"即可
6. 直接输出打招呼语正文，不要任何前缀、解释或引号
7. 要抓住JD每一条招聘要求，总结该岗位的重点结合简历去生成打招呼语，不要偏离JD的重点`;

/**
 * 调用 MiniMax API（Anthropic 兼容格式）
 */
export async function callMiniMax({ apiKey, model = 'MiniMax-M3', jd, resume }) {
  const prompt = buildPrompt(jd, resume);

  const body = {
    model,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }]
      }
    ]
  };

  // M3 关闭 thinking 加快响应
  if (model === 'MiniMax-M3') {
    body.thinking = { type: 'disabled' };
  }

  const response = await fetch(MINIMAX_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`MiniMax API 错误 ${response.status}: ${errText || response.statusText}`);
  }

  const data = await response.json();

  // 提取文本内容（跳过 thinking 块）
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('MiniMax 返回格式异常，未找到文本内容');
  }

  return textBlock.text.trim();
}

/**
 * 调用 DeepSeek API（OpenAI 兼容格式）
 */
export async function callDeepSeek({ apiKey, jd, resume }) {
  const prompt = buildPrompt(jd, resume);

  const body = {
    model: 'deepseek-chat',
    max_tokens: 200,
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]
  };

  const response = await fetch(DEEPSEEK_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`DeepSeek API 错误 ${response.status}: ${errText || response.statusText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('DeepSeek 返回格式异常，未找到文本内容');
  }

  return text.trim();
}

function buildPrompt(jd, resume) {
  return `下面是我要应聘的【职位描述】（由招聘方发布）：
"""
${jd.slice(0, 2000)}
"""

下面是【我（求职者本人）的简历】：
"""
${resume.slice(0, 2000)}
"""

请以我（求职者）的第一人称口吻，生成一句发给招聘方的打招呼语，突出我与该岗位的匹配点。`;
}

const MATCH_SCORE_SYSTEM_PROMPT = `你是一位招聘匹配分析专家。根据职位描述(JD)和求职者简历，评估契合程度。

【输出要求】
1. 只输出一个 0-100 的整数，表示匹配百分比
2. 不要输出任何其他文字、符号或解释
3. 评分需实事求是，综合考虑：技能匹配、工作经验、学历要求、行业背景、岗位职责相关性
4. 明显不匹配的岗位应给低分（如技能栈完全不同、经验年限差距大）`;

function buildMatchScorePrompt(jd, resume) {
  return `【职位描述】
"""
${jd.slice(0, 2000)}
"""

【求职者简历】
"""
${resume.slice(0, 2000)}
"""

请给出该简历与该职位的契合度百分比（0-100 整数）。`;
}

/** 从 AI 回复中解析 0-100 的匹配分数 */
export function parseMatchScore(text) {
  if (!text) return null;
  const nums = text.match(/\d{1,3}/g);
  if (!nums) return null;
  for (const raw of nums) {
    const n = parseInt(raw, 10);
    if (n >= 0 && n <= 100) return n;
  }
  const n = parseInt(nums[0], 10);
  return Math.min(100, Math.max(0, n));
}

export async function callMiniMaxMatchScore({ apiKey, model = 'MiniMax-M3', jd, resume }) {
  const body = {
    model,
    max_tokens: 16,
    system: MATCH_SCORE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: buildMatchScorePrompt(jd, resume) }] }]
  };
  if (model === 'MiniMax-M3') body.thinking = { type: 'disabled' };

  const response = await fetch(MINIMAX_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`MiniMax API 错误 ${response.status}: ${errText || response.statusText}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  const score = parseMatchScore(textBlock?.text?.trim());
  if (score === null) throw new Error('无法解析匹配分数');
  return score;
}

export async function callDeepSeekMatchScore({ apiKey, jd, resume }) {
  const body = {
    model: 'deepseek-chat',
    max_tokens: 16,
    temperature: 0.2,
    messages: [
      { role: 'system', content: MATCH_SCORE_SYSTEM_PROMPT },
      { role: 'user', content: buildMatchScorePrompt(jd, resume) }
    ]
  };

  const response = await fetch(DEEPSEEK_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`DeepSeek API 错误 ${response.status}: ${errText || response.statusText}`);
  }

  const data = await response.json();
  const score = parseMatchScore(data.choices?.[0]?.message?.content?.trim());
  if (score === null) throw new Error('无法解析匹配分数');
  return score;
}
