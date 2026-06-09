/**
 * PDF / Markdown 简历解析
 * pdf.js 使用本地打包版本（libs/pdf.min.mjs）
 * 避免 MV3 CSP 对外部脚本的限制
 */

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;

  // 使用本地打包的 pdf.js
  const mod = await import(chrome.runtime.getURL('libs/pdf.min.mjs'));
  pdfjsLib = mod;

  // 指向本地 worker 文件
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.mjs');
  return pdfjsLib;
}

/**
 * 解析文件（File 对象）为纯文本字符串
 * 支持 .pdf 和 .md / .txt
 */
export async function parseResumeFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    return await parsePdf(file);
  } else if (['md', 'txt', 'markdown'].includes(ext)) {
    return await readTextFile(file);
  } else {
    throw new Error(`不支持的文件格式：.${ext}，请上传 .pdf 或 .md 文件`);
  }
}

async function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

async function parsePdf(file) {
  const pdfjs = await loadPdfJs();

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjs.getDocument({
    data: arrayBuffer,
    // 禁用需要网络请求的特性，确保离线可用
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true
  }).promise;

  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) pageTexts.push(pageText);
  }

  const fullText = pageTexts.join('\n\n');
  if (!fullText.trim()) {
    throw new Error('PDF 解析结果为空，可能是扫描版图片 PDF，建议转换为文字版或使用 .md 格式');
  }

  return fullText;
}
