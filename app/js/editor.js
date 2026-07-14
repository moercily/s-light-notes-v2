/* ============================================
   s-light notes — 编辑器模块 (WYSIWYG contenteditable)
   ============================================ */

// ========== 编辑器内容读写 ==========

/**
 * 将笔记加载到 contenteditable 编辑器
 */
function loadNoteToEditor(note) {
    if (!note) return;
    const editor = $('#note-editor');
    if (!editor) return;

    // 渲染 markdown 为 HTML 并注入
    const html = renderMarkdown(note.content || '');
    editor.innerHTML = html;

    // 清空撤销栈并保存初始快照
    clearUndoStack();
    saveUndoSnapshot(editor);

    // 更新工具栏
    updateEditorToolbar(note);
    if (typeof updateConflictBanner === 'function') {
        updateConflictBanner(note);
    }

    AppState.isDirty = false;
    updateStatusBarText('save', '已加载');
    updateStatusBarText('stats', '字数：' + countWords(note.content));
    updateStatusBarText('time', formatDate(note.updatedAt));
    AppState._lastSavedTime = note.updatedAt;
}

/**
 * 获取编辑器内容的 Markdown 表示
 */
function getEditorContent() {
    const editor = $('#note-editor');
    if (!editor) return '';
    return htmlToMarkdown(editor);
}

/**
 * 清空编辑器
 */
function clearEditor() {
    const editor = $('#note-editor');
    if (editor) editor.innerHTML = '';
    clearUndoStack();
    updateEditorToolbar(null);
    if (typeof updateConflictBanner === 'function') {
        updateConflictBanner(null);
    }
    AppState.isDirty = false;
    updateStatusBarText('save', '--');
    updateStatusBarText('stats', '字数：0');
    updateStatusBarText('time', '--');
}

// ========== 保存 ==========

function canWriteCurrentStorage() {
    return AppState.storageMode === 'desktop' ||
           AppState.storageMode === 'idb' ||
           (AppState.storageMode === 'fsa' && AppState.folderHandle);
}

async function saveCurrentNote(options = {}) {
    if (AppState._showTrash) return;
    const content = getEditorContent();
    if (!content.trim() && !AppState.currentNoteId) return;
    if (!canWriteCurrentStorage()) {
        updateStatusBarText('save', '请先打开笔记文件夹');
        return null;
    }
    if (!options.forceOverwrite &&
        AppState.currentNoteId &&
        typeof checkConflict === 'function' &&
        await checkConflict(AppState.currentNoteId)) {
        $('#conflict-dialog').classList.remove('hidden');
        updateStatusBarText('save', '检测到外部修改');
        return null;
    }

    updateStatusBarText('save', '保存中...');

    try {
        const result = await saveNote(AppState.currentNoteId, content);
        AppState.currentNoteId = result.id;
        AppState.isDirty = false;
        AppState._lastSavedTime = result.updatedAt;

        updateStatusBarText('save', '已保存 ' + formatDate(result.updatedAt));
        updateStatusBarText('stats', '字数：' + countWords(content));
        updateStatusBarText('time', formatDate(result.updatedAt));
        updateEditorToolbar({ title: result.title });
        await refreshNoteList();
        if (typeof syncScheduleScanAfterSave === 'function') {
            syncScheduleScanAfterSave();
        }
        return result;
    } catch (err) {
        console.error('保存失败:', err);
        updateStatusBarText('save', '保存失败');
        throw err;
    }
}

const autoSave = debounce(async () => {
    if (AppState.isDirty && !AppState._showTrash && getEditorContent().trim()) {
        await saveCurrentNote();
    }
}, 500);

async function onManualSave() {
    if (AppState._showTrash) return;
    const content = getEditorContent();
    if (!AppState.currentNoteId && !content.trim()) return;

    try {
        await saveCurrentNote();
    } catch (err) {
        console.error('保存失败:', err);
        updateStatusBarText('save', '保存失败');
    }
}

// ========== 编辑器输入事件 ==========

function onEditorInput() {
    if (AppState._showTrash) return;
    AppState.isDirty = true;
    updateStatusBarText('save', '未保存...');

    const content = getEditorContent();
    updateStatusBarText('stats', '字数：' + countWords(content));

    if (content.trim()) autoSave();
}

