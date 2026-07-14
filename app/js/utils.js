/* ============================================
   s-light notes — 工具函数
   提供：DOM 辅助、防抖、日期格式化、文件名处理
   ============================================ */

// ========== DOM 辅助 ==========

/** 选择单个 DOM 元素 */
function $(selector) {
    return document.querySelector(selector);
}

/** 选择多个 DOM 元素 */
function $$(selector) {
    return document.querySelectorAll(selector);
}

// ========== 防抖函数 ==========

/**
 * 创建防抖函数 — 在延迟时间内多次调用只执行最后一次
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ========== 日期格式化 ==========

/**
 * 格式化时间戳为可读字符串
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {string} 格式化的日期字符串
 */
function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const oneDay = 24 * 60 * 60 * 1000;

    // 今天
    if (diff < oneDay && date.getDate() === now.getDate()) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return '今天 ' + hours + ':' + minutes;
    }

    // 昨天
    const yesterday = new Date(now - oneDay);
    if (date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear()) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return '昨天 ' + hours + ':' + minutes;
    }

    // 更早
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (year === now.getFullYear()) {
        return month + '-' + day + ' ' + hours + ':' + minutes;
    }
    return year + '-' + month + '-' + day;
}

// ========== 笔记 ID / 文件名处理 ==========

/**
 * 从笔记内容的第一行生成笔记 ID（同时用作文件名）
 * @param {string} firstLine - 笔记内容的第一行
 * @returns {string} 合法的文件名（不含 .md 后缀）
 */
function generateNoteId(firstLine) {
    let id = normalizeNoteTitle(firstLine);
    if (!id) id = '未命名笔记';
    // 替换不合法文件名字符
    id = id.replace(/[/\\:*?"<>|]/g, '-');
    // 替换换行
    id = id.replace(/\n/g, ' ');
    // 限制长度
    if (id.length > 100) id = id.substring(0, 100);
    return id;
}

/**
 * 从笔记内容提取标题（第一行）
 * @param {string} content - 笔记完整内容
 * @returns {string} 标题
 */
function extractTitle(content) {
    if (!content) return '未命名';
    const firstLine = content.split('\n')[0];
    const title = normalizeNoteTitle(firstLine);
    return title || '未命名';
}

/**
 * 清理用于显示和命名的笔记标题
 * @param {string} title
 * @returns {string}
 */
function normalizeNoteTitle(title) {
    let result = (title || '').trim();
    // 标题行保存为 Markdown 时会带 # 前缀，列表显示和文件名不应显示这些标记
    result = result.replace(/^#{1,6}\s*/, '').trim();
    // 去掉常见行内 Markdown 包裹，让侧边栏标题更像自然文字
    result = result.replace(/^`(.+)`$/, '$1');
    result = result.replace(/^\*\*(.+)\*\*$/, '$1');
    result = result.replace(/^\*(.+)\*$/, '$1');
    return result;
}

/**
 * 判断是否为 Syncthing 内部文件或临时文件
 * @param {string} fileName
 * @returns {boolean}
 */
function isSyncthingInternalFile(fileName) {
    const name = (fileName || '').trim();
    if (!name) return false;
    return name === '.stfolder' ||
           name === '.stignore' ||
           name === '.stversions' ||
           name.endsWith('.tmp') ||
           /^\.syncthing\./.test(name);
}

/**
 * 判断是否为 Syncthing 冲突副本
 * @param {string} fileName
 * @returns {boolean}
 */
function isSyncthingConflictFile(fileName) {
    return /sync-conflict/i.test(fileName || '');
}

/**
 * 从 Syncthing 冲突文件名中推测原笔记 ID
 * @param {string} fileName
 * @returns {string}
 */
function getConflictSourceId(fileName) {
    return (fileName || '')
        .replace(/\.md$/i, '')
        .replace(/\.sync-conflict.*$/i, '')
        .trim();
}

// ========== 字数统计 ==========

/**
 * 统计文本字数（中文字符 + 英文单词）
 * @param {string} text
 * @returns {number} 字数
 */
function countWords(text) {
    if (!text) return 0;
    // 中文字符
    const chinese = (text.match(/[一-鿿]/g) || []).length;
    // 英文单词
    const english = (text.match(/[a-zA-Z0-9]+/g) || []).length;
    return chinese + english;
}

// ========== HTML 转义 ==========

/**
 * 转义 HTML 特殊字符，防止 XSS
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (c) => map[c]);
}
