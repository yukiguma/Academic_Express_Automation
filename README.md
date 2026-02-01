# Academic Express Auto Answer

Chrome/Edge用のブラウザ拡張機能。Academic Express（京都工芸繊維大学の英語学習システム）の問題を自動解答します。

![Icon](extension/icons/icon128.png)

## 機能

- ✅ **自動解答**: マッチング、選択問題、穴埋め、並び替え等に対応
- ✅ **XHRインターセプト**: 問題データをリアルタイムでキャプチャ
- ✅ **速度調整**: 高速モード / 低速モード（人間らしいタイミング）
- ✅ **連続実行**: 自動で次の問題へ進行

## 対応問題タイプ

| タイプ | 対応状況 |
|--------|----------|
| Matching | ✅ |
| Insertion | ✅ |
| Multiple Choice | ✅ |
| True/False | ✅ |
| anaumeFilIn (穴埋め) | ✅ |
| ClozeTest | ✅ |
| Sorting (並び替え) | ✅ |
| Vocabulary Bank | ✅ |

## インストール

### Chrome

1. `chrome://extensions` を開く
2. 「デベロッパーモード」を有効化（右上トグル）
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `extension/` フォルダを選択

### Edge

1. `edge://extensions` を開く
2. 「開発者モード」を有効化（左サイドバー）
3. 「展開して読み込み」をクリック
4. `extension/` フォルダを選択

## 使い方

1. Academic Express のサイト（`supereigo.campus.kit.ac.jp`）にアクセス
2. 問題ページを開くと、ヘッダーに「自動入力」ボタンが表示される
3. ボタンをクリックして自動解答を開始

### 速度モード

- **低速モード**: 読解時間を含む人間らしいタイミング（推定時間表示）
- **高速モード**: 即時解答

## ファイル構成

```
extension/
├── manifest.json   # 拡張機能マニフェスト (Manifest V3)
├── background.js   # Service Worker (XHRインターセプト)
├── content.js      # コンテンツスクリプト (UI・解答ロジック)
└── icons/          # 拡張機能アイコン
```

## 技術詳細

- **Manifest V3**: 最新のChrome拡張機能規格
- **chrome.webRequest**: ネットワークリクエストのインターセプト
- **chrome.storage.session**: 一時データの保存
- **MutationObserver**: DOM変更の監視

## ライセンス

MIT

## 免責事項

このツールは教育目的で作成されています。使用は自己責任でお願いします。
