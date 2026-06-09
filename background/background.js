/**
 * Background Service Worker
 * 中转 AI API 请求，绕过扩展 popup 的 CORS 限制
 */

import { callMiniMax, callDeepSeek } from '../utils/ai-service.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'callAI') return false;

  (async () => {
    try {
      const { provider, apiKey, model, jd, resume } = message.payload;

      let result;
      if (provider === 'minimax') {
        result = await callMiniMax({ apiKey, model, jd, resume });
      } else if (provider === 'deepseek') {
        result = await callDeepSeek({ apiKey, jd, resume });
      } else {
        throw new Error(`不支持的 AI 提供商：${provider}`);
      }

      sendResponse({ success: true, text: result });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // 保持消息通道开放（异步响应）
});
