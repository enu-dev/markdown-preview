/**
 * MD Preview — メインスクリプト
 * バニラJS + marked.js + highlight.js + KaTeX + Mermaid (全てCDN経由)
 *
 * モジュール構成:
 *   Storage           - localStorage CRUD
 *   MarkdownRenderer  - marked設定・レンダリング
 *   SyntaxHighlighter - 入力エリアのoverlay式シンタックスハイライト
 *   ScrollSync        - エディタ/プレビューのスクロール同期
 *   DocManager        - 複数ドキュメント管理
 *   ExportManager     - MD/HTMLのコピー・ダウンロード
 *   UIController      - モード・テーマ・フォントサイズ・モーダル
 *   Resizer           - ペイン幅ドラッグ調整
 *   Shortcuts         - キーボードショートカット
 *   Stats             - 文字数・単語数・読了時間
 *   DragDrop          - .mdファイルのドラッグ&ドロップ読み込み
 *   App               - 全体の初期化・統合
 */

'use strict';

/* ============================================================
   Storage
   ============================================================ */
const Storage = (() => {
  const PREFIX = 'mdp:';

  function get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
    catch (e) { console.warn('Storage write failed:', e); }
  }

  function remove(key) { localStorage.removeItem(PREFIX + key); }

  return {
    getDocList()      { return get('doclist', []); },
    saveDocList(list) { set('doclist', list); },

    getDoc(id)  { return get('doc:' + id, null); },
    saveDoc(doc) {
      set('doc:' + doc.id, doc);
      const list = this.getDocList();
      const idx  = list.findIndex(d => d.id === doc.id);
      const meta = { id: doc.id, title: doc.title, updatedAt: doc.updatedAt };
      if (idx >= 0) list[idx] = meta; else list.unshift(meta);
      this.saveDocList(list);
    },
    deleteDoc(id) {
      remove('doc:' + id);
      this.saveDocList(this.getDocList().filter(d => d.id !== id));
    },

    getSettings()        { return get('settings', { theme: 'dark', fontSize: 14, currentDocId: null, mode: 'split' }); },
    saveSettings(s)      { set('settings', s); }
  };
})();

/* ============================================================
   MarkdownRenderer
   ============================================================ */
const MarkdownRenderer = (() => {
  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(str) {
    return str.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function init() {
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark',
        securityLevel: 'loose'
      });
    }

    const renderer = new marked.Renderer();

    // コードブロック
    renderer.code = function(code, lang) {
      if (lang === 'mermaid') {
        const safeCode = escHtml(typeof code === 'object' ? code.text : code);
        return `<div class="mermaid-wrap"><div class="mermaid">${safeCode}</div></div>`;
      }
      const codeText = typeof code === 'object' ? code.text : code;
      const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      let highlighted;
      try { highlighted = hljs.highlight(codeText, { language: validLang }).value; }
      catch { highlighted = escHtml(codeText); }
      return `<pre><code class="hljs language-${validLang}">${highlighted}</code>` +
             `<button class="code-copy-btn" data-code="${escAttr(codeText)}">Copy</button></pre>`;
    };

    // チェックボックスリスト
    renderer.listitem = function(item) {
      const text = typeof item === 'object' ? item.text : item;
      const task = typeof item === 'object' ? item.task : false;
      const checked = typeof item === 'object' ? item.checked : false;
      if (task) {
        return `<li><input type="checkbox" ${checked ? 'checked' : ''} disabled> ${text}</li>\n`;
      }
      return `<li>${text}</li>\n`;
    };

    marked.use({
      renderer,
      gfm: true,
      breaks: false,
      pedantic: false
    });
  }

  function render(text) {
    // KaTeX前処理: 数式をプレースホルダーに退避（marked.jsに壊されないよう）
    const mathBlocks  = [];
    const mathInlines = [];

    let src = text
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => {
        mathBlocks.push(formula);
        return `\x02MATHB${mathBlocks.length - 1}\x03`;
      })
      .replace(/\$([^$\n]+?)\$/g, (_, formula) => {
        mathInlines.push(formula);
        return `\x02MATHI${mathInlines.length - 1}\x03`;
      });

    let html = marked.parse(src);

    // KaTeX復元
    if (typeof katex !== 'undefined') {
      html = html
        .replace(/\x02MATHB(\d+)\x03/g, (_, i) => {
          try {
            return `<div class="katex-block">${katex.renderToString(mathBlocks[i], { displayMode: true, throwOnError: false })}</div>`;
          } catch { return `<code>$$${mathBlocks[i]}$$</code>`; }
        })
        .replace(/\x02MATHI(\d+)\x03/g, (_, i) => {
          try {
            return katex.renderToString(mathInlines[i], { displayMode: false, throwOnError: false });
          } catch { return `<code>$${mathInlines[i]}$</code>`; }
        });
    } else {
      // KaTex未ロード時はプレースホルダーをそのまま除去
      html = html.replace(/\x02MATHB\d+\x03/g, '').replace(/\x02MATHI\d+\x03/g, '');
    }

    return html;
  }

  return { init, render };
})();

