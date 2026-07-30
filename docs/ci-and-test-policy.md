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
- `tests/`
  - 自動テストコードを置く。
  - fixture を読み込み、パーサや純粋関数の戻り値を検証する。
  - 実サイトへの通信、Chrome 拡張の手動インストール、ユーザー操作が必要な検証は置かない。

既存および新規のテスト用データは fixture として扱い、`tests/fixtures/` に置く。テストコードも `tests/` に置き、fixture と同じ親ディレクトリで管理する。

## CI の基本方針

- GitHub Actions は `push` と `pull_request` で実行する。
- CI は再現性を優先し、テスト実行に必要な依存関係は lock file で固定する。
- シークレット、学習サイトの認証情報、個人環境のパスに依存するテストは追加しない。
- 失敗したときに原因を追いやすいよう、最初は小さな job に分けすぎず、`install`、`syntax check`、`test` の流れを明確にする。
- GitHub Actions の action バージョンは、workflow を追加する時点で公式情報を確認し、major version を明示して使う。

現在の workflow は `.github/workflows/ci.yml` に置き、Node.js 24 で `npm ci`、`npx playwright install --with-deps chromium`、`npm test` を実行する。

## リリースバージョン運用

拡張機能の表示バージョン、`package.json` のバージョン、Git タグのバージョンは一致させる。ファイル上の正本は `package.json` の `version` とし、`package-lock.json` と `extension/manifest.json` の `version` も同じ値にする。Git タグだけは慣例として `v` プレフィックスを付け、`v1.2.3` のようにする。

通常の機能追加・修正 PR では、原則としてバージョン番号を変更しない。リリースするタイミングで GitHub Actions の `Prepare Release` workflow を手動実行し、`1.2.3` のように `v` なしのバージョンを入力する。この workflow は `release/v1.2.3` ブランチを作成し、`package.json`、`package-lock.json`、`extension/manifest.json` を更新した Release PR を発行する。

Release PR をレビューして `main` にマージした後、`Publish Release` workflow を手動実行する。この workflow は `main` の `package.json` からバージョンを読み取り、`extension/manifest.json` との一致を確認してから `v1.2.3` タグを作成し、`extension/` の内容だけを `academic-express-automation.zip` として GitHub Release に添付する。導入手順では GitHub Releases の `latest/download` URL からこの zip を取得する。

ローカルでは次のコマンドでバージョン同期と確認を行う。

```powershell
npm run version:sync -- 1.2.3
npm run version:check
```

## 最初に実装するテスト

最初の CI では、`extension/parser.js` に分離したパース処理を、Chrome API 依存なしで Node.js から直接テストする。拡張機能の Service Worker である `extension/background.js` は同じ parser を `importScripts('parser.js')` で読み込む。

- XML fixture のパース
  - `authoring.xml`、`authoring2.xml`、`question_authoring.xml`、Grammar Bank の `question_authoring.cfc` を読み込む。
  - 問題数、`displayOrder`、`questionNo`、`type`、`rawText`、`answers`、`signature` が期待どおりか確認する。
  - `<answer>2</answer>` のような番号参照が `<choice no="2">...</choice>` の表示テキストへ解決されることを確認する。
  - Grammar Bank の `sortingA` は、bracket 内の slash 区切りがクリック順の `answers` 配列へ展開されることを確認する。
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

- 速度モードの待ち時間や実クリックの完全な再現テスト。

通常の `push` / `pull_request` CI では、Academic Express の実サイト、個人アカウント、学習履歴、セッション、Cookie に依存するテストを実行しない。実サイトを使う検証は、後述する手動起動の Live E2E workflow に限定する。

## 実サイト Live E2E

`.github/workflows/live-e2e.yml` の `Academic Express Live E2E` workflow は、GitHub Actions の `workflow_dispatch` から手動で起動する。通常CIとは分離し、同時実行を禁止する。ログイン不要で問題画面まで到達できる公式デモは確認できなかったため、京都工芸繊維大学の Academic Express 3 実サイトと `Authentication` Environment の認証情報を使用する。

Live E2E は Playwright の persistent context に `extension/` を unpacked Chrome 拡張として読み込む。`solvers.js` や `content.js` をテストコードから直接注入せず、Manifest V3 の service worker、XHR捕捉、session storage、content scriptsを含めた実際の拡張経路を検証する。

