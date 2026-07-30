# Academic Express Automation

Academic Express の問題ページで解答補助を行う Chrome / Edge 向けブラウザ拡張機能です。
対象サイトは拡張機能のポップアップから有効化でき、問題データを取得して対応済み形式を自動入力します。

## 導入

最新版の配布 zip は次のリンクから取得できます。

[academic-express-automation.zip](https://github.com/yukiguma/Academic_Express_Automation/releases/latest/download/academic-express-automation.zip)

### Chrome

1. zip をダウンロードして展開します。
2. `chrome://extensions` を開きます。
3. 右上の「デベロッパーモード」を有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」を押します。
5. 展開したフォルダを選択します。

### Edge

1. zip をダウンロードして展開します。
2. `edge://extensions` を開きます。
3. 左側の「開発者モード」を有効にします。
4. 「展開して読み込み」を押します。
5. 展開したフォルダを選択します。

## 使い方

1. Academic Express の対象サイトを開きます。
2. ブラウザのツールバーから Academic Express Automation を開きます。
3. 「このサイトで有効にする」を押します。
4. 権限の確認が出た場合は許可します。
5. 問題ページに表示される「自動入力」ボタンから解答補助を開始します。

ポップアップでは、有効化済みサイトの確認、サイトごとの無効化、不要になった権限の解除ができます。

## 主な機能

- 任意の Academic Express サイトをポップアップから有効化
- 問題データの取得と解析
- 選択式、穴埋め、並び替え、語彙問題などの自動入力
- 高速モード / 低速モードの切り替え
- 語彙データなどのローカル保存
- 複数問題の連続実行

## 対応問題タイプ

| タイプ | 対応状況 | 備考 |
| --- | --- | --- |
| Matching | 対応 | 画像マッチング等 |
| Insertion | 対応 | 文挿入 |
| Multiple Choice | 対応 | 選択式 |
| True/False | 対応 | 正誤判定 |
| anaumeFilIn | 対応 | 穴埋め |
| ClozeTest | 対応 | 穴埋めテスト |
| Sorting | 対応 | 並び替え |
| Listan | 対応 | 音声スクリプトから聞き取り対象語を一括入力 |
| Vocabulary Bank | 対応 | 語彙データの蓄積と活用 |

## 開発者向け

ローカルで未パッケージ版を読み込む場合は、このリポジトリの `extension/` フォルダをブラウザの拡張機能画面から選択します。

テストは次のコマンドで実行します。

```powershell
npm test
```

実サイトへChrome拡張を読み込むLive E2Eは、GitHub Actionsの `Academic Express Live E2E` workflowから手動実行します。認証情報の設定と安全上の制約は [CI・テスト方針](docs/ci-and-test-policy.md#実サイト-live-e2e) を参照してください。

バージョンの整合性は次のコマンドで確認します。

```powershell
npm run version:check
```

リリース時は GitHub Actions の `Prepare Release` workflow でバージョンを指定して Release PR を作成し、マージ後に `Publish Release` workflow でタグ、GitHub Release、配布 zip を作成します。

## ファイル構成

```text
extension/
├── manifest.json
├── popup.html
├── popup.js
├── background.js
├── content.js
├── solvers.js
├── xhr-intercept.js
└── icons/
```

## 注意事項

このツールは教育目的で作成されています。利用するサイトや所属組織の規約を確認し、使用は自己責任で行ってください。

## ライセンス

MIT