/* ============================================================
   SyntaxHighlighter（入力エリアのoverlay式ハイライト）
   ============================================================ */
const SyntaxHighlighter = (() => {
  let overlayEl, editorEl;

  function init(editor, overlay) {
    editorEl  = editor;
    overlayEl = overlay;
    editor.addEventListener('scroll', () => {
      overlay.scrollTop  = editor.scrollTop;
      overlay.scrollLeft = editor.scrollLeft;
    });
  }

  function update(text) {
    overlayEl.innerHTML = _highlight(text);
    overlayEl.scrollTop  = editorEl.scrollTop;
    overlayEl.scrollLeft = editorEl.scrollLeft;
  }

  function _highlight(text) {
    // HTMLエスケープ
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // コードブロック（```...```）を先に退避
    const codeBlocks = [];
    html = html.replace(/^```[\s\S]*?^```/gm, m => {
      codeBlocks.push(m);
      return `\x02CB${codeBlocks.length - 1}\x03`;
    });

    // インラインコードを退避
    const inlineCodes = [];
    html = html.replace(/`[^`\n]+`/g, m => {
      inlineCodes.push(m);
      return `\x02IC${inlineCodes.length - 1}\x03`;
    });

    // 行単位処理
    html = html.split('\n').map(line => {
      // 見出し
      const hMatch = line.match(/^(#{1,6})( .*)$/);
      if (hMatch) {
        return `<span class="hl-header">${hMatch[1]}</span><span class="hl-header-text">${hMatch[2]}</span>`;
      }
      // 引用
      if (/^(&gt;|>)/.test(line)) return `<span class="hl-quote">${line}</span>`;
      // 水平線
      if (/^(---|\*\*\*|___)$/.test(line)) return `<span class="hl-hr">${line}</span>`;

      // リストマーカー
      line = line.replace(/^(\s*)([-+*])( )/, (_, ind, m, sp) =>
        `${ind}<span class="hl-list">${m}</span>${sp}`);
      line = line.replace(/^(\s*)(\d+\.)( )/, (_, ind, m, sp) =>
        `${ind}<span class="hl-list">${m}</span>${sp}`);

      // チェックボックス
      line = line.replace(/(\[ \]|\[x\])/gi, m => `<span class="hl-checkbox">${m}</span>`);

      // 太字
      line = line.replace(/\*\*(.+?)\*\*/g, (_, inner) =>
        `<span class="hl-bold">**${inner}**</span>`);
      // 斜体
      line = line.replace(/\*([^*\n]+)\*/g, (_, inner) =>
        `<span class="hl-italic">*${inner}*</span>`);
      // 打ち消し
      line = line.replace(/~~(.+?)~~/g, (_, inner) =>
        `<span class="hl-strike">~~${inner}~~</span>`);
      // リンク
      line = line.replace(/(\[[^\]]+\]\([^)]+\))/g, m => `<span class="hl-link">${m}</span>`);

      return line;
    }).join('\n');

    // インラインコード復元
    html = html.replace(/\x02IC(\d+)\x03/g, (_, i) =>
      `<span class="hl-code">${inlineCodes[i]}</span>`);
    // コードブロック復元
    html = html.replace(/\x02CB(\d+)\x03/g, (_, i) =>
      `<span class="hl-code-block">${codeBlocks[i]}</span>`);

    return html;
  }

  return { init, update };
})();

/* ============================================================
   ScrollSync
   ============================================================ */
const ScrollSync = (() => {
  let editorEl, previewEl;
  let enabled = true;
  let timer   = null;

  function init(editor, preview) {
    editorEl  = editor;
    previewEl = preview;
    editor.addEventListener('scroll', _onEditorScroll);
    preview.addEventListener('scroll', () => {
      // プレビュー手動スクロール中は逆同期を一時停止
      enabled = false;
      clearTimeout(timer);
      timer = setTimeout(() => { enabled = true; }, 200);
    });
  }

  function _onEditorScroll() {
    if (!enabled) return;
    const ratio = editorEl.scrollTop /
      Math.max(editorEl.scrollHeight - editorEl.clientHeight, 1);
    previewEl.scrollTop = ratio * (previewEl.scrollHeight - previewEl.clientHeight);
  }

  return { init, sync: _onEditorScroll };
})();

/* ============================================================
   DocManager
   ============================================================ */
const DocManager = (() => {
  let currentId = null;
  let listEl    = null;

  function _newId() {
    return 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }
  function _createDoc(title, content = '') {
    return { id: _newId(), title, content, updatedAt: new Date().toISOString() };
  }
  function _esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _ensureOneDoc() {
    if (Storage.getDocList().length === 0) {
      const doc = _createDoc('はじめてのドキュメント', WELCOME_TEXT);
      Storage.saveDoc(doc);
    }
  }

  function init() {
    listEl = document.getElementById('docs-list');
    _ensureOneDoc();
    const settings = Storage.getSettings();
    const list     = Storage.getDocList();
    const targetId = (settings.currentDocId && list.find(d => d.id === settings.currentDocId))
      ? settings.currentDocId : (list[0]?.id || null);
    if (targetId) switchDoc(targetId);

    document.getElementById('btn-new-doc').addEventListener('click', newDoc);
  }

  function newDoc() {
    const count = Storage.getDocList().length + 1;
    const doc   = _createDoc('無題のドキュメント ' + count);
    Storage.saveDoc(doc);
    switchDoc(doc.id);
    renderList();
    UIController.closeModal('modal-docs');
    App.showToast('新規ドキュメントを作成しました');
  }

  function switchDoc(id) {
    if (currentId) saveCurrentContent();
    const doc = Storage.getDoc(id);
    if (!doc) return;
    currentId = id;
    document.getElementById('editor').value = doc.content;
    const s = Storage.getSettings();
    s.currentDocId = id;
    Storage.saveSettings(s);
    App.updatePreview();
    renderList();
  }

  function saveCurrentContent() {
    if (!currentId) return;
    const editor = document.getElementById('editor');
    const doc    = Storage.getDoc(currentId);
    if (!doc) return;
    const content   = editor.value;
    const firstLine = content.split('\n').find(l => l.trim()) || '無題';
    doc.title     = firstLine.replace(/^#+\s*/, '').slice(0, 50) || '無題のドキュメント';
    doc.content   = content;
    doc.updatedAt = new Date().toISOString();
    Storage.saveDoc(doc);
  }

  function deleteDoc(id) {
    if (Storage.getDocList().length <= 1) {
      App.showToast('最後のドキュメントは削除できません', 'error');
      return;
    }
    Storage.deleteDoc(id);
    if (currentId === id) {
      const remaining = Storage.getDocList();
      if (remaining.length > 0) switchDoc(remaining[0].id);
    }
    renderList();
  }

  function renderList() {
    const list = Storage.getDocList();
    listEl.innerHTML = '';
    list.forEach(meta => {
      const li  = document.createElement('li');
      li.className = 'doc-item' + (meta.id === currentId ? ' active' : '');
      const d   = new Date(meta.updatedAt);
      const ds  = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      li.innerHTML = `
        <span class="doc-title">${_esc(meta.title)}</span>
        <span class="doc-date">${ds}</span>
        <button class="doc-delete" aria-label="削除">✕</button>`;
      li.addEventListener('click', e => {
        if (!e.target.classList.contains('doc-delete')) {
          switchDoc(meta.id);
          UIController.closeModal('modal-docs');
        }
      });
      li.querySelector('.doc-delete').addEventListener('click', e => {
        e.stopPropagation();
        deleteDoc(meta.id);
      });
      listEl.appendChild(li);
    });
  }

  return { init, newDoc, switchDoc, saveCurrentContent, renderList, get currentId() { return currentId; } };
})();

/* ============================================================
   ExportManager
   ============================================================ */
const ExportManager = (() => {
  function _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function _title() {
    const doc = Storage.getDoc(DocManager.currentId);
    return (doc?.title || '無題').replace(/[/\\?%*:|"<>]/g, '-');
  }

  function _fullHtml() {
    const inner = document.getElementById('preview').innerHTML;
    const theme = document.documentElement.dataset.theme;
    const bg    = theme === 'light' ? '#f0f5fb' : '#0d1520';
    const color = theme === 'light' ? '#1a2332'  : '#c9d8e8';
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(_title())}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${bg};color:${color};max-width:800px;margin:0 auto;padding:2rem;line-height:1.75}
  code{font-family:'SFMono-Regular',Consolas,monospace}
  pre{background:#1a2332;padding:1rem;border-radius:6px;overflow-x:auto}
  pre code{color:#c9d8e8}
  a{color:#00d4ff}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #2d4263;padding:6px 12px}
  th{background:#1a2332}
  blockquote{border-left:3px solid #00d4ff;margin:1em 0;padding:4px 16px;background:rgba(0,212,255,0.08)}
  img{max-width:100%}
  .code-copy-btn{display:none}
</style>
</head>
<body>${inner}</body>
</html>`;
  }

  async function _copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement('textarea');
      el.value = text; el.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(el); el.select(); document.execCommand('copy');
      document.body.removeChild(el);
    }
  }

  function _download(name, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    async copyMd()   { await _copy(document.getElementById('editor').value); App.showToast('マークダウンをコピーしました', 'success'); },
    async copyHtml() { await _copy(_fullHtml()); App.showToast('HTMLをコピーしました', 'success'); },
    downloadMd()     { _download(_title() + '.md',   document.getElementById('editor').value, 'text/markdown'); App.showToast('.md を保存しました', 'success'); },
    downloadHtml()   { _download(_title() + '.html', _fullHtml(), 'text/html'); App.showToast('.html を保存しました', 'success'); }
  };
})();

