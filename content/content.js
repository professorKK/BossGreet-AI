/**
 * Content Script - 提取当前页面的职位 JD
 * 策略：用 TreeWalker 在 DOM 中定位「职位描述」可见文本节点，
 *      从其容器提取正文，自动跳过 script/style/noscript 噪声
 *      并通过可见性过滤排除列表中隐藏的其他职位卡片
 */

// 防止重复注入
if (window.__bossAIInjected) {
  // 已注入，直接退出
} else {
window.__bossAIInjected = true;

// 遇到这些关键词就截断（JD 正文之后的页面噪声）
const NOISE_CUTOFF = [
  '工作地址', '去App', '前往App', '下载APP', '下载BOSS直聘', '微信服务号', '微博号',
  '求职工具', '举报', '刚刚活跃', '今天活跃', '本周活跃', '本月活跃', '升级VIP',
  '咨询客服', '热门职位', '热门城市', '热门企业', '微信扫码分享', '一键扫码',
  '查看更多', '附近城市', '该公司其他在招职位', '相似职位',
  'BOSS 安全提示', 'BOSS安全提示', '公司介绍', '工商信息',
];

// BOSS 整行噪声
const BOSS_NOISE_LINES = [
  /^[：:]$/, /^职位描述$/, /^职位详情$/,
  /^继续沟通$/, /^立即沟通$/, /^感兴趣$/, /^收藏$/,
  /^聊一聊$/, /^已认证$/, /^查看全部$/,
  /^(今天|本周|本月|刚刚)活跃$/,
  /^[\u4e00-\u9fa5]{2,4}(先生|女士)$/,
  /^微信扫码分享$/, /^举\s*报$/,
];

// BOSS 直聘锚点
const JD_ANCHORS = [
  '职位描述', '职位详情', '岗位职责', '职位职责',
  '核心职责', '核⼼职责', '岗位信息', '岗位亮点',
];

// BOSS JD 正文章节标题
const BOSS_SECTION_HEADERS = [
  '岗位职责', '任职要求', '核心职责', '核⼼职责',
  '岗位信息', '岗位亮点', '职位描述', '职位介绍',
  '硬性', '加分', '能力',
];

// 猎聘锚点
const LIEPIN_JD_ANCHORS = ['职位介绍', '职位描述', '岗位职责'];

// BOSS 直聘 JD 正文 CSS 选择器（按优先级）
const JD_SELECTORS = [
  '.job-sec-text:not(.fold-text)',
  '.job-sec-text',
  '.job-detail .detail-content',
  '.job-sec .text',
  '.job-detail-section .text',
];

// BOSS 主内容区
const MAIN_CONTENT_SELECTORS = [
  '.job-detail-box',
  '.job-detail',
  '.job-box',
  '[class*="job-detail"]',
  '[class*="job-sec"]',
  'main',
];

// 猎聘 JD 选择器
const LIEPIN_JD_SELECTORS = [
  '[class*="job-intro"]',
  '[class*="job-detail-box"]',
  '.job-intro-content',
  '.job-qualification-content',
  '.content-word',
  '.job-introduction',
  '#job-intro',
  '.job-desc',
  '[data-selector="job-intro"]',
];

// 猎聘主内容区
const LIEPIN_MAIN_CONTENT_SELECTORS = [
  '[class*="job-detail-box"]',
  '.job-apply-container',
  '[class*="job-apply"]',
  '[class*="job-intro"]',
  '[class*="job-detail"]',
  'main',
];

const LIEPIN_JD_MARKERS = /岗位职责|职位介绍|任职要求|核心职责/;

// 猎聘噪声截断词
const LIEPIN_NOISE_CUTOFF = [
  '其他信息', '公司简介', '猎聘温馨提示', '上班地址', '工作地址',
  '投诉建议', '猎聘APP', '相似职位', '推荐职位', '猜你喜欢',
];

// 猎聘整行噪声（导航/按钮/标签）
const LIEPIN_NOISE_LINES = [
  /^邀请应聘$/, /^我的投递$/, /^我的收藏$/, /^我的沟通$/,
  /^猎聘APP$/, /^投诉建议$/, /^聊一聊$/, /^收藏$/,
  /^微信分享/, /^微信扫一扫$/, /^扫码$/, /^转发给你的朋友/,
  /^已认证$/, /^查看全部$/, /^招\d+人$/, /^\d+月\d+日更新$/,
  /^行业要求/, /^全部行业$/,
  /^\d+[-~]\d+k/, /^本科$/, /^硕士$/, /^博士$/, /^\d+-\d+年$/,
  /^(五险一金|年终奖金|餐费补贴|领导好|发展空间大|扁平管理|团队聚餐|弹性工作)$/,
];

/** 元素是否真实可见（排除隐藏卡片 / 离屏面板） */
function isVisible(el) {
  if (!el || el === document.body) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** 在多个候选元素中找可见且含 JD 内容的最佳容器 */
function findBestJDContainer(selectors, marker = LIEPIN_JD_MARKERS) {
  let best = null;
  let bestLen = 0;
  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (!isVisible(el)) return;
        const t = (el.innerText || el.textContent || '').trim();
        if (!marker.test(t) || t.length < 80 || t.length > 20000) return;
        if (t.length > bestLen) {
          bestLen = t.length;
          best = el;
        }
      });
    } catch (e) { /* ignore */ }
  }
  return best;
}

