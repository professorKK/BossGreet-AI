/**
 * Popup 主逻辑
 * 串联：简历上传、JD 提取、AI 调用、结果展示与复制
 */

import { parseResumeFile } from '../utils/pdf-parser.js';

// ─── 状态 ────────────────────────────────────────────────
const state = {
  provider: 'minimax',
  jdText: '',
  resumeText: '',
  resumeFileName: '',
  generating: false
};

// ─── DOM 节点 ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  toggleSettings:   $('toggleSettings'),
  settingsPanel:    $('settingsPanel'),
  providerTabs:     document.querySelectorAll('.provider-tab'),
  configMinimax:    $('configMinimax'),
  configDeepseek:   $('configDeepseek'),
  minimaxApiKey:    $('minimaxApiKey'),
  deepseekApiKey:   $('deepseekApiKey'),
  minimaxModel:     $('minimaxModel'),
  saveSettings:     $('saveSettings'),
  saveHint:         $('saveHint'),
  resumeInput:      $('resumeInput'),
  uploadArea:       $('uploadArea'),
  uploadContent:    $('uploadContent'),
  resumeBadge:      $('resumeBadge'),
  extractJD:        $('extractJD'),
  jdPreview:        $('jdPreview'),
  generateBtn:      $('generateBtn'),
  btnLoading:       $('btnLoading'),
  resultSection:    $('resultSection'),
  resultText:       $('resultText'),
  copyBtn:          $('copyBtn'),
  regenerateBtn:    $('regenerateBtn'),
  errorMsg:         $('errorMsg')
};

// ─── 初始化 ───────────────────────────────────────────────
async function init() {
  await loadStoredSettings();
  bindEvents();
}

async function loadStoredSettings() {
  const data = await chrome.storage.local.get([
    'provider',
    'minimaxApiKey',
    'deepseekApiKey',
    'minimaxModel',
    'resumeText',
    'resumeFileName'
  ]);

  if (data.provider) {
    state.provider = data.provider;
    setActiveProvider(data.provider);
  }
  if (data.minimaxApiKey) els.minimaxApiKey.value = data.minimaxApiKey;
  if (data.deepseekApiKey) els.deepseekApiKey.value = data.deepseekApiKey;
  if (data.minimaxModel) els.minimaxModel.value = data.minimaxModel;

  if (data.resumeText) {
    state.resumeText = data.resumeText;
    state.resumeFileName = data.resumeFileName || '已上传简历';
    showResumeBadge(state.resumeFileName);
  }

  updateGenerateBtn();
}

// ─── 事件绑定 ─────────────────────────────────────────────
function bindEvents() {
  // 设置面板开关
  els.toggleSettings.addEventListener('click', () => {
    const isOpen = els.settingsPanel.classList.toggle('open');
    els.settingsPanel.setAttribute('aria-hidden', String(!isOpen));
    els.toggleSettings.classList.toggle('active', isOpen);
  });

  // 提供商切换
  els.providerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const provider = tab.dataset.provider;
      state.provider = provider;
      setActiveProvider(provider);
    });
  });

  // API Key 可见性切换
  document.querySelectorAll('.btn-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // 保存设置
  els.saveSettings.addEventListener('click', saveSettings);

  // 简历上传
  els.resumeInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleResumeFile(file);
  });

  // 拖拽上传
  els.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.uploadArea.classList.add('dragover');
  });
  els.uploadArea.addEventListener('dragleave', () => {
    els.uploadArea.classList.remove('dragover');
  });
  els.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleResumeFile(file);
  });

  // 提取 JD
  els.extractJD.addEventListener('click', extractJD);

  // 手动编辑 JD 文本框时同步状态
  els.jdPreview.addEventListener('input', () => {
    state.jdText = els.jdPreview.value.trim();
    els.jdPreview.classList.toggle('has-content', !!state.jdText);
    updateGenerateBtn();
  });

  // 生成打招呼
  els.generateBtn.addEventListener('click', generate);

  // 重新生成
  els.regenerateBtn.addEventListener('click', generate);

  // 复制结果
  els.copyBtn.addEventListener('click', copyResult);
}

// ─── 提供商切换 ────────────────────────────────────────────
function setActiveProvider(provider) {
  els.providerTabs.forEach(t => t.classList.toggle('active', t.dataset.provider === provider));
  els.configMinimax.classList.toggle('hidden', provider !== 'minimax');
  els.configDeepseek.classList.toggle('hidden', provider !== 'deepseek');
}

// ─── 保存设置 ─────────────────────────────────────────────
async function saveSettings() {
  const minimaxKey = els.minimaxApiKey.value.trim();
  const deepseekKey = els.deepseekApiKey.value.trim();

  const currentKey = state.provider === 'minimax' ? minimaxKey : deepseekKey;
  if (!currentKey) {
    showSaveHint(`请输入 ${state.provider === 'minimax' ? 'MiniMax' : 'DeepSeek'} 的 API Key`, true);
    return;
  }

  await chrome.storage.local.set({
    provider: state.provider,
    minimaxApiKey: minimaxKey,
    deepseekApiKey: deepseekKey,
    minimaxModel: els.minimaxModel.value
  });

  showSaveHint('✓ 已保存');
  updateGenerateBtn();
}