/* ============================================================
   UIController
   ============================================================ */
const UIController = (() => {
  let settings = null;

  function init() {
    settings = Storage.getSettings();
    _applyTheme(settings.theme);
    _applyFontSize(settings.fontSize);
    _applyMode(settings.mode || 'split');

    // テーマ
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);

    // フォントサイズ
    document.getElementById('btn-font-up').addEventListener('click', () => changeFontSize(+1));
    document.getElementById('btn-font-down').addEventListener('click', () => changeFontSize(-1));

    // 表示モード
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _applyMode(btn.dataset.mode);
        settings.mode = btn.dataset.mode;
        Storage.saveSettings(settings);
      });
    });

    // エクスポートドロップダウン
    const expBtn  = document.getElementById('btn-export');
    const expMenu = document.getElementById('export-menu');
    expBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !expMenu.hidden;
      expMenu.hidden = open;
      expBtn.setAttribute('aria-expanded', String(!open));
    });
    expMenu.querySelectorAll('[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        expMenu.hidden = true;
        expBtn.setAttribute('aria-expanded', 'false');
        const actions = {
          'copy-md':   () => ExportManager.copyMd(),
          'copy-html': () => ExportManager.copyHtml(),
          'dl-md':     () => ExportManager.downloadMd(),
          'dl-html':   () => ExportManager.downloadHtml()
        };
        actions[item.dataset.action]?.();
      });
    });
    document.addEventListener('click', () => { expMenu.hidden = true; expBtn.setAttribute('aria-expanded','false'); });

    // モーダル開閉
    document.getElementById('btn-docs').addEventListener('click', () => {
      DocManager.renderList();
      openModal('modal-docs');
    });
    document.getElementById('btn-help').addEventListener('click', () => openModal('modal-help'));
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach(m => closeModal(m.id));
    });
  }

  function toggleTheme() {
    const next = settings.theme === 'dark' ? 'light' : 'dark';
    _applyTheme(next);
    settings.theme = next;
    Storage.saveSettings(settings);
    // Mermaid再レンダリング
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({ theme: next === 'light' ? 'default' : 'dark' });
      App.updatePreview();
    }
  }

  function _applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.getElementById('btn-theme').textContent = theme === 'dark' ? '☀️' : '🌙';
    const dark  = document.getElementById('hljs-theme-dark');
    const light = document.getElementById('hljs-theme-light');
    if (dark)  dark.disabled  = (theme === 'light');
    if (light) light.disabled = (theme === 'dark');
  }

  function changeFontSize(delta) {
    const size = Math.min(22, Math.max(10, (settings.fontSize || 14) + delta));
    _applyFontSize(size);
    settings.fontSize = size;
    Storage.saveSettings(settings);
  }

  function _applyFontSize(size) {
    const root = document.documentElement;
    root.style.setProperty('--font-size-editor',  size + 'px');
    root.style.setProperty('--font-size-preview', (size + 1) + 'px');
  }

  function _applyMode(mode) {
    const ep = document.getElementById('pane-editor');
    const pp = document.getElementById('pane-preview');
    const rs = document.getElementById('resizer');
    ep.classList.remove('pane--hidden');
    pp.classList.remove('pane--hidden');
    rs.style.display = '';
    if (mode === 'editor-only')  { pp.classList.add('pane--hidden'); rs.style.display = 'none'; }
    if (mode === 'preview-only') { ep.classList.add('pane--hidden'); rs.style.display = 'none'; }
    document.querySelectorAll('.mode-btn').forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.hidden = false;
    m.querySelector('button, input, [tabindex]')?.focus();
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.hidden = true;
  }

  return { init, toggleTheme, changeFontSize, openModal, closeModal };
})();