// ====================================================
//  HTML → Markdown 转换器
//  将 contenteditable 的 DOM 树转回 Markdown 字符串
// ====================================================

/**
 * 将 contenteditable 元素的内部 HTML 转为 Markdown
 * @param {HTMLElement} editor
 * @returns {string}
 */
function htmlToMarkdown(editor) {
    // 规范化 DOM（合并相邻文本节点、清理空标签）
    editor.normalize();

    const lines = [];
    // 遍历 contenteditable 的直接子节点（块级元素）
    for (const child of editor.childNodes) {
        processBlockNode(child, lines);
    }

    // 清理首尾空行
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    while (lines.length > 0 && lines[0] === '') lines.shift();

    return lines.join('\n');
}

/**
 * 处理块级节点
 */
function processBlockNode(node, lines) {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text.trim()) lines.push(text.trim());
        return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName ? node.tagName.toLowerCase() : '';

    switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
            const level = parseInt(tag[1]);
            const prefix = '#'.repeat(level) + ' ';
            lines.push(prefix + getInlineMarkdown(node));
            lines.push(''); // 标题后空行
            break;
        }
        case 'p': {
            const md = getInlineMarkdown(node);
            if (md.trim()) { lines.push(md); lines.push(''); }
            break;
        }
        case 'ul': case 'ol': {
            const isOrdered = tag === 'ol';
            processListItems(node, lines, 0, isOrdered);
            lines.push(''); // 列表后空行
            break;
        }
        case 'blockquote': {
            const innerMd = getInlineMarkdown(node);
            innerMd.split('\n').filter(l => l.trim()).forEach(l => {
                lines.push('> ' + l);
            });
            lines.push('');
            break;
        }
        case 'pre': {
            const codeEl = node.querySelector('code');
            const code = codeEl ? codeEl.textContent : node.textContent;
            const lang = '';
            lines.push('```' + lang);
            lines.push(code.replace(/\n$/, ''));
            lines.push('```');
            lines.push('');
            break;
        }
        case 'hr': {
            lines.push('---');
            lines.push('');
            break;
        }
        case 'div': case 'section': case 'article': {
            // 递归处理容器元素
            for (const child of node.childNodes) {
                processBlockNode(child, lines);
            }
            break;
        }
        case 'br': {
            lines.push('');
            break;
        }
        default: {
            // 未知元素，尝试提取文本
            const text = node.textContent || '';
            if (text.trim()) lines.push(text.trim());
            break;
        }
    }
}

/**
 * 递归处理列表项，支持嵌套缩进
 */
function processListItems(listEl, lines, indentLevel, isOrdered) {
    const indent = '  '.repeat(indentLevel);
    let idx = 1;

    for (const li of listEl.children) {
        if (li.tagName && li.tagName.toLowerCase() === 'li') {
            // 提取 li 的直接文本（排除嵌套列表）
            let liText = '';
            let nestedList = null;

            for (const cn of li.childNodes) {
                if (cn.nodeType === Node.ELEMENT_NODE) {
                    const cnTag = cn.tagName ? cn.tagName.toLowerCase() : '';
                    if (cnTag === 'ul' || cnTag === 'ol') {
                        nestedList = cn;
                    } else {
                        liText += getInlineMarkdownFromNode(cn);
                    }
                } else {
                    liText += cn.textContent || '';
                }
            }

            const prefix = isOrdered ? (idx + '. ') : '- ';
            lines.push(indent + prefix + liText.trim());
            idx++;

            // 递归处理嵌套列表
            if (nestedList) {
                const nestedOrdered = nestedList.tagName.toLowerCase() === 'ol';
                processListItems(nestedList, lines, indentLevel + 1, nestedOrdered);
            }
        }
    }
}

/**
 * 获取元素的内联 Markdown（处理 strong, em, code, a, br 等）
 */
function getInlineMarkdown(element) {
    let result = '';
    for (const child of element.childNodes) {
        result += getInlineMarkdownFromNode(child);
    }
    return result;
}

function getInlineMarkdownFromNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName ? node.tagName.toLowerCase() : '';

    switch (tag) {
        case 'strong': case 'b':
            return '**' + getInlineMarkdown(node) + '**';
        case 'em': case 'i':
            return '*' + getInlineMarkdown(node) + '*';
        case 'code':
            return '`' + (node.textContent || '') + '`';
        case 'a': {
            const href = node.getAttribute('href') || '';
            return '[' + getInlineMarkdown(node) + '](' + href + ')';
        }
        case 'br':
            return '\n';
        case 'span': case 'font': case 'u': case 's': case 'del':
            return getInlineMarkdown(node);
        case 'mark':
            return getInlineMarkdown(node);
        case 'img': {
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || '';
            return '![' + alt + '](' + src + ')';
        }
        case 'input': {
            // 任务列表复选框
            if (node.type === 'checkbox') {
                return node.checked ? '[x] ' : '[ ] ';
            }
            return '';
        }
        default:
            return getInlineMarkdown(node);
    }
}

// ====================================================
//  Markdown → HTML 渲染器
// ====================================================

function renderMarkdown(text) {
    if (!text) return '';

    // 提取代码块
    const codeBlocks = [];
    let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const idx = codeBlocks.length;
        const escapedCode = escapeHtml(code.replace(/\n$/, ''));
        const langLabel = lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '';
        codeBlocks.push('<pre class="code-block">' + langLabel + '<code>' + escapedCode + '</code></pre>');
        return '%%CB' + idx + '%%';
    });

    const lines = processed.split('\n');
    let html = '';
    let inParagraph = false;
    const listStack = [];

    function closeParagraph() {
        if (inParagraph) {
            html += '</p>';
            inParagraph = false;
        }
    }

    function openList(type, className) {
        const cls = className ? ' class="' + className + '"' : '';
        html += '<' + type + cls + '>\n';
        listStack.push({ type: type, liOpen: false });
    }

    function closeOneList() {
        const current = listStack.pop();
        if (!current) return;
        if (current.liOpen) html += '</li>\n';
        html += '</' + current.type + '>\n';
    }

    function closeListsToDepth(depth) {
        while (listStack.length > depth) {
            closeOneList();
        }
    }

    function closeAllLists() {
        closeListsToDepth(0);
    }

    function addListItem(type, indentLevel, itemHtml, options) {
        closeParagraph();

        const depth = indentLevel + 1;
        closeListsToDepth(depth);

        if (listStack.length === depth) {
            const current = listStack[listStack.length - 1];
            if (current.type !== type) {
                closeOneList();
            }
        }

        while (listStack.length < depth) {
            const isFirstLevel = listStack.length === 0;
            openList(type, isFirstLevel && options ? options.listClass : '');
        }

        const current = listStack[listStack.length - 1];
        if (current.liOpen) html += '</li>\n';
        const liClass = options && options.itemClass ? ' class="' + options.itemClass + '"' : '';
        html += '<li' + liClass + '>' + itemHtml;
        current.liOpen = true;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^%%CB\d+%%$/.test(line.trim())) {
            closeAllLists();
            closeParagraph();
            html += line.trim() + '\n';
            continue;
        }

        if (line.trim() === '') {
            closeAllLists();
            closeParagraph();
            continue;
        }

        // 水平线
        if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
            closeAllLists();
            closeParagraph();
            html += '<hr>\n';
            continue;
        }

        // 标题
        const headingMatch = line.match(/^(#{1,6}) (.+)$/);
        if (headingMatch) {
            closeAllLists();
            closeParagraph();
            html += '<h' + headingMatch[1].length + '>' + parseInline(headingMatch[2]) + '</h' + headingMatch[1].length + '>\n';
            continue;
        }

        // 引用块
        const quoteMatch = line.match(/^> (.+)$/);
        if (quoteMatch) {
            closeAllLists();
            closeParagraph();
            let quoteLines = [quoteMatch[1]];
            while (i + 1 < lines.length && /^> (.+)$/.test(lines[i + 1])) {
                i++;
                quoteLines.push(lines[i].match(/^> (.+)$/)[1]);
            }
            html += '<blockquote><p>' + quoteLines.map(l => parseInline(l)).join('<br>') + '</p></blockquote>\n';
            continue;
        }

        // 任务列表
        const taskMatch = line.match(/^(\s*)[-*] \[([ xX])\] (.+)$/);
        if (taskMatch) {
            const indentLevel = Math.floor(taskMatch[1].length / 2);
            const checked = taskMatch[2].toLowerCase() === 'x' ? ' checked' : '';
            addListItem(
                'ul',
                indentLevel,
                '<input type="checkbox"' + checked + ' disabled>' + parseInline(taskMatch[3]),
                { listClass: 'task-list', itemClass: 'task-item' }
            );
            continue;
        }

        // 无序列表（支持多级缩进）
        const ulMatch = line.match(/^(\s*)[-*] (.+)$/);
        if (ulMatch) {
            const indentLevel = Math.floor(ulMatch[1].length / 2);
            addListItem('ul', indentLevel, parseInline(ulMatch[2]));
            continue;
        }

        // 有序列表（支持多级缩进）
        const olMatch = line.match(/^(\s*)\d+\. (.+)$/);
        if (olMatch) {
            const indentLevel = Math.floor(olMatch[1].length / 2);
            addListItem('ol', indentLevel, parseInline(olMatch[2]));
            continue;
        }

        // 段落
        closeAllLists();
        if (!inParagraph) {
            html += '<p>';
            inParagraph = true;
        } else {
            html += '<br>\n';
        }
        html += parseInline(line);
    }

    closeAllLists();
    closeParagraph();

    html = html.replace(/%%CB(\d+)%%/g, (match, idx) => {
        return codeBlocks[parseInt(idx)] || '';
    });

    return html;
}

