# CI・テスト方針

このドキュメントは、GitHub へ push したときに GitHub Actions で実行する CI と、自動テストの配置・優先順位を定めるものです。

## 目的

- push 時と pull request 更新時に、リポジトリ内のコードだけで検証できる不具合を早めに検出する。
- Academic Express の実サイトや個人アカウントには CI からアクセスしない。
- まずは取得済み payload のパース結果が期待どおりかを検証し、画面操作の自動化は必要になった段階で範囲を広げる。

## ディレクトリ方針

- `tests/fixtures/`
  - 既存のテスト用 XML / JSON / HTML / JS 保存データを置く。
  - 新しい fixture は、どの API・画面・問題形式から取ったものか分かる名前にする。
  - fixture の期待正答や特殊な挙動は、必要に応じて `docs/unresolved-quiz-patterns.md` に追記する。
- `test/`
  - 自動テストコードを置く。
  - fixture を読み込み、パーサや純粋関数の戻り値を検証する。
  - 実サイトへの通信、Chrome 拡張の手動インストール、ユーザー操作が必要な検証は置かない。

現在 `tests/` 直下にある既存データは fixture として扱い、テスト導入時に `tests/fixtures/` へ移す。新規データは最初から `tests/fixtures/` に追加する。

## CI の基本方針

- GitHub Actions は `push` と `pull_request` で実行する。
- CI は再現性を優先し、テスト実行に必要な依存関係は lock file で固定する。
- シークレット、学習サイトの認証情報、個人環境のパスに依存するテストは追加しない。
- 失敗したときに原因を追いやすいよう、最初は小さな job に分けすぎず、`install`、`syntax check`、`test` の流れを明確にする。
- GitHub Actions の action バージョンは、workflow を追加する時点で公式情報を確認し、major version を明示して使う。

現在の workflow は `.github/workflows/ci.yml` に置き、Node.js 24 で `npm ci` と `npm test` を実行する。

## 最初に実装するテスト

最初の CI では、`extension/parser.js` に分離したパース処理を、Chrome API 依存なしで Node.js から直接テストする。拡張機能の Service Worker である `extension/background.js` は同じ parser を `importScripts('parser.js')` で読み込む。

- XML fixture のパース
  - `authoring.xml`、`authoring2.xml`、`question_authoring.xml` を読み込む。
  - 問題数、`displayOrder`、`questionNo`、`type`、`rawText`、`answers`、`signature` が期待どおりか確認する。
  - `<answer>2</answer>` のような番号参照が `<choice no="2">...</choice>` の表示テキストへ解決されることを確認する。
- Vocabulary Bank / tango payload のパース
  - `tango_data_manipulate` 形式を汎用 JSON より先に判定できることを確認する。
  - `wd_type=1`、`wd_type=5`、`wd_type=2`、`wd_type=7` の出題方向と `isAutoAdvance` を確認する。
  - `know_chk` を正答扱いしないことを確認する。
- 文字列正規化
  - CDATA、HTML entity、タグ除去、空白正規化、アポストロフィ保持を確認する。
  - `girl's` と `girls'` のような選択肢を同一視しないことを確認する。

## テストコードだけで追加しやすい検証

パース検証に加えて、ブラウザや実サイトなしで次の内容を CI に含められる。

- `extension/*.js` の構文チェック。
- `extension/manifest.json` の JSON と Manifest V3 としての最低限の整合性チェック。
- manifest に書かれた script と icon のファイル存在チェック。
- XHR 捕捉対象 URL の判定チェック。
  - `.xml`、`.json`、`authoring.cfc`、`tango_data_manipulate.cfc` などを対象にする。
  - `save_progress` は対象外にする。
- fixture に対するスナップショットではなく、期待値を明示したアサーション。
  - 仕様変更に気づきやすくするため、巨大な丸ごと snapshot にはしない。

ローカルでは次のコマンドで CI 相当のテストを実行する。

```powershell
npm test
```

## CI にまだ入れないもの

- Academic Express の実サイトへアクセスする end-to-end テスト。
- 個人アカウント、学習履歴、セッション、Cookie に依存するテスト。
- Chrome 拡張を実ブラウザへ読み込む操作テスト。
- 速度モードの待ち時間や実クリックの完全な再現テスト。

これらは必要になった時点で、ローカル検証手順または手動確認手順として別途整理する。

## ドキュメント更新ルール

- 新しい fixture を追加し、既存の問題パターンと違う仕様が見つかった場合は `docs/unresolved-quiz-patterns.md` を更新する。
- CI の job、テスト配置、fixture 運用、重要な設計判断を変える場合は、このドキュメントを更新する。
- `AGENTS.md` には詳細を重複させず、このドキュメントへの参照を置く。