/* ============================================================
   Resizer（ペイン幅ドラッグ）
   ============================================================ */
const Resizer = (() => {
  function init() {
    const resizer = document.getElementById('resizer');
    const main    = document.getElementById('main');
    let dragging  = false;
    let startX, startRatio;

    function onStart(clientX) {
      dragging    = true;
      startX      = clientX;
      startRatio  = document.getElementById('pane-editor').offsetWidth / main.offsetWidth;
      resizer.classList.add('dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    function onMove(clientX) {
      if (!dragging) return;
      const ratio = Math.min(0.82, Math.max(0.18, startRatio + (clientX - startX) / main.offsetWidth));
      document.getElementById('pane-editor').style.flex  = `0 0 ${ratio * 100}%`;
      document.getElementById('pane-preview').style.flex = `0 0 ${(1 - ratio) * 100}%`;
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
    }

    resizer.addEventListener('mousedown', e => onStart(e.clientX));
    document.addEventListener('mousemove', e => onMove(e.clientX));
    document.addEventListener('mouseup', onEnd);

    resizer.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
    document.addEventListener('touchmove',  e => onMove(e.touches[0].clientX), { passive: true });
    document.addEventListener('touchend', onEnd);
  }
  return { init };
})();

/* ============================================================
   Shortcuts
   ============================================================ */
const Shortcuts = (() => {
  let editorEl;

  function _wrap(before, after, placeholder) {
    const s    = editorEl.selectionStart;
    const e    = editorEl.selectionEnd;
    const sel  = editorEl.value.slice(s, e) || placeholder;
    editorEl.setRangeText(before + sel + after, s, e, 'select');
    editorEl.setSelectionRange(s + before.length, s + before.length + sel.length);
    editorEl.dispatchEvent(new Event('input'));
  }

  function _indent() {
    const s = editorEl.selectionStart, e = editorEl.selectionEnd;
    const val = editorEl.value;
    if (s !== e) {
      const ls = val.lastIndexOf('\n', s - 1) + 1;
      const le = val.indexOf('\n', e); const end = le < 0 ? val.length : le;
      editorEl.setRangeText(val.slice(ls, end).split('\n').map(l => '  ' + l).join('\n'), ls, end, 'select');
    } else {
      editorEl.setRangeText('  ', s, s, 'end');
    }
    editorEl.dispatchEvent(new Event('input'));
  }

  function _unindent() {
    const s = editorEl.selectionStart, e = editorEl.selectionEnd;
    const val = editorEl.value;
    const ls = val.lastIndexOf('\n', s - 1) + 1;
    const le = val.indexOf('\n', e); const end = le < 0 ? val.length : le;
    editorEl.setRangeText(val.slice(ls, end).split('\n').map(l => l.replace(/^ {1,2}/, '')).join('\n'), ls, end, 'select');
    editorEl.dispatchEvent(new Event('input'));
  }

  function _insertLink() {
    const s   = editorEl.selectionStart, e2 = editorEl.selectionEnd;
    const sel = editorEl.value.slice(s, e2) || 'リンクテキスト';
    editorEl.setRangeText(`[${sel}](URL)`, s, e2, 'end');
    editorEl.setSelectionRange(s + sel.length + 3, s + sel.length + 6);
    editorEl.dispatchEvent(new Event('input'));
  }

  function _insertCodeBlock() {
    const s = editorEl.selectionStart, e2 = editorEl.selectionEnd;
    const sel = editorEl.value.slice(s, e2);
    editorEl.setRangeText('```\n' + (sel || 'コード') + '\n```', s, e2, 'end');
    editorEl.dispatchEvent(new Event('input'));
  }

  function init(editor) {
    editorEl = editor;

    editor.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.shiftKey ? _unindent() : _indent();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      switch (e.key.toLowerCase()) {
        case 'b': if (!e.shiftKey) { e.preventDefault(); _wrap('**', '**', '太字'); } break;
        case 'i': if (!e.shiftKey) { e.preventDefault(); _wrap('*', '*', '斜体'); } break;
        case 'k': if (!e.shiftKey) { e.preventDefault(); _insertLink(); } break;
        case 'c': if (e.shiftKey)  { e.preventDefault(); _insertCodeBlock(); } break;
      }
    });

    // グローバルショートカット（Alt+*）
    document.addEventListener('keydown', e => {
      if (!e.altKey) return;
      switch (e.key) {
        case 't': case 'T': e.preventDefault(); UIController.toggleTheme(); break;
        case 'h': case 'H': e.preventDefault(); UIController.openModal('modal-help'); break;
        case '+': case '=': e.preventDefault(); UIController.changeFontSize(+1); break;
        case '-':           e.preventDefault(); UIController.changeFontSize(-1); break;
      }
    });
  }

  return { init };
})();