function parseInline(text) {
    let result = escapeHtml(text);
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 图片（在链接之前处理，避免 ![...](...) 被链接正则误匹配）
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;height:auto;">');
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return result;
}

// ====================================================
//  撤销/重做栈
// ====================================================

const UndoStack = {
    stack: [],              // editor.innerHTML 快照数组
    pointer: -1,            // 当前位置索引，-1 = 无历史
    maxSize: 50,            // 最大快照数
    _isRestoring: false,    // 恢复中标记
    _lastTextInput: 0,      // 上次文本输入时间戳
    _textTimer: null,       // 文本输入快照定时器
};

/**
 * 保存撤销快照
 */
function saveUndoSnapshot(editor) {
    if (UndoStack._isRestoring) return;

    const html = editor.innerHTML;

    // 与栈顶相同则跳过
    if (UndoStack.pointer >= 0 && UndoStack.stack[UndoStack.pointer] === html) return;

    // 清除 pointer 之后的快照
    UndoStack.stack = UndoStack.stack.slice(0, UndoStack.pointer + 1);

    // 添加新快照
    UndoStack.stack.push(html);
    UndoStack.pointer++;

    // 超过最大数量则移除最旧的
    if (UndoStack.stack.length > UndoStack.maxSize) {
        UndoStack.stack.shift();
        UndoStack.pointer--;
    }
}

/**
 * 执行撤销
 */
function undo(editor) {
    if (UndoStack.pointer <= 0) return;

    UndoStack._isRestoring = true;
    UndoStack.pointer--;
    editor.innerHTML = UndoStack.stack[UndoStack.pointer];
    UndoStack._isRestoring = false;

    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 执行重做
 */
function redo(editor) {
    if (UndoStack.pointer >= UndoStack.stack.length - 1) return;

    UndoStack._isRestoring = true;
    UndoStack.pointer++;
    editor.innerHTML = UndoStack.stack[UndoStack.pointer];
    UndoStack._isRestoring = false;

    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 清空撤销栈
 */
function clearUndoStack() {
    UndoStack.stack = [];
    UndoStack.pointer = -1;
    UndoStack._isRestoring = false;
}

// ====================================================
//  图片粘贴/拖拽上传（base64 Data URI）
// ====================================================

/** 最大图片大小：5MB */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * 从 Blob/File 读取图片并插入编辑器
 */
function insertImageFromBlob(blob, editor) {
    if (blob.size > MAX_IMAGE_SIZE) {
        alert('图片大小超过限制（最大 5MB），当前大小：' + (blob.size / 1024 / 1024).toFixed(1) + 'MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        saveUndoSnapshot(editor);

        // 确保编辑器有焦点
        if (!editor.contains(document.activeElement)) {
            editor.focus();
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // 创建 img 元素并插入
        const img = document.createElement('img');
        img.src = reader.result;
        img.alt = 'image';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';

        const sel = window.getSelection();
        if (sel.rangeCount) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(img);
            // 在图片后添加换行
            const br = document.createElement('br');
            range.setStartAfter(img);
            range.insertNode(br);
            range.setStartAfter(br);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        editor.dispatchEvent(new Event('input', { bubbles: true }));
    };
    reader.readAsDataURL(blob);
}

/**
 * 处理剪贴板粘贴事件，检测图片
 */
function handleImagePaste(e, editor) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            insertImageFromBlob(blob, editor);
            return;
        }
    }
}

/**
 * 处理拖拽放置事件，检测图片文件
 */
function handleImageDrop(e, editor) {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        if (file.type.startsWith('image/')) {
            e.preventDefault();
            insertImageFromBlob(file, editor);
            return;
        }
    }
}

