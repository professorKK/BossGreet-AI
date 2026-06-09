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
];

// JD 区域的可能标题锚点（按优先级）
const JD_ANCHORS = ['职位描述', '职位详情', '岗位职责', '职位职责'];

// BOSS 直聘 JD 正文 CSS 选择器（按优先级）
const JD_SELECTORS = [
  '.job-sec-text:not(.fold-text)',
  '.job-sec-text',
  '.job-detail .detail-content',
  '.job-sec .text',
  '.job-detail-section .text',
];

// 主内容区容器选择器
const MAIN_CONTENT_SELECTORS = [
  '.job-detail',
  '.job-box',
  '[class*="job-detail"]',
  'main',
];

/** 元素是否真实可见（排除隐藏卡片 / 离屏面板） */
function isVisible(el) {
  if (!el || el === document.body) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** 定位页面主内容容器，避免在顶栏/隐藏卡片中搜索 */
function getMainContentRoot() {
  for (const sel of MAIN_CONTENT_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    } catch (e) { /* ignore */ }
  }
  return null;
}

/** 判断提取结果是否像顶部导航菜单（误抓兜底） */
function looksLikeNavMenu(text) {
  if (!text) return false;
  const hasBrand = text.includes('BOSS直聘');
  const hasNav = text.includes('首页') || text.includes('简历');
  const hasResumeMenu = text.includes('AI简历') || text.includes('智能简历生成');
  return hasBrand && hasNav && hasResumeMenu;
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

/**
 * CSS 选择器提取：优先命中 BOSS 直聘详情页已知 DOM 结构
 */
function extractBossJDBySelector() {
  for (const sel of JD_SELECTORS) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (!isVisible(el)) continue;
        const raw = (el.innerText || el.textContent || '').trim();
        if (raw.length < 50) continue;
        const jdContent = cleanWhitespace(cutAtNoise(raw));
        if (jdContent.length < 20 || looksLikeNavMenu(jdContent)) continue;
        const title = extractJobTitle();
        return formatJDResult(jdContent, title, '');
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * 用 TreeWalker 找文本恰为 anchorText（或以其开头）的可见元素
 * 跳过 SCRIPT/STYLE/NOSCRIPT/IFRAME/TEMPLATE
 */
function findVisibleAnchorEl(anchorText) {
  const root = getMainContentRoot() || document.body;
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
    // 标题节点通常文本就是锚点本身（允许少量装饰字符）
    if ((text === anchorText || text.startsWith(anchorText)) && text.length <= anchorText.length + 4) {
      if (isVisible(node.parentElement)) return node.parentElement;
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
function cutAtNoise(text) {
  let result = text;
  for (const marker of NOISE_CUTOFF) {
    const idx = result.indexOf(marker);
    if (idx > 30) result = result.slice(0, idx);
  }
  return result.trim();
}

/** 清理多余空白与空行 */
function cleanWhitespace(text) {
  return text.replace(/[\t ]+/g, ' ').replace(/(\n\s*){3,}/g, '\n\n').trim();
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
  let anchorEl = null;
  let usedAnchor = '';
  for (const anchor of JD_ANCHORS) {
    anchorEl = findVisibleAnchorEl(anchor);
    if (anchorEl) { usedAnchor = anchor; break; }
  }
  if (!anchorEl) return null;

  // 取 JD 正文容器（80~5000 字之间的最近祖先）
  const container = findContainer(anchorEl, 80, 5000);
  const containerText = (container.innerText || '').trim();
  if (containerText.length < 30) return null;

  // 从容器文本里定位锚点，截取其后内容
  const idx = containerText.indexOf(usedAnchor);
  let jdContent = idx >= 0 ? containerText.slice(idx + usedAnchor.length).trim() : containerText;
  jdContent = cleanWhitespace(cutAtNoise(jdContent));
  if (jdContent.length < 20) return null;

  // 向上找更大的祖先，提取职位名 / 要求标签
  let title = '';
  let tags = '';
  let parent = container.parentElement;
  for (let i = 0; i < 6; i++) {
    if (!parent || parent === document.body) break;
    const pText = parent.innerText || '';
    if (pText.length > 50 && pText.length < 9000 && isVisible(parent)) {
      const lines = pText.split('\n').map(l => l.trim()).filter(Boolean);
      // 标题：锚点之前第一个合理长度的行
      const anchorLineIdx = lines.findIndex(l => l.includes(usedAnchor));
      const headLines = anchorLineIdx > 0 ? lines.slice(0, anchorLineIdx) : lines;
      title = cleanTitle(
        headLines.find(l => l.length >= 2 && l.length <= 60 && /[\u4e00-\u9fa5a-zA-Z]/.test(l) && !isSalary(l)) || ''
      );
      const tagLines = headLines.filter(
        l => l.length >= 2 && l.length <= 20 && /[\u4e00-\u9fa5]/.test(l) && !isSalary(l) && !/^[\s\W]+$/.test(l)
      );
      tags = tagLines.slice(0, 4).join(' · ');
      break;
    }
    parent = parent.parentElement;
  }

  return formatJDResult(jdContent, title, tags);
}

/** 尝试提取 zhipin JD（选择器优先，锚点备选），过滤导航噪声 */
function tryExtractZhipinJD() {
  for (const fn of [extractBossJDBySelector, extractBossJD]) {
    const result = fn();
    if (result && result.length > 50 && !looksLikeNavMenu(result)) return result;
  }
  return null;
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
  const lines = [];
  lines.push('【诊断信息 - 请整段复制发给开发者】');
  lines.push(`URL: ${window.location.href}`);
  lines.push(`body.innerText 总长度: ${bodyText.length}`);

  // 各锚点是否出现
  for (const a of JD_ANCHORS) {
    const inText = bodyText.includes(a);
    const visEl = findVisibleAnchorEl(a);
    lines.push(`锚点「${a}」: 文本中存在=${inText}, 可见元素=${visEl ? '找到(' + visEl.tagName + '.' + (visEl.className || '无class') + ')' : '未找到'}`);
  }

  const mainRoot = getMainContentRoot();
  lines.push(`主内容容器: ${mainRoot ? '找到(' + mainRoot.tagName + '.' + (mainRoot.className || '无class') + ')' : '未找到'}`);

  // JD 选择器命中数及首个可见元素文本长度
  for (const sel of JD_SELECTORS) {
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

  const sample = tryExtractZhipinJD() || '';
  lines.push(`looksLikeNavMenu 判定: ${sample ? looksLikeNavMenu(sample) : '无提取结果'}`);

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
      if (/zhipin\.com/.test(window.location.href)) {
        jdText = (await waitForJobDesc(6000)) || extractBossJDBySelector() || '';
        if (jdText && looksLikeNavMenu(jdText)) jdText = '';
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