/** 定位页面主内容容器，避免在顶栏/隐藏卡片中搜索 */
function getMainContentRoot(selectors = MAIN_CONTENT_SELECTORS) {
  const best = findBestJDContainer(selectors, /岗位职责|任职要求|职位描述|核心职责/);
  if (best) return best;
  for (const sel of selectors) {
    try {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return el;
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

function getLiepinMainContentRoot() {
  return findBestJDContainer(LIEPIN_MAIN_CONTENT_SELECTORS)
    || getMainContentRoot(LIEPIN_MAIN_CONTENT_SELECTORS);
}

/** 判断提取结果是否像顶部导航菜单（误抓兜底） */
function looksLikeNavMenu(text) {
  if (!text) return false;
  const hasBrand = text.includes('BOSS直聘');
  const hasNav = text.includes('首页') || text.includes('简历');
  const hasResumeMenu = text.includes('AI简历') || text.includes('智能简历生成');
  return hasBrand && hasNav && hasResumeMenu;
}

function looksLikeLiepinNav(text) {
  if (!text) return false;
  const navHits = ['邀请应聘', '我的投递', '猎聘APP', '我的沟通', '聊一聊'].filter(k => text.includes(k));
  return navHits.length >= 2 && !text.includes('岗位职责');
}

/** 从页面提取职位标题 */
function extractJobTitle() {
  const titleSelectors = ['.job-banner .name', '.job-detail .name', '.name h1', 'h1'];
  for (const sel of titleSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        const title = cleanTitle((el.innerText || el.textContent || '').trim());
        if (title.length >= 2) return title;
      }
    } catch (e) { /* ignore */ }
  }
  return '';
}

/** 组装 JD 输出（标题 + 标签 + 正文） */
function formatJDResult(jdContent, title, tags) {
  const parts = [];
  if (title) parts.push(`职位：${title}`);
  if (tags) parts.push(`要求：${tags}`);
  parts.push('');
  parts.push(jdContent);
  return parts.join('\n');
}

/** 要求行去重：去掉与职位名重复的标签 */
function sanitizeTags(tags, title) {
  if (!tags) return '';
  const titleNorm = (title || '').replace(/\s/g, '');
  const parts = tags.split(/[·•]/).map(s => s.trim()).filter(Boolean);
  const filtered = parts.filter(p => {
    const pNorm = p.replace(/\s/g, '');
    if (!pNorm || pNorm === titleNorm) return false;
    if (titleNorm && (titleNorm.includes(pNorm) || pNorm.includes(titleNorm))) return false;
    if (p.length > 30) return false;
    return true;
  });
  return filtered.join(' · ');
}

/** 是否为 BOSS JD 正文章节标题 */
function isBossSectionHeader(line) {
  if (!line) return false;
  return BOSS_SECTION_HEADERS.some(h =>
    line === h || line.startsWith(h + '：') || line.startsWith(h + ':')
  );
}

function findFirstSectionIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (isBossSectionHeader(lines[i])) return i;
  }
  return 0;
}