// ====================================================
//  格式工具栏 — Selection API 精确定位
// ====================================================

let _toolbarTimer = null;

function initFormatToolbar() {
    const editor = $('#note-editor');
    const toolbar = $('#format-toolbar');
    if (!editor || !toolbar) return;

    // 文本输入时保存快照（合并连续输入，间隔超过 1 秒才存新快照）
    editor.addEventListener('input', (e) => {
        if (UndoStack._isRestoring) return;
        const now = Date.now();
        if (now - UndoStack._lastTextInput > 1000) {
            clearTimeout(UndoStack._textTimer);
            UndoStack._textTimer = setTimeout(() => {
                saveUndoSnapshot(editor);
            }, 300);
        }
        UndoStack._lastTextInput = now;
    });

    // 选中文字后显示工具栏（mouseup + touchend）
    function onSelectionChange() {
        clearTimeout(_toolbarTimer);
        _toolbarTimer = setTimeout(() => {
            showFormatToolbar(editor, toolbar);
        }, 50);
    }

    editor.addEventListener('mouseup', onSelectionChange);
    editor.addEventListener('touchend', onSelectionChange);

    // Tab/Shift+Tab：列表缩进/减少缩进
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;

            // 检查是否在列表项中
            let node = sel.anchorNode;
            if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
            const li = node ? node.closest('li') : null;

            if (li) {
                e.preventDefault();
                saveUndoSnapshot(editor);
                if (e.shiftKey) {
                    document.execCommand('outdent', false, null);
                } else {
                    document.execCommand('indent', false, null);
                }
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });

    // 键盘选择也触发（Shift + 方向键）
    editor.addEventListener('keyup', (e) => {
        if (e.shiftKey || e.key.startsWith('Arrow') ||
            e.key === 'Home' || e.key === 'End') {
            clearTimeout(_toolbarTimer);
            _toolbarTimer = setTimeout(() => {
                showFormatToolbar(editor, toolbar);
            }, 80);
        }
    });

    // 点击工具栏外部隐藏
    document.addEventListener('mousedown', (e) => {
        if (!toolbar.contains(e.target)) {
            hideFormatToolbar(toolbar);
        }
    });

    // 滚动时隐藏
    editor.addEventListener('scroll', () => hideFormatToolbar(toolbar));
    window.addEventListener('scroll', () => {
        if (editor.contains(document.activeElement)) {
            hideFormatToolbar(toolbar);
        }
    }, true);

    // 图片粘贴
    editor.addEventListener('paste', (e) => {
        handleImagePaste(e, editor);
    });

    // 图片拖拽
    editor.addEventListener('dragover', (e) => {
        const items = e.dataTransfer && e.dataTransfer.items;
        if (items) {
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    return;
                }
            }
        }
    });

    editor.addEventListener('drop', (e) => {
        handleImageDrop(e, editor);
    });

    // 工具栏按钮
    toolbar.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const format = btn.dataset.format;
            applyFormat(format, editor);
            hideFormatToolbar(toolbar);
            editor.focus();
            // 格式化后可能产生新选区，重新显示
            setTimeout(() => {
                if (!window.getSelection().isCollapsed) {
                    showFormatToolbar(editor, toolbar);
                }
            }, 100);
        });
    });
}

/**
 * 显示格式工具栏 — 基于 Selection API 精确定位
 */
