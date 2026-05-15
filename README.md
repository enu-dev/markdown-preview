# MD Preview

シンプルなのに機能豊富なリアルタイム・マークダウンエディタ。  
ブラウザでダブルクリックするだけで動く。バニラJS + CDNライブラリのみ。

## デモ

<!-- えぬがGitHub Pages公開後に追記 -->
- **デモ URL**: https://enu-dev.github.io/markdown-preview/
- **リポジトリ**: https://github.com/enu-dev/markdown-preview

## スクリーンショット

<!-- えぬが追記 -->

---

## 機能一覧

### 入力・編集
- リアルタイムプレビュー（入力と同時に即反映）
- 入力エリアのシンタックスハイライト（overlay方式・ライブラリ不使用）
- キーボードショートカット充実
- タブインデント / アンインデント

### マークダウン対応
- 見出し（h1〜h6）、太字・斜体・打ち消し線
- 順序付き / 番号なしリスト
- チェックボックス（`- [ ]` / `- [x]`）
- リンク・画像・引用・水平線
- コードブロック（言語指定でシンタックスハイライト）
- テーブル・脚注
- **Mermaid** フローチャート（CDN）
- **KaTeX** 数式（CDN）

### プレビュー
- スクロール同期（入力とプレビューが連動）
- コードブロックのコピーボタン（ホバーで表示）
- チェックボックスをクリック不可の実際のチェックボックスとして表示

### エクスポート
- マークダウンをクリップボードにコピー
- HTMLをクリップボードにコピー
- `.md` ファイルとしてダウンロード
- `.html` ファイルとしてダウンロード

### 表示・UI
- ダークモード / ライトモード切り替え（デフォルト：ダーク）
- フォントサイズ調整（10px〜22px）
- 分割表示 / 入力のみ / プレビューのみ の3モード
- ペイン幅をドラッグで自由に調整
- 文字数・単語数・読了時間をヘッダーに表示
- マークダウンチートシート（ヘルプボタン）

### ストレージ
- 自動保存（1秒デバウンス・localStorage）
- 複数ドキュメントの保存・切り替え・削除
- ドキュメントのタイトルを内容から自動抽出

### ファイル操作
- `.md` / `.txt` ファイルのドラッグ&ドロップ読み込み

---

## キーボードショートカット

| ショートカット | 動作 |
|---|---|
| `Ctrl+B` | 太字（`**テキスト**`） |
| `Ctrl+I` | 斜体（`*テキスト*`） |
| `Ctrl+K` | リンク挿入（`[テキスト](URL)`） |
| `Ctrl+Shift+C` | コードブロック挿入 |
| `Tab` | インデント（2スペース） |
| `Shift+Tab` | アンインデント |
| `Alt+T` | ダーク/ライトテーマ切り替え |
| `Alt+H` | チートシートを開く |
| `Alt++` | フォントサイズを大きく |
| `Alt+-` | フォントサイズを小さく |

---

## 使い方

1. `index.html` をブラウザで開く（ダブルクリックでOK）
2. 左ペインにマークダウンを入力すると、右ペインにリアルタイムでプレビュー表示
3. `Docs` ボタンで複数ドキュメントを管理
4. `Export` ボタンでMDまたはHTMLとしてエクスポート
5. `.md` ファイルをウィンドウにドラッグ&ドロップして読み込み可能

---

## 技術スタック

| 種別 | 内容 |
|---|---|
| HTML / CSS / JavaScript | バニラ（フレームワーク・ビルドツール不使用） |
| マークダウンパース | [marked.js](https://marked.js.org/) v9.1.6（CDN） |
| コードハイライト | [highlight.js](https://highlightjs.org/) v11.9.0（CDN） |
| 数式レンダリング | [KaTeX](https://katex.org/) v0.16.9（CDN） |
| フローチャート | [Mermaid](https://mermaid.js.org/) v10.6.1（CDN） |
| データ保存 | localStorage（サーバー不要） |

---

## 実装のポイント解説

### 入力エリアのシンタックスハイライト（ライブラリ不使用）

CodeMirrorのような専用エディタライブラリを使わず、`textarea` の後ろに `div` を重ねる **overlay方式** で実装。

```
[div.editor-hl]  ← シンタックスハイライト用（pointer-events: none）
[textarea.editor] ← 実際の入力（z-index: 1、背景transparent）
```

JavaScript側で正規表現を使ってマークダウン記法をHTMLに変換し、overlayに流し込む。textareaのスクロールイベントでoverlayのscrollTopを同期させてズレを防ぐ。

### KaTeX前処理

markedがレンダリングする前に数式（`$...$`・`$$...$$`）をプレースホルダーに退避させ、marked通過後に復元することでHTMLエスケープを防止。

```
$数式$ → \x02MATHI0\x03 → marked通過 → KaTeX.renderToString()
```

### デバウンス戦略

| 処理 | デバウンス |
|---|---|
| シンタックスハイライト | 即座 |
| プレビューレンダリング | 80ms |
| localStorage自動保存 | 1000ms |

### スクロール同期

```javascript
ratio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight)
preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight)
```

プレビュー側を手動スクロールした場合は200msの間、エディタ→プレビューの同期を一時停止して不自然な動きを防ぐ。

---

## コード行数

| ファイル | 行数 |
|---|---|
| `index.html` | 約 170行 |
| `css/style.css` | 約 430行 |
| `js/script.js` | 約 430行 |
| **合計** | **約 1,030行** |

---

## ファイル構成

```
markdown-preview/
├── index.html       HTMLのみ（style/script埋め込みなし）
├── css/
│   └── style.css    CSS変数でテーマ管理、レスポンシブ対応
├── js/
│   └── script.js    モジュール構成のバニラJS
├── README.md
└── LICENSE          MIT
```

---

## ライセンス

MIT License — Fork・改造・商用利用すべて自由です。  
詳細は [LICENSE](./LICENSE) を参照。