対象は次の6領域とし、各領域の一覧を実サイト上で探索して問題リンクをランダムに選ぶ。手動実行時の `sample_count` で各領域の抽出数を1～3件から選択できる。

- Vocabulary Bank
- Grammar Bank
- Reading Bank
- Listening Bank
- リスニング道場のディクタン
- リスニング道場のリスタン

ランダム選択は GitHub Actions の run ID と再実行番号をseedにする。同一workflow runの調査可能性を残しながら、複数回の実行で異なる問題を通す。Live E2E は実際に自動入力と画面遷移を行うため、学習履歴が更新される可能性がある。push、pull request、Dependabot、forkからは自動実行しない。

Vocabulary Bank と Grammar Bank の学習メニューでは、`未仕分け`、`知らない`、`知ってる` の実表示件数を読み取り、残数が1件以上のモードだけをランダム選択の候補にする。正解済み問題の除外などで出題順と取得payloadの配列順が一致しない場合は、配列位置ではなく現在画面に表示されている問題文で照合する。

1領域の探索や解答に失敗しても後続領域の検証は続行し、最後に失敗領域をまとめてworkflowを失敗させる。これにより、先頭領域の不具合だけでほかの領域の状態が不明になることを防ぐ。

### Environment Secrets

GitHub リポジトリの `Settings` → `Environments` → `Authentication` に、次のEnvironment Secretsを登録する。

- `USER_ID`: Academic ExpressのログインID
- `PASSWORD`: Academic Expressのパスワード

workflowではSecretをコマンドライン引数にせず、テストプロセスの環境変数としてだけ渡す。テストコードは認証情報、Cookie、storage state、Playwright traceをファイルや標準出力へ保存しない。成果物は問題領域、クエスチョンタイプ、問題数、クエリ文字列を除いたページパスだけを含むJSONサマリーに限定し、保持期間を7日とする。

Environmentには可能であればRequired reviewersとmainブランチだけのdeployment branch ruleを設定する。これにより、workflowの実行が承認されるまでEnvironment Secretsはrunnerへ渡されない。

ローカルで実行する場合は、認証情報をシェル履歴へ直接書かず、現在のプロセスの環境変数に設定してから実行する。

```powershell
$env:ACADEMIC_EXPRESS_USER_ID = Read-Host "Academic Express user ID"
$env:ACADEMIC_EXPRESS_PASSWORD = Read-Host "Academic Express password" -MaskInput
npm run test:live
```

実行後は環境変数を削除する。

```powershell
Remove-Item Env:ACADEMIC_EXPRESS_USER_ID
Remove-Item Env:ACADEMIC_EXPRESS_PASSWORD
```

## E2E fixture 方針

- ログインなしで再現できる保存ページ fixture は `tests/fixtures/<fixture-name>/` に置く。
- E2E テストは Node.js の `http` サーバーをテストプロセス内で起動し、fixture を `127.0.0.1` の一時ポートで配信する。
- 実サイトに近いパスが必要な場合は、テスト用 HTTP サーバーで `/as/lplayer/index.cfm` や `/as/flash/data_manipulate.cfc` にマップする。
- 画像やフォントなど、解答ロジックに不要な静的アセットは fixture に含めなくてよい。テスト用サーバーはそれらを 204 として扱える。
- 音声アセットの読み込み失敗が画面進行を止める fixture では、テスト用サーバーが無音 WAV を返す。`materialSound.cfm` に加えて、Dictation の `sounds/typing/sprite.mp3` もこの扱いにする。
- 解答結果の検証は、画面の見た目だけではなく、保存 API に送られる `question_no`、`answer`、`correct_flag`、`totalscore` を優先する。
- Grammar Bank のように問題順がシャッフルされる E2E fixture は、保存順ではなく送信された `question_no` の集合と `correct_flag` を検証する。
- questionHub のように複数の問題セットを選択して実行する画面は、実サイトへの遷移ではなく、選択状態の保存・選択済み表示・保存順での保存 URL 直接遷移をローカル fixture で検証する。

## ドキュメント更新ルール

- 新しい fixture を追加し、既存の問題パターンと違う仕様が見つかった場合は `docs/unresolved-quiz-patterns.md` を更新する。
- CI の job、テスト配置、fixture 運用、重要な設計判断を変える場合は、このドキュメントを更新する。
- `AGENTS.md` には詳細を重複させず、このドキュメントへの参照を置く。