function showFormatToolbar(editor, toolbar) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        hideFormatToolbar(toolbar);
        return;
    }

    if (AppState._showTrash) return;

    // 确保选区在编辑器内
    if (!editor.contains(sel.anchorNode)) {
        hideFormatToolbar(toolbar);
        return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 无效位置（宽高为 0 可能是光标不是选区）
    if (rect.width === 0 && rect.height === 0) {
        hideFormatToolbar(toolbar);
        return;
    }

    // 先显示才能获取 toolbar 尺寸
    toolbar.classList.remove('hidden');
    const tw = toolbar.offsetWidth;
    const th = toolbar.offsetHeight;
    toolbar.classList.add('hidden');

    // 定位：选中区域上方居中
    let left = rect.left + rect.width / 2 - tw / 2;
    let top = rect.top - th - 8;

    // 边界保护
    if (left < 8) left = 8;
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
    if (top < 8) top = rect.bottom + 8; // 空间不够则显示在下方

    toolbar.style.top = top + 'px';
    toolbar.style.left = left + 'px';
    toolbar.classList.remove('hidden');
}

function hideFormatToolbar(toolbar) {
    clearTimeout(_toolbarTimer);
    if (toolbar) {
        toolbar.classList.add('hidden');
    } else {
        const tb = $('#format-toolbar');
        if (tb) tb.classList.add('hidden');
    }
}

/**
 * 应用/取消格式到 contenteditable 的选中区域（全部为 toggle 模式）
 */
function applyFormat(format, editor) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    editor.focus();

    // 保存撤销快照
    saveUndoSnapshot(editor);

    switch (format) {
        case 'bold':
            // execCommand bold 原生支持 toggle
            document.execCommand('bold', false, null);
            break;

        case 'italic':
            // execCommand italic 原生支持 toggle
            document.execCommand('italic', false, null);
            break;

        case 'code':
            toggleInlineWrapper(editor, sel, 'code');
            break;

        case 'heading':
            toggleHeading(editor, sel);
            break;

        case 'list':
            toggleList(editor, sel);
            break;

        case 'quote':
            toggleBlockquote(editor, sel);
            break;

        case 'link':
            toggleLink(editor, sel);
            break;
    }

    // 触发 input 事件，让 autoSave 感知变化
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// ========== 格式 Toggle 辅助函数 ==========

/**
 * Toggle 行内包裹元素（<code>, <strong>, <em> 等）
 * 如果已在元素内 → 移除包裹；否则 → 添加包裹
 */
function toggleInlineWrapper(editor, sel, tagName) {
    // 检查选区是否完全在目标元素内
    if (sel.isCollapsed) return;

    const containing = findContainingElement(sel, tagName);

    if (containing) {
        // 已在元素内 → 移除包裹（unwarp）
        unwrapElement(containing);
    } else {
        // 不在元素内 → 添加包裹
        wrapSelection(editor, sel, tagName);
    }
}

/**
 * 查找选区是否完全包含在指定标签内
 */
function findContainingElement(sel, tagName) {
    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

    // 检查 commonAncestor 本身
    if (node && node.tagName && node.tagName.toLowerCase() === tagName) {
        return node;
    }

    // 检查父元素链
    let el = node;
    while (el && el !== $('#note-editor')) {
        if (el.tagName && el.tagName.toLowerCase() === tagName) return el;
        el = el.parentElement;
    }
    return null;
}

/**
 * 从 DOM 中移除包裹元素，保留其子节点
 */
function unwrapElement(wrapper) {
    const parent = wrapper.parentNode;
    if (!parent) return;
    while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
    }
    parent.removeChild(wrapper);
    parent.normalize();
}

/**
 * 用指定标签包裹选区
 */
function wrapSelection(editor, sel, tagName) {
    const range = sel.getRangeAt(0);
    const wrapper = document.createElement(tagName);
    try {
        range.surroundContents(wrapper);
        sel.removeAllRanges();
    } catch (e) {
        // 跨节点时 surroundContents 会失败，手动处理
        const fragment = range.extractContents();
        wrapper.appendChild(fragment);
        range.insertNode(wrapper);
        sel.removeAllRanges();
        // 选中新包裹的内容
        const newRange = document.createRange();
        newRange.selectNodeContents(wrapper);
        sel.addRange(newRange);
    }
}