/* ============================================================
   Stats（文字数・単語数・読了時間）
   ============================================================ */
const Stats = (() => {
  function update(text) {
    const chars = text.length;
    const words = text.trim() ? (text.match(/\S+/g) || []).length : 0;
    const mins  = Math.max(1, Math.ceil(chars / 400));
    document.getElementById('stat-chars').textContent = chars.toLocaleString() + '文字';
    document.getElementById('stat-words').textContent = words.toLocaleString() + '語';
    document.getElementById('stat-read').textContent  = '約' + mins + '分';
  }
  return { update };
})();

/* ============================================================
   DragDrop（.mdファイル読み込み）
   ============================================================ */
const DragDrop = (() => {
  function init() {
    const body = document.body;

    body.addEventListener('dragover', e => {
      e.preventDefault();
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', e => {
      if (!body.contains(e.relatedTarget)) body.classList.remove('drag-over');
    });
    body.addEventListener('drop', e => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const allowed = ['.md', '.txt', '.markdown'];
      if (!allowed.some(ext => file.name.endsWith(ext))) {
        App.showToast('.md / .txt ファイルのみ対応', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        document.getElementById('editor').value = ev.target.result;
        document.getElementById('editor').dispatchEvent(new Event('input'));
        App.showToast(file.name + ' を読み込みました', 'success');
      };
      reader.readAsText(file, 'UTF-8');
    });
  }
  return { init };
})();