function showSaveHint(msg, isError = false) {
  els.saveHint.textContent = msg;
  els.saveHint.classList.toggle('error', isError);
  setTimeout(() => { els.saveHint.textContent = ''; }, 3000);
}

// ─── 简历处理 ─────────────────────────────────────────────
async function handleResumeFile(file) {
  hideError();
  const content = els.uploadContent;
  content.innerHTML = '<span class="spinner" style="border-color:var(--accent-dim);border-top-color:var(--accent)"></span><span class="upload-text">解析中...</span>';

  try {
    const text = await parseResumeFile(file);
    state.resumeText = text;
    state.resumeFileName = file.name;

    await chrome.storage.local.set({
      resumeText: text,
      resumeFileName: file.name
    });

    showResumeBadge(file.name);
    els.uploadArea.classList.add('has-file');
    content.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span class="upload-text">${escapeHtml(file.name)}</span>
      <span class="upload-hint">点击重新上传</span>
    `;
    updateGenerateBtn();
  } catch (err) {
    showError(err.message);
    content.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span class="upload-text">点击上传简历</span>
      <span class="upload-hint">支持 .pdf · .md · .txt</span>
    `;
  }
}

function showResumeBadge(name) {
  els.resumeBadge.style.display = 'inline-flex';
  els.resumeBadge.textContent = `📄 ${name}`;
}

// ─── JD 提取 ──────────────────────────────────────────────
async function extractJD() {
  hideError();
  els.extractJD.disabled = true;
  els.extractJD.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span> 提取中';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('无法获取当前标签页');

    // 先尝试直接通信；若 content script 尚未注入则先注入再重试
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extractJD' });
    } catch {
      // content script 未注入（扩展安装前已打开的页面），手动注入后重试
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js']
      });
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extractJD' });
    }

    if (response?.success) {
      state.jdText = response.jd;
      els.jdPreview.value = response.jd;
      els.jdPreview.classList.add('has-content');
      updateGenerateBtn();
    } else {
      throw new Error(response?.error || 'JD 提取失败');
    }
  } catch (err) {
    showError(`提取失败：${err.message}`);
  } finally {
    els.extractJD.disabled = false;
    els.extractJD.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.22"/>
      </svg>
      提取当前页
    `;
  }
}

// ─── 生成打招呼 ────────────────────────────────────────────
async function generate() {
  if (state.generating) return;
  hideError();

  const stored = await chrome.storage.local.get(['provider', 'minimaxApiKey', 'deepseekApiKey', 'minimaxModel']);
  const provider = stored.provider || 'minimax';
  const apiKey = provider === 'minimax' ? stored.minimaxApiKey : stored.deepseekApiKey;

  if (!apiKey) {
    showError('请先在设置中填写 API Key 并保存');
    // 自动打开设置面板
    els.settingsPanel.classList.add('open');
    els.settingsPanel.setAttribute('aria-hidden', 'false');
    els.toggleSettings.classList.add('active');
    return;
  }

  if (!state.jdText) {
    showError('请先提取职位描述');
    return;
  }

  if (!state.resumeText) {
    showError('请先上传简历');
    return;
  }

  state.generating = true;
  setGenerating(true);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'callAI',
      payload: {
        provider,
        apiKey,
        model: stored.minimaxModel || 'MiniMax-M3',
        jd: state.jdText,
        resume: state.resumeText
      }
    });

    if (response?.success) {
      showResult(response.text);
    } else {
      throw new Error(response?.error || 'AI 调用失败');
    }
  } catch (err) {
    showError(`生成失败：${err.message}`);
  } finally {
    state.generating = false;
    setGenerating(false);
  }
}

function setGenerating(loading) {
  const btnText = els.generateBtn.querySelector('.btn-text');
  btnText.style.display = loading ? 'none' : '';
  els.btnLoading.style.display = loading ? 'flex' : 'none';
  els.generateBtn.disabled = loading;
}

// ─── 结果展示 ─────────────────────────────────────────────
function showResult(text) {
  els.resultText.textContent = text;
  els.resultSection.style.display = 'block';
  els.copyBtn.textContent = '';
  els.copyBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
    复制
  `;
  els.copyBtn.classList.remove('copied');
}

// ─── 复制到剪贴板 ─────────────────────────────────────────
async function copyResult() {
  const text = els.resultText.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    els.copyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      已复制
    `;
    els.copyBtn.classList.add('copied');
    setTimeout(() => {
      els.copyBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        复制
      `;
      els.copyBtn.classList.remove('copied');
    }, 2000);
  } catch {
    // 降级方案
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

// ─── 更新生成按钮状态 ──────────────────────────────────────
function updateGenerateBtn() {
  const hasResume = !!state.resumeText;
  const hasJD = !!state.jdText;
  els.generateBtn.disabled = !(hasResume && hasJD) || state.generating;
}

// ─── 错误提示 ─────────────────────────────────────────────
function showError(msg) {
  els.errorMsg.textContent = msg;
  els.errorMsg.style.display = 'block';
}

function hideError() {
  els.errorMsg.style.display = 'none';
  els.errorMsg.textContent = '';
}

// ─── 工具函数 ─────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ─── 启动 ─────────────────────────────────────────────────
init();