/** 判断是否为技能标签行（章节标题之前的灰色 tag） */
function isSkillTagLine(line) {
  if (!line || line.length > 22) return false;
  if (isBossSectionHeader(line)) return false;
  if (/^[0-9]+[、.．)]/.test(line)) return false;
  if (/^\d+[-~～]\d+年|^(本科|硕士|博士|大专|学历不限|经验不限)$/.test(line)) return false;
  if (/^[：:]$/.test(line)) return false;
  return true;
}

/** 是否为公司介绍（非 JD 正文） */
function isCompanyIntro(text) {
  return (/公司于|成立于|查看全部|轮融资/.test(text))
    && !/岗位职责|任职要求|核心职责|核⼼职责|岗位信息/.test(text);
}

/** 合并 BOSS 页面多个 JD 区块（地图页岗位职责/任职要求常分属不同 DOM） */
function collectBossJDSections(root) {
  root = root || getMainContentRoot() || document.body;
  const parts = [];
  const seen = new Set();
  const blockSelectors = [
    '.job-sec-text',
    '.job-detail-section .text',
    '.job-sec .text',
    '.detail-content',
  ];

  for (const sel of blockSelectors) {
    try {
      root.querySelectorAll(sel).forEach(el => {
        if (!isVisible(el)) return;
        if (el.classList.contains('fold-text')) return;
        const t = (el.innerText || el.textContent || '').trim();
        if (t.length < 10 || seen.has(t)) return;
        if (isCompanyIntro(t)) return;
        seen.add(t);
        parts.push(t);
      });
    } catch (e) { /* ignore */ }
  }

  return parts.length ? parts.join('\n\n') : '';
}

/** BOSS：轻量整理 JD 正文（去空行/引号/重复标题，正文尽量原样保留） */
function postProcessBossJD(text) {
  if (!text) return '';

  let t = text.replace(/[""]/g, '');
  t = t.replace(/(岗位职责[：:]\s*)+/g, '岗位职责：\n');
  t = t.replace(/(任职要求[：:]\s*)+/g, '任职要求：\n');

  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const firstSection = findFirstSectionIndex(lines);
  const filtered = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i < firstSection) {
      if (isSkillTagLine(line)) continue;
      if (/^[：:]$/.test(line)) continue;
    }
    if (/^[\u4e00-\u9fa5]{2,4}(先生|女士)$/.test(line) && filtered.length > 8) break;
    if (BOSS_NOISE_LINES.some(p => p.test(line)) && filtered.length > 8) continue;
    filtered.push(line);
  }

  while (filtered.length > 0 && /^[\u4e00-\u9fa5]{2,4}(先生|女士)$/.test(filtered[filtered.length - 1])) {
    filtered.pop();
  }

  return cleanWhitespace(cutAtNoise(filtered.join('\n')));
}

/** 从主内容区提取职位名与要求标签 */
function extractBossMeta(root) {
  let title = extractJobTitle();
  let tags = '';
  root = root || getMainContentRoot();
  if (!root) return { title, tags };

  const lines = (root.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
  const sectionIdx = lines.findIndex(l => isBossSectionHeader(l));
  const headLines = sectionIdx > 0 ? lines.slice(0, sectionIdx) : lines;

  if (!title) {
    title = cleanTitle(
      headLines.find(l => l.length >= 2 && l.length <= 60 && /[\u4e00-\u9fa5a-zA-Z]/.test(l) && !isSalary(l)) || ''
    );
  }

  const tagLines = headLines.filter(l => {
    if (l.length < 2 || l.length > 20 || isSalary(l)) return false;
    if (title && (l === title || title.includes(l))) return false;
    return /年|本科|硕士|博士|大专|经验|广州|北京|上海|深圳|杭州|成都|武汉|南京|西安|重庆/.test(l)
      || /^\d+[-~～]\d+年/.test(l);
  });
  tags = tagLines.slice(0, 4).join(' · ');
  return { title, tags };
}

/** 统一格式化最终 JD 输出 */
function finalizeJDOutput(raw, bodyProcessor = postProcessBossJD) {
  if (!raw) return null;

  let title = '';
  let tags = '';
  const bodyLines = [];
  let inBody = false;

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (/^职位[：:]/.test(t)) {
      title = cleanTitle(t.replace(/^职位[：:]\s*/, ''));
      continue;
    }
    if (/^要求[：:]/.test(t)) {
      tags = t.replace(/^要求[：:]\s*/, '');
      continue;
    }
    if (!inBody && !t) continue;
    inBody = true;
    if (t) bodyLines.push(t);
  }

  let body = bodyProcessor(bodyLines.join('\n'));
  if (!title) title = extractJobTitle();
  tags = sanitizeTags(tags, title);

  if (body.length < 20) return null;
  return formatJDResult(body, title, tags);
}