/* ============================================================
   ウェルカムテキスト
   ============================================================ */
const WELCOME_TEXT = `# MD Preview へようこそ

シンプルに見えて、触ると機能豊富なマークダウンエディタです。

## 基本機能

- **リアルタイムプレビュー** — 入力した瞬間に反映されます
- **自動保存** — 書いた内容はブラウザに自動保存されます
- **複数ドキュメント** — Docs ボタンで管理・切り替えができます
- **ドラッグ&ドロップ** — .md ファイルをここにドロップして読み込めます

## キーボードショートカット

| ショートカット | 動作 |
|---|---|
| \`Ctrl+B\` | 太字 |
| \`Ctrl+I\` | 斜体 |
| \`Ctrl+K\` | リンク挿入 |
| \`Ctrl+Shift+C\` | コードブロック |
| \`Tab\` | インデント |
| \`Shift+Tab\` | アンインデント |
| \`Alt+T\` | テーマ切り替え |
| \`Alt++\` / \`Alt+-\` | フォントサイズ変更 |

## コードブロック（シンタックスハイライト付き）

\`\`\`javascript
const greet = (name) => {
  return \`Hello, \${name}!\`;
};
console.log(greet('World'));
\`\`\`

## チェックボックスリスト

- [x] リアルタイムプレビュー
- [x] 自動保存
- [x] ダークモード
- [x] Mermaid フローチャート
- [ ] あなたのアイデアをここに

## Mermaid フローチャート

\`\`\`mermaid
graph LR
  A[入力] --> B[パース]
  B --> C[プレビュー]
  C --> D[エクスポート]
\`\`\`

## 数式（KaTeX）

インライン: $E = mc^2$

ブロック:

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

---

> **ヒント**: 右上の **?** でチートシートを表示できます。
`;

