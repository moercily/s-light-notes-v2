import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="note-editor" contenteditable="true"></div><div id="format-toolbar"></div>', { runScripts: 'outside-only', url: 'https://notes.test' });
const w = dom.window;
w.eval(readFileSync('app/js/utils.js', 'utf8'));
w.AppState = { _editSession: 1, isDirty: false };
w.updateStatusBarText = () => {};
w.updateEditorToolbar = () => {};
w.refreshNoteList = async () => {};
w.eval(readFileSync('app/js/editor.js', 'utf8'));
const editor = w.document.querySelector('#note-editor');
const load = text => w.setEditorMarkdown(editor, text);
const read = () => w.htmlToMarkdown(editor);

const fixtures = [
    '# 中文标题\n\n正文 **加粗** 和 *斜体*\n\n\n结尾\n',
    '- 父级\n  - 子级\n    - 孙级\n  - 第二项\n- 结束',
    '3. 第三项\n4. 第四项\n\n- [x] 完成\n- [ ] 待做',
    '```rust\nfn main() { println!("中文"); }\n```\n\n````markdown\n```js\ncode\n```\n````\n',
    '~~不支持的语法也不丢失~~\n\n| a | b |\n| - | - |\n| 1 | 2 |\n',
    '[链接](https://example.com/a_(b)?x=1&y=2)\n\n![图片](images/a.png)',
    '行内 `` `code` `` 与 `**不是加粗**` 和 \\*普通星号\\*',
    '\n\n开始\n\n\n结尾\n\n',
    '> 第一行\n>\n> 第二行\n',
];
for (const content of fixtures) { load(content); assert.equal(read(), content, `unchanged content must retain exact source: ${content}`); }

// Editing one block must leave other blocks, unsupported syntax and spacing intact.
load('# 标题\n\n```rust\nlet x = 1;\n```\n\n\n保留末尾\n');
editor.querySelector('h1').textContent = '新标题';
assert.equal(read(), '# 新标题\n\n```rust\nlet x = 1;\n```\n\n\n保留末尾\n');
editor.querySelector('code').textContent = 'let x = 2;';
assert.match(read(), /```rust\nlet x = 2;\n```/);

load('3. 第三项\n4. 第四项');
editor.querySelector('li').firstChild.textContent = '改第三项';
assert.equal(read(), '3. 改第三项\n4. 第四项');
load('- 父级\n  - 子级\n- 第二项');
editor.querySelector('li').firstChild.textContent = '新父级';
assert.equal(read(), '- 新父级\n  - 子级\n- 第二项');

load('正文 `**代码**`\n\n[带括号](https://example.com/a_(b))');
assert.equal(editor.querySelector('code').textContent, '**代码**');
assert.equal(editor.querySelector('code strong'), null);
assert.equal(editor.querySelector('a').getAttribute('href'), 'https://example.com/a_(b)');

for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'file:///etc/passwd', '//evil.test/a', '\\evil.test/a', 'java\nscript:alert(1)']) {
    load(`[点我](${url})\n\n![图片](${url})`);
    assert.equal(editor.querySelector('a,img,script,iframe'), null, `unsafe URL: ${url}`);
}
load('<img src=x onerror=alert(1)>\n\n![x" onerror="alert(1)](https://example.com/image.png)');
assert.equal(editor.querySelector('[onerror],script,iframe'), null);
load('![x](data:image/png;base64,AAAA)'); assert.ok(editor.querySelector('img'));

// Pasted markup is reduced to text before entering the editor.
let inserted;
w.document.execCommand = (command, _, text) => { inserted = { command, text }; };
w.handleImagePaste({ preventDefault() {}, clipboardData: { items: [], getData: () => '<script>bad()</script>' } }, editor);
assert.deepEqual(inserted, { command: 'insertText', text: '<script>bad()</script>' });

// Immediate undo captures edits even before the debounced snapshot fires.
load('原文'); w.clearUndoStack(); w.saveUndoSnapshot(editor);
editor.firstChild.textContent = '新文'; w.undo(editor); assert.equal(editor.textContent, '原文');
w.redo(editor); assert.equal(editor.textContent, '新文');

// Composition must not autosave an unfinished IME candidate.
w.initEditorComposition(editor, () => {});
editor.dispatchEvent(new w.CompositionEvent('compositionstart'));
assert.equal(w.AppState._composing, true);
editor.dispatchEvent(new w.CompositionEvent('compositionend'));
assert.equal(w.AppState._composing, false);
w.clearUndoStack();
dom.window.close();
console.log('editor source preservation, Markdown, paste, URL, undo and IME tests passed');