/**
 * CSS 选择器提取：合并多个 JD 区块（地图页/详情页通用）
 */
function extractBossJDBySelector() {
  const root = getMainContentRoot();
  const merged = collectBossJDSections(root);
  if (merged.length >= 50) {
    const jdContent = postProcessBossJD(merged);
    if (jdContent.length >= 20 && !looksLikeNavMenu(jdContent)) {
      const { title, tags } = extractBossMeta(root);
      return finalizeJDOutput(formatJDResult(jdContent, title, tags));
    }
  }

  for (const sel of JD_SELECTORS) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (!isVisible(el)) continue;
        const raw = (el.innerText || el.textContent || '').trim();
        if (raw.length < 50) continue;
        const jdContent = postProcessBossJD(raw);
        if (jdContent.length < 20 || looksLikeNavMenu(jdContent)) continue;
        const { title, tags } = extractBossMeta(root);
        return finalizeJDOutput(formatJDResult(jdContent, title, tags));
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * 用 TreeWalker 找文本恰为 anchorText（或以其开头）的可见元素
 * 跳过 SCRIPT/STYLE/NOSCRIPT/IFRAME/TEMPLATE
 */
function findVisibleAnchorEl(anchorText, rootEl) {
  const root = rootEl || getMainContentRoot() || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement && node.parentElement.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'TEMPLATE'].includes(tag)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if ((text === anchorText || text.startsWith(anchorText)) && text.length <= anchorText.length + 4) {
      let host = node.parentElement;
      while (host && host !== root) {
        if (isVisible(host)) return host;
        host = host.parentElement;
      }
    }
  }
  return null;
}

/** 从 el 向上找 innerText 长度合适的祖先容器 */
function findContainer(el, minLen, maxLen) {
  let cur = el;
  for (let i = 0; i < 10; i++) {
    const p = cur.parentElement;
    if (!p || p === document.body) break;
    const len = (p.innerText || '').length;
    if (len >= minLen && len <= maxLen) return p;
    cur = p;
  }
  return cur;
}

/** 在噪声关键词处截断 */
function cutAtNoise(text, extraMarkers = []) {
  let result = text;
  for (const marker of [...NOISE_CUTOFF, ...extraMarkers]) {
    const idx = result.indexOf(marker);
    if (idx > 30) result = result.slice(0, idx);
  }
  return result.trim();
}

/** 过滤猎聘导航/按钮等整行噪声 */
function filterNoiseLines(text, patterns = LIEPIN_NOISE_LINES) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !patterns.some(p => p.test(l)))
    .join('\n');
}

