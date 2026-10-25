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
    AppState._editSession = (AppState._editSession || 0) + 1;
    AppState._version = note.version;

    // 渲染 markdown 为 HTML 并注入
    setEditorMarkdown(editor, note.content || '');

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
    AppState._editSession = (AppState._editSession || 0) + 1;
    AppState._version = null;
    const editor = $('#note-editor');
    if (editor) setEditorMarkdown(editor, '');
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
    if (AppState.storageMode === 'desktop' && window.DesktopEditing) {
        return DesktopEditing.save();
    }
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
    if (AppState.isDirty && !AppState._showTrash && !AppState._currentNoteReadOnly &&
        (AppState.currentNoteId || getEditorContent().trim())) {
        try { await saveCurrentNote(); } catch (_) { /* Status and retry remain visible. */ }
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
    if (AppState._showTrash || AppState._currentNoteReadOnly) return;
    AppState.isDirty = true;
    updateStatusBarText('save', '未保存...');

    const content = getEditorContent();
    updateStatusBarText('stats', '字数：' + countWords(content));

    if (!AppState._composing && (content.trim() || AppState.currentNoteId)) autoSave();
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
    const source = editorSources.get(editor);
    // Preserve untouched blocks byte-for-byte, including unsupported Markdown and blank lines.
    if (source && editor.innerHTML === source.html) return source.content;
    const parts = [];
    let blockIndex = 0;
    for (const child of editor.childNodes) {
        const original = blockSources.get(child) || (child.nodeType === Node.ELEMENT_NODE ? source?.blocks[blockIndex] : null);
        if (child.nodeType === Node.ELEMENT_NODE) blockIndex++;
        if (original && child.outerHTML === original.html) {
            parts.push(original.content);
        } else {
            const lines = [];
            processBlockNode(child, lines);
            while (lines.at(-1) === '') lines.pop();
            const content = lines.join('\n');
            if (content || child.nodeName === 'BR' || child.nodeName === 'P') {
                const spacing = original?.content.match(/\n+$/)?.[0] ?? '\n\n';
                parts.push(content + spacing);
            }
        }
    }
    return parts.join('').replace(/\n+$/, source?.content.match(/\n*$/)?.[0] || '');
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
            const lang = codeEl?.dataset.language || '';
            const runs = code.match(/`+/g) || [];
            const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
            lines.push(fence + lang);
            lines.push(code.replace(/\n$/, ''));
            lines.push(fence);
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
    let idx = Number(listEl.getAttribute('start')) || 1;

    for (const li of listEl.children) {
        if (li.tagName && li.tagName.toLowerCase() === 'li') {
            // 提取 li 的直接文本（排除嵌套列表）
            let liText = '';
            const nestedLists = [];

            for (const cn of li.childNodes) {
                if (cn.nodeType === Node.ELEMENT_NODE) {
                    const cnTag = cn.tagName ? cn.tagName.toLowerCase() : '';
                    if (cnTag === 'ul' || cnTag === 'ol') {
                        nestedLists.push(cn);
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
            for (const nestedList of nestedLists) {
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
        return (node.textContent || '').replace(/([\\`*\[\]])/g, '\\$1');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName ? node.tagName.toLowerCase() : '';

    switch (tag) {
        case 'strong': case 'b':
            return '**' + getInlineMarkdown(node) + '**';
        case 'em': case 'i':
            return '*' + getInlineMarkdown(node) + '*';
        case 'code': {
            const text = node.textContent || '';
            const ticks = '`'.repeat(Math.max(1, ...(text.match(/`+/g) || []).map(run => run.length + 1)));
            const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
            return ticks + padding + text + padding + ticks;
        }
        case 'a': {
            const href = safeEditorUrl(node.getAttribute('href') || '', false);
            if (!href) return getInlineMarkdown(node);
            return '[' + getInlineMarkdown(node) + '](' + href + ')';
        }
        case 'br':
            return '\n';
        case 'span': case 'font': case 'u': case 's': case 'del':
            return getInlineMarkdown(node);
        case 'mark':
            return getInlineMarkdown(node);
        case 'img': {
            const src = safeEditorUrl(node.getAttribute('src') || '', true);
            if (!src) return node.getAttribute('alt') || '';
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

const editorSources = new WeakMap();
const blockSources = new WeakMap();

function setEditorMarkdown(editor, content) {
    const blocks = markdownBlocks(content);
    editor.innerHTML = blocks.map(block => block.html).join('');
    [...editor.children].forEach((node, index) => {
        blockSources.set(node, { html: node.outerHTML, content: blocks[index].source });
    });
    editorSources.set(editor, { html: editor.innerHTML, content, blocks: [...editor.children].map(node => blockSources.get(node)) });
}

function renderMarkdown(text) {
    return markdownBlocks(text || '').map(block => block.html).join('');
}

function markdownBlocks(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const blocks = [];
    let i = 0;
    const special = line => /^(?:#{1,6} |>|\s*[-*] |\s*\d+\. |`{3,}|~{3,}|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$)/.test(line);
    while (i < lines.length) {
        const start = i;
        while (i < lines.length && !lines[i].trim()) i++;
        if (i >= lines.length) {
            const tail = lines.slice(start).join('\n');
            if (blocks.length) blocks.at(-1).source += tail;
            else blocks.push({ source: text, html: '<p><br></p>' });
            break;
        }
        const line = lines[i];
        let html;
        const fence = line.match(/^(`{3,}|~{3,})([^\s`]*)\s*$/);
        const heading = line.match(/^(#{1,6}) (.*)$/);
        if (fence) {
            i++;
            const code = [];
            while (i < lines.length && !new RegExp('^' + fence[1][0] + '{' + fence[1].length + ',}\\s*$').test(lines[i])) code.push(lines[i++]);
            if (i < lines.length) i++;
            html = '<pre class="code-block"><code data-language="' + escapeHtml(fence[2]) + '">' + escapeHtml(code.join('\n')) + '</code></pre>';
        } else if (heading) {
            i++;
            html = '<h' + heading[1].length + '>' + parseInline(heading[2]) + '</h' + heading[1].length + '>';
        } else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            i++; html = '<hr>';
        } else if (/^>/.test(line)) {
            const quote = [];
            while (i < lines.length && /^>/.test(lines[i])) quote.push(lines[i++].replace(/^> ?/, ''));
            html = '<blockquote><p>' + quote.map(value => parseInline(value)).join('<br>') + '</p></blockquote>';
        } else if (/^\s*(?:[-*] |\d+\. )/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*(?:[-*] |\d+\. )/.test(lines[i])) items.push(lines[i++]);
            html = renderListBlock(items);
        } else {
            const paragraph = [lines[i++]];
            while (i < lines.length && lines[i].trim() && !special(lines[i])) paragraph.push(lines[i++]);
            html = '<p>' + paragraph.map(value => parseInline(value)).join('<br>') + '</p>';
        }
        while (i < lines.length && !lines[i].trim()) i++;
        blocks.push({ source: lines.slice(start, i).join('\n') + (i < lines.length ? '\n' : ''), html });
    }
    return blocks;
}

function renderListBlock(lines) {
    let html = '';
    const stack = [];
    const close = () => { const list = stack.pop(); html += '</li></' + list + '>'; };
    for (const line of lines) {
        const match = line.match(/^(\s*)([-*]|\d+\.) (.*)$/);
        const type = /\d/.test(match[2]) ? 'ol' : 'ul';
        const depth = Math.min(Math.floor(match[1].length / 2), stack.length);
        while (stack.length > depth + 1) close();
        if (stack.length === depth + 1 && stack.at(-1) !== type) close();
        if (stack.length <= depth) {
            html += '<' + type + (type === 'ol' ? ' start="' + parseInt(match[2]) + '"' : '') + '><li>';
            stack.push(type);
        } else html += '</li><li>';
        const task = match[3].match(/^\[([ xX])\] (.*)$/);
        html += task ? '<input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '>' + parseInline(task[2]) : parseInline(match[3]);
    }
    while (stack.length) close();
    return html;
}

function safeEditorUrl(value, image) {
    const url = String(value || '').trim();
    if (!url || /[\u0000-\u0020\u007f]/.test(url)) return '';
    if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(url)) return url;
    if (/^(?:https?:|mailto:)/i.test(url)) return image && /^mailto:/i.test(url) ? '' : url;
    // Local relative Markdown assets are allowed; protocol-relative and executable URLs are not.
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || /^[\\/]{2}/.test(url) || url.includes('\\')) return '';
    return url;
}

function parseInline(text, depth = 0) {
    if (depth > 16) return escapeHtml(text);
    let html = '';
    for (let i = 0; i < text.length;) {
        if (text[i] === '\\' && i + 1 < text.length && /[\\`*_[\]{}()#+.!>-]/.test(text[i + 1])) {
            html += escapeHtml(text[i + 1]); i += 2; continue;
        }
        const ticks = text.slice(i).match(/^`+/)?.[0];
        if (ticks) {
            const end = text.indexOf(ticks, i + ticks.length);
            if (end >= 0) {
                let code = text.slice(i + ticks.length, end);
                if (code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
                html += '<code>' + escapeHtml(code) + '</code>'; i = end + ticks.length; continue;
            }
        }
        const image = text.startsWith('![', i);
        if (image || text[i] === '[') {
            const labelStart = i + (image ? 2 : 1);
            const labelEnd = text.indexOf('](', labelStart);
            if (labelEnd >= 0) {
                let end = labelEnd + 2, balance = 1;
                for (; end < text.length; end++) {
                    if (text[end] === '\\') { end++; continue; }
                    if (text[end] === '(') balance++;
                    if (text[end] === ')') { balance--; if (balance === 0) break; }
                }
                if (balance === 0) {
                    const url = safeEditorUrl(text.slice(labelEnd + 2, end), image);
                    const label = text.slice(labelStart, labelEnd);
                    html += !url ? escapeHtml(text.slice(i, end + 1)) : image
                        ? '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(label) + '" style="max-width:100%;height:auto;">'
                        : '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + parseInline(label, depth + 1) + '</a>';
                    i = end + 1; continue;
                }
            }
        }
        const marker = text.startsWith('**', i) ? '**' : text[i] === '*' ? '*' : null;
        if (marker) {
            const end = text.indexOf(marker, i + marker.length);
            if (end > i + marker.length) {
                const tag = marker === '**' ? 'strong' : 'em';
                html += '<' + tag + '>' + parseInline(text.slice(i + marker.length, end), depth + 1) + '</' + tag + '>';
                i = end + marker.length; continue;
            }
        }
        html += escapeHtml(text[i++]);
    }
    return html;
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
    clearTimeout(UndoStack._textTimer);
    saveUndoSnapshot(editor);
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
    clearTimeout(UndoStack._textTimer);
    UndoStack._lastTextInput = 0;
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

    if (!/^image\/(png|jpeg|gif|webp)$/i.test(blob.type)) { alert('仅支持 PNG、JPEG、GIF 和 WebP 图片。'); return; }
    const session = AppState._editSession;
    const reader = new FileReader();
    reader.onload = () => {
        if (session !== AppState._editSession || AppState._showTrash || AppState._currentNoteReadOnly) return;
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
    if (AppState._showTrash || AppState._currentNoteReadOnly) { e.preventDefault(); return; }
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
    // Pasting HTML must not import event handlers, iframes, or executable links.
    const text = e.clipboardData?.getData('text/plain');
    if (text !== undefined) {
        e.preventDefault();
        saveUndoSnapshot(editor);
        document.execCommand('insertText', false, text);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * 处理拖拽放置事件，检测图片文件
 */
function handleImageDrop(e, editor) {
    e.preventDefault();
    if (AppState._showTrash || AppState._currentNoteReadOnly) return;
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

    initEditorComposition(editor, onEditorInput);
    editor.addEventListener('input', () => {
        if (UndoStack._isRestoring || AppState._composing) return;
        clearTimeout(UndoStack._textTimer);
        const session = AppState._editSession;
        UndoStack._textTimer = setTimeout(() => {
            if (session === AppState._editSession) saveUndoSnapshot(editor);
        }, 300);
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

    if (AppState._showTrash || AppState._currentNoteReadOnly) return;

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
    if (AppState._showTrash || AppState._currentNoteReadOnly) return;
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
        const inputUrl = prompt('输入链接地址：', 'https://');
        const url = safeEditorUrl(inputUrl, false);
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

function initEditorComposition(editor, onInput) {
    if (editor.dataset.compositionBound) return;
    editor.dataset.compositionBound = 'true';
    editor.addEventListener('compositionstart', () => { AppState._composing = true; });
    editor.addEventListener('compositionend', () => {
        AppState._composing = false;
        onInput();
        saveUndoSnapshot(editor);
    });
    editor.addEventListener('keydown', event => {
        if (event.isComposing || AppState._composing || event.keyCode === 229) event.stopPropagation();
    });
    editor.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (!link) return;
        event.preventDefault();
        const url = safeEditorUrl(link.getAttribute('href'), false);
        if (!url || !/^(https?:|mailto:)/i.test(url)) return;
        if (window.desktopService?.isAvailable()) window.desktopService.openExternal(url).catch(error => updateStatusBarText('save', String(error)));
        else window.open(url, '_blank', 'noopener,noreferrer');
    });
}