/**
 * Toggle 标题格式（普通段落 ↔ 固定 H2 大标题）
 */
function toggleHeading(editor, sel) {
    const block = getCurrentBlock(sel);
    if (!block || block === editor) return;

    const tag = block.tagName ? block.tagName.toLowerCase() : '';

    if (/^h[1-6]$/.test(tag)) {
        replaceBlockElement(block, 'p', sel);
    } else {
        replaceBlockElement(block, 'h2', sel);
    }
}

/**
 * 替换块级元素标签，保留内部内容并恢复选区
 */
function replaceBlockElement(block, tagName, sel) {
    const replacement = document.createElement(tagName);
    while (block.firstChild) replacement.appendChild(block.firstChild);
    block.parentNode.replaceChild(replacement, block);

    const newRange = document.createRange();
    newRange.selectNodeContents(replacement);
    sel.removeAllRanges();
    sel.addRange(newRange);
}

/**
 * Toggle 无序列表
 */
function toggleList(editor, sel) {
    const block = getCurrentBlock(sel);
    if (!block) return;

    // 检查是否已在列表中
    const listParent = findContainingElement(sel, 'ul') || findContainingElement(sel, 'ol');

    if (listParent) {
        // 已在列表中 → 移除列表，保留内容为段落
        // 先获取所有 li 的内容
        const lis = Array.from(listParent.querySelectorAll('li'));
        const fragment = document.createDocumentFragment();
        lis.forEach(li => {
            const p = document.createElement('p');
            while (li.firstChild) p.appendChild(li.firstChild);
            if (p.innerHTML.trim() || p.querySelector('br')) {
                fragment.appendChild(p);
            }
        });
        listParent.parentNode.replaceChild(fragment, listParent);
        editor.normalize();
    } else {
        // 不在列表中 → 插入无序列表
        document.execCommand('insertUnorderedList', false, null);
    }
}

/**
 * Toggle 引用块
 */
function toggleBlockquote(editor, sel) {
    const bq = findContainingElement(sel, 'blockquote');

    if (bq) {
        // 已在引用中 → 移除引用，保留内容
        unwrapElement(bq);
    } else {
        // 不在引用中 → 包裹为引用
        document.execCommand('formatBlock', false, '<blockquote>');
        // execCommand formatBlock blockquote 可能把内容直接放在 blockquote 下，
        // 补充一个 <p> 确保 htmlToMarkdown 能正确处理
        setTimeout(() => {
            const newBq = findContainingElement(window.getSelection(), 'blockquote');
            if (newBq) normalizeBlockquote(newBq);
        }, 0);
    }
}

/**
 * Toggle 链接
 */
function toggleLink(editor, sel) {
    const existingLink = findContainingElement(sel, 'a');

    if (existingLink) {
        // 已有链接 → 移除
        unwrapElement(existingLink);
    } else {
        // 添加链接
        const text = sel.toString();
        const url = prompt('输入链接地址：', 'https://');
        if (url) {
            wrapSelection(editor, sel, 'a');
            // 设置 href
            const newLink = findContainingElement(window.getSelection(), 'a');
            if (newLink) {
                newLink.href = url;
                newLink.target = '_blank';
                newLink.rel = 'noopener';
            }
        }
    }
}

/**
 * 获取选区所在的块级元素
 */
function getCurrentBlock(sel) {
    if (!sel.rangeCount) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    // 向上找最近的块级元素
    while (node && node !== $('#note-editor')) {
        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (/^(p|div|h[1-6]|blockquote|li|pre|section|article)$/.test(tag)) {
            return node;
        }
        node = node.parentElement;
    }
    return node;
}

function normalizeBlockquote(bq) {
    // 确保 blockquote 内有 <p> 包裹文本
    const children = Array.from(bq.childNodes);
    let hasTextOnly = false;
    const textNodes = [];
    for (const child of children) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
            textNodes.push(child);
            hasTextOnly = true;
        }
        if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName.toLowerCase();
            if (tag !== 'p' && tag !== 'br') hasTextOnly = true;
        }
    }
    if (textNodes.length > 0) {
        const p = document.createElement('p');
        textNodes.forEach(tn => {
            p.appendChild(tn.cloneNode(true));
            tn.remove();
        });
        bq.appendChild(p);
    }
}