/** 清理多余空白与空行 */
function cleanWhitespace(text) {
  return text
    .replace(/[\t ]+/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function postProcessLiepinJD(text) {
  if (!text) return '';
  let t = text.replace(/[""]/g, '').replace(/^职位介绍\s*/, '');
  const start = t.search(/岗位职责|任职要求|职位介绍|核心职责/);
  if (start > 0) t = t.slice(start);
  t = cutAtNoise(t, LIEPIN_NOISE_CUTOFF);
  t = filterNoiseLines(t);
  return cleanWhitespace(t);
}

/** 清理职位标题里混入的薪资（含字体混淆乱码） */
function cleanTitle(text) {
  return text
    .replace(/\s*\d[\d\s\-~～]*[kK万][以上]*/g, '')
    .replace(/\s*[^\u4e00-\u9fa5\u0020-\u007ea-zA-Z0-9\-_·.，。、！？：；（）【】]+[kK万]/g, '')
    .trim();
}

/** 判断是否为薪资文本 */
function isSalary(text) {
  const t = text.trim();
  return /^\d[\d\s\-~～]*[kK万]/.test(t) || t === '面议';
}

/**
 * 主提取：定位「职位描述」可见锚点 → 取容器正文
 */
function extractBossJD() {
  const root = getMainContentRoot();

  // 优先合并多个 JD 区块（避免地图页只抓到任职要求而漏掉岗位职责）
  const merged = collectBossJDSections(root);
  if (merged.length >= 50) {
    const jdContent = postProcessBossJD(merged);
    if (jdContent.length >= 20 && !looksLikeNavMenu(jdContent)) {
      const { title, tags } = extractBossMeta(root);
      return finalizeJDOutput(formatJDResult(jdContent, title, tags));
    }
  }

  let anchorEl = null;
  let usedAnchor = '';
  for (const anchor of JD_ANCHORS) {
    anchorEl = findVisibleAnchorEl(anchor, root);
    if (anchorEl) { usedAnchor = anchor; break; }
  }
  if (!anchorEl) return null;

  const container = findContainer(anchorEl, 80, 12000);
  const containerText = (container.innerText || '').trim();
  if (containerText.length < 30) return null;

  const idx = containerText.indexOf(usedAnchor);
  let jdContent = idx >= 0 ? containerText.slice(idx + usedAnchor.length).trim() : containerText;
  jdContent = postProcessBossJD(jdContent);
  if (jdContent.length < 20) return null;

  const { title, tags } = extractBossMeta(root);
  return finalizeJDOutput(formatJDResult(jdContent, title, tags));
}

/** 尝试提取 zhipin JD（选择器优先，锚点备选），过滤导航噪声 */
function tryExtractZhipinJD() {
  for (const fn of [extractBossJDBySelector, extractBossJD]) {
    const result = fn();
    const final = result ? finalizeJDOutput(result) : null;
    if (final && final.length > 50 && !looksLikeNavMenu(final)) return final;
  }
  return null;
}

/** 猎聘：提取职位标题 */
function extractLiepinTitle() {
  const titleSelectors = [
    '[class*="job-title"]', '[class*="job-name"]', '.job-title', '.name', 'h1', 'h2',
  ];
  for (const sel of titleSelectors) {
    try {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        const title = cleanTitle((el.innerText || el.textContent || '').trim());
        if (title.length >= 4 && title.length <= 60 && !/^(聊一聊|收藏|职位介绍)$/.test(title)
            && /[\u4e00-\u9fa5a-zA-Z]/.test(title) && !isSalary(title)) {
          return title;
        }
      }
    } catch (e) { /* ignore */ }
  }
  const bodyLines = (document.body.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of bodyLines) {
    if (/聊一聊|职位介绍|岗位职责|邀请应聘/.test(line)) break;
    const title = cleanTitle(line);
    if (title.length >= 4 && title.length <= 40 && /工程师|开发|经理|专员|总监|架构|测试|产品/.test(title)) {
      return title;
    }
  }
  return '';
}

/** 猎聘：提取地点/经验/学历标签 */
function extractLiepinTags() {
  const body = document.body.innerText || '';
  const m = body.match(/([\u4e00-\u9fa5]{2,}(?:市)?-[\u4e00-\u9fa5]{2,}(?:区|县)?)\s+(\d+-\d+年)\s+(本科|硕士|博士|大专)/);
  if (m) return `${m[1]} · ${m[2]} · ${m[3]}`;
  const parts = [];
  const city = body.match(/([\u4e00-\u9fa5]+-[\u4e00-\u9fa5]+)/);
  const exp = body.match(/(\d+-\d+年)/);
  const edu = body.match(/(本科|硕士|博士|大专)/);
  if (city) parts.push(city[1]);
  if (exp) parts.push(exp[1]);
  if (edu) parts.push(edu[1]);
  return parts.slice(0, 3).join(' · ');
}

function finalizeLiepinResult(jdContent) {
  const title = extractLiepinTitle();
  const tags = extractLiepinTags();
  return finalizeJDOutput(formatJDResult(jdContent, title, tags), postProcessLiepinJD);
}

/** 猎聘：从最佳可见容器或 body 文本提取 */
function extractLiepinJDFromContainer() {
  const root = findBestJDContainer([
    ...LIEPIN_MAIN_CONTENT_SELECTORS,
    '[class*="introduce"]',
    '[class*="content"]',
  ]);

  let raw = '';
  if (root) {
    raw = (root.innerText || '').trim();
    const introIdx = raw.search(/职位介绍|岗位职责/);
    if (introIdx >= 0) raw = raw.slice(introIdx).replace(/^职位介绍\s*/, '');
  } else {
    const body = document.body.innerText || '';
    const introIdx = body.search(/职位介绍|岗位职责/);
    if (introIdx < 0) return null;
    raw = body.slice(introIdx).replace(/^职位介绍\s*/, '');
  }

  const jdContent = postProcessLiepinJD(raw);
  if (jdContent.length < 50 || looksLikeLiepinNav(jdContent)) return null;
  return finalizeLiepinResult(jdContent);
}

/** 猎聘：CSS 选择器提取 */
function extractLiepinJDBySelector() {
  const root = getLiepinMainContentRoot() || document.body;
  for (const sel of LIEPIN_JD_SELECTORS) {
    try {
      const els = root.querySelectorAll(sel);
      for (const el of els) {
        if (!isVisible(el)) continue;
        const raw = (el.innerText || el.textContent || '').trim();
        if (raw.length < 50) continue;
        if (!/岗位职责|任职要求|职位介绍/.test(raw)) continue;
        const jdContent = postProcessLiepinJD(raw.replace(/^职位介绍\s*/, ''));
        if (jdContent.length < 30 || looksLikeLiepinNav(jdContent)) continue;
        const title = extractLiepinTitle();
        return finalizeLiepinResult(jdContent);
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

/** 猎聘：锚点提取 */
function extractLiepinJD() {
  const root = getLiepinMainContentRoot() || document.body;
  let anchorEl = null;
  let usedAnchor = '';
  for (const anchor of LIEPIN_JD_ANCHORS) {
    anchorEl = findVisibleAnchorEl(anchor, root);
    if (anchorEl) { usedAnchor = anchor; break; }
  }
  if (!anchorEl) return null;

  const container = findContainer(anchorEl, 80, 8000);
  const containerText = (container.innerText || '').trim();
  if (containerText.length < 30) return null;

  const idx = containerText.indexOf(usedAnchor);
  let jdContent = idx >= 0 ? containerText.slice(idx + usedAnchor.length).trim() : containerText;
  jdContent = postProcessLiepinJD(jdContent);
  if (jdContent.length < 30 || looksLikeLiepinNav(jdContent)) return null;

  return finalizeLiepinResult(jdContent);
}

function tryExtractLiepinJD() {
  for (const fn of [extractLiepinJDFromContainer, extractLiepinJDBySelector, extractLiepinJD]) {
    const result = fn();
    const final = result ? finalizeJDOutput(result, postProcessLiepinJD) : null;
    if (final && final.length > 50 && !looksLikeLiepinNav(final)) return final;
  }
  return null;
}

function waitForLiepinJobDesc(timeout = 6000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };

    const tryExtract = () => tryExtractLiepinJD();

    const observer = new MutationObserver(() => {
      const r = tryExtract();
      if (r) { observer.disconnect(); finish(r); }
      else if (Date.now() - start > timeout) { observer.disconnect(); finish(null); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      const r = tryExtract();
      if (r) { observer.disconnect(); finish(r); }
    }, 500);

    setTimeout(() => { observer.disconnect(); finish(null); }, timeout);
  });
}

/** 通用兜底：非 BOSS直聘 页面，移除噪声节点后提取主文本 */
function extractGenericJD() {
  const clone = document.body.cloneNode(true);
  ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript'].forEach(tag => {
    clone.querySelectorAll(tag).forEach(el => el.remove());
  });
  const text = (clone.innerText || clone.textContent || '')
    .replace(/[\t ]+/g, ' ')
    .replace(/(\r?\n){3,}/g, '\n\n')
    .trim();
  return cutAtNoise(text).slice(0, 2500);
}

/** 等待 SPA 渲染后提取（含 MutationObserver + 延迟首试） */
function waitForJobDesc(timeout = 6000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };

    const tryExtract = () => tryExtractZhipinJD();

    const observer = new MutationObserver(() => {
      const r = tryExtract();
      if (r) {
        observer.disconnect();
        finish(r);
      } else if (Date.now() - start > timeout) {
        observer.disconnect();
        finish(null);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 延迟首试，给 SPA 渲染时间
    setTimeout(() => {
      const r = tryExtract();
      if (r) { observer.disconnect(); finish(r); }
    }, 500);

    setTimeout(() => { observer.disconnect(); finish(null); }, timeout);
  });
}

/** 诊断：收集页面关键信息，用于远程排查 */
function buildDiagnostics() {
  const bodyText = (document.body.innerText || '');
  const isLiepin = /liepin\.com/.test(window.location.href);
  const lines = [];
  lines.push('【诊断信息 - 请整段复制发给开发者】');
  lines.push(`URL: ${window.location.href}`);
  lines.push(`body.innerText 总长度: ${bodyText.length}`);

  const anchors = isLiepin ? LIEPIN_JD_ANCHORS : JD_ANCHORS;
  const mainRoot = isLiepin ? getLiepinMainContentRoot() : getMainContentRoot();
  const jdSelectors = isLiepin ? LIEPIN_JD_SELECTORS : JD_SELECTORS;

  for (const a of anchors) {
    const inText = bodyText.includes(a);
    const visEl = findVisibleAnchorEl(a, mainRoot);
    lines.push(`锚点「${a}」: 文本中存在=${inText}, 可见元素=${visEl ? '找到(' + visEl.tagName + '.' + (visEl.className || '无class') + ')' : '未找到'}`);
  }

  lines.push(`主内容容器: ${mainRoot ? '找到(' + mainRoot.tagName + '.' + (mainRoot.className || '无class') + ')' : '未找到'}`);

  for (const sel of jdSelectors) {
    try {
      const els = document.querySelectorAll(sel);
      let firstVisibleLen = 0;
      for (const el of els) {
        if (isVisible(el)) {
          firstVisibleLen = (el.innerText || '').length;
          break;
        }
      }
      lines.push(`JD选择器 ${sel}: 命中 ${els.length} 个, 首个可见文本长度=${firstVisibleLen}`);
    } catch (e) { /* ignore */ }
  }

  // 常见类名命中数
  const probes = ['.job-sec', '.job-detail', '.job-detail-box', '[class*="job-detail"]', '[class*="detail"]', 'h1', 'h2', 'h3'];
  for (const sel of probes) {
    try {
      lines.push(`选择器 ${sel}: 命中 ${document.querySelectorAll(sel).length} 个`);
    } catch (e) { /* ignore */ }
  }

  const sample = isLiepin ? (tryExtractLiepinJD() || '') : (tryExtractZhipinJD() || '');
  lines.push(`提取样例长度: ${sample ? sample.length : '无提取结果'}`);

  // body 前 600 字（剔除多余空行）
  const preview = bodyText.replace(/(\n\s*){2,}/g, '\n').slice(0, 600);
  lines.push('--- body.innerText 前 600 字 ---');
  lines.push(preview);

  return lines.join('\n');
}

// ── 监听来自 popup 的消息 ────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'extractJD') return false;

  (async () => {
    try {
      let jdText = '';
      const url = window.location.href;
      if (/zhipin\.com/.test(url)) {
        jdText = (await waitForJobDesc(6000)) || finalizeJDOutput(extractBossJDBySelector() || extractBossJD() || '') || '';
        if (jdText && looksLikeNavMenu(jdText)) jdText = '';
      } else if (/liepin\.com/.test(url)) {
        jdText = (await waitForLiepinJobDesc(6000))
          || extractLiepinJDFromContainer()
          || extractLiepinJDBySelector()
          || extractLiepinJD()
          || '';
        if (jdText && looksLikeLiepinNav(jdText)) jdText = '';
      } else {
        jdText = extractGenericJD();
      }

      if (!jdText || jdText.length < 30) {
        // 失败时回传诊断信息，便于远程排查
        sendResponse({
          success: false,
          error: '未能定位职位描述。\n\n' + buildDiagnostics()
        });
      } else {
        sendResponse({ success: true, jd: jdText });
      }
    } catch (err) {
      sendResponse({ success: false, error: `提取失败：${err.message}\n\n${buildDiagnostics()}` });
    }
  })();

  return true; // 异步响应，保持通道开放
});

} // end if __bossAIInjected