/* ============================================================
   App（統合・初期化）
   ============================================================ */
const App = (() => {
  let autoSaveTimer = null;
  let renderTimer   = null;
  let toastTimer    = null;

  function init() {
    const editor   = document.getElementById('editor');
    const preview  = document.getElementById('preview');
    const editorHl = document.getElementById('editor-hl');

    MarkdownRenderer.init();
    SyntaxHighlighter.init(editor, editorHl);
    ScrollSync.init(editor, preview);
    UIController.init();
    DocManager.init();
    Resizer.init();
    Shortcuts.init(editor);
    DragDrop.init();

    // コードブロックのコピーボタン（イベント委譲）
    preview.addEventListener('click', e => {
      const btn = e.target.closest('.code-copy-btn');
      if (!btn) return;
      const code = btn.dataset.code || '';
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      }).catch(() => showToast('コピーに失敗しました', 'error'));
    });

    // エディタ入力
    editor.addEventListener('input', _onInput);

    // 初期プレビュー
    updatePreview();
  }

  function _onInput() {
    const text = document.getElementById('editor').value;
    SyntaxHighlighter.update(text);
    Stats.update(text);

    clearTimeout(renderTimer);
    renderTimer = setTimeout(updatePreview, 80);

    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => DocManager.saveCurrentContent(), 1000);
  }

  function updatePreview() {
    const text    = document.getElementById('editor').value;
    const preview = document.getElementById('preview');
    preview.innerHTML = MarkdownRenderer.render(text);

    // Mermaid再レンダリング
    if (typeof mermaid !== 'undefined') {
      const nodes = preview.querySelectorAll('.mermaid');
      if (nodes.length > 0) {
        mermaid.run({ nodes }).catch(() => {});
      }
    }

    Stats.update(text);
    ScrollSync.sync();
  }

  function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' toast--' + type : '');
    void toast.offsetWidth; // reflow
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  return { init, updatePreview, showToast };
})();

/* ============================================================
   起動
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => App.init());
