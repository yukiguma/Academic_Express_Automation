# クイズパターン対応メモ

このドキュメントは、Academic Express の問題データと画面構造が既存パターンと違ったケース、および拡張機能側で入れた対応をまとめるものです。

## 共通の対応方針

- XML の `<answer>2</answer>` のような番号参照は、同じ `<question>` 内の `<choice no="2">...</choice>` に解決してからクリックする。
- 選択肢の表示順は `shuffleChoices="true"` で変わるため、番号や位置ではなく、解決済みの選択肢テキストでクリックする。
- 自動実行で「すでに解いた問題か」を判定するキーは、問題文だけではなく `displayOrder + questionNo + signature` を使う。
- 画面上に複数の問題コンポーネントが残る場合があるため、進捗表示と画面中の問題番号を使って、現在表示中の問題だけを対象にする。
- `shuffleQuestions="true"` の場合、画面の `1 / 23` は XML 上の1問目とは限らない。問題文がユニークなら画面テキスト照合を優先し、同じ問題文が重複している場合だけ進捗番号で絞り込む。
- `/student/` を含む選択画面では自動入力状態を必ず解除する。自動回答中の更新や中断後に選択画面へ戻った場合でも、次の教材を勝手に開始しないようにするため。

## `tests/authoring.xml`

`combinationQuestion type="listeningComprehension"` の中に `<question>` が入るリスニング系の payload。

特徴:

- 前半6問の `questionText` がすべて `Click your answer on the screen.` で同一。
- 実際のリスニング本文や画像は `<question>` の外側にある `<en_script>`、`<jp_script>`、`<sound>`、`<image>` に入っている。
- 正答は `<answer>2</answer>` のような番号で渡される。
- 画面には `6:` や `6 / 9` のような番号が出る。
- 同じ問題文のコンポーネントが画面内に複数残ることがある。

実装上の対応:

- XML パース時に `displayOrder` と `questionNo` を保存する。
- 同じ `signature` の問題が複数ある場合は、画面の進捗番号と `displayOrder` を使って対象問題を特定する。
- 1問ずつ進む画面では `2 / 9` を `2-2` の範囲として扱い、その1問だけを解く。

fixture の期待正答:

1. `b.`
2. `d.`
3. `d.`
4. `b.`
5. `a.`
6. `b.`
7. `Location`
8. `By special phone.`
9. `Sunny.`

## `tests/authoring2.xml`

`combinationQuestion type="readingComprehension"` の中に複数の `<question>` が入り、1画面に複数問が同時表示される読解系の payload。

特徴:

- 進捗表示が `1 - 2 / 5` や `3 - 5 / 5` のような範囲になる。
- 範囲内の問題は同じ画面に表示されており、遷移や採点の前にまとめて解く必要がある。
- 画像や共通プロンプトは親の `combinationQuestion` 側にあり、各 `<question>` には個別の問題文がある。
- 画面中の `1:`、`2:` などが、表示範囲内の個別問題を識別する。

実装上の対応:

- 進捗表示を単一番号ではなく範囲として読む。
- `1 - 2 / 5` は1問目から2問目、`3 - 5 / 5` は3問目から5問目を active として扱う。
- 範囲外の問題は解答対象から外す。

fixture の期待正答:

1. `Venezuela`
2. `Thousands of barrels each day`
3. `Basketball`
4. `Three seconds`
5. `The regional championship`

## `tests/question_authoring.xml`

単語集・文法問題系の `question_authoring.cfc?method=sortingXml...` から取得される payload。

特徴:

- endpoint 名に `sortingXml` が含まれていても、画面上の操作は multiple choice の場合がある。
- `shuffleQuestions="true"` なので、XML 上の順番と画面上の出題順が一致しない。
- 画面には `1 / 23` のように現在番号が表示されるが、これは XML 上の `displayOrder` ではなく、シャッフル後の表示順。
- 画面の日本語ヘッダーは汎用文言で、取得データ内の問題文とは一致しない場合がある。

実装上の対応:

- `method=sortingXml` のような endpoint 名だけで solver type を決めない。
- XML の `<questionText>` と画面テキストが一致する場合は、テキスト照合を優先する。
- 問題文がユニークな場合は進捗番号で絞り込まない。これにより、シャッフル後に XML の8問目が画面の1問目として出ても検出できる。
- 表示テキストと取得データが一致しない場合の保険として、進捗番号・出題順ベースの fallback を残す。ただし、テキスト照合で1問以上見つかった場合は fallback を追加実行しない。

fixture から確認した例:

- `I was very late because I took the ------- bus.` は XML 上では8問目だが、画面では `1 / 23` として出ることがある。
- この問題の正答は `wrong`。
- 所有格・複数所有格のようにアポストロフィ位置だけが違う選択肢がある。`girl's` と `girls'` は記号を落とすとどちらも `girls` になるため、exact 判定ではアポストロフィを保持して比較する。

## `tests/tango_data_manipulate.htm`

単語テストの `tango_data_manipulate.cfc?method=get_question...` から取得される JSON payload。

特徴:

- XML の `<answer>` や `correctAnswer` のような正解専用フィールドはない。
- `questions[]` の各要素に `keyword.ja` と `keyword.en` があり、この組み合わせが問題文と正答になる。
- `tangolists_jan` と `tangolists_eng` は選択肢リストで、出題方向によってどちらをクリックするかが変わる。
- 保存された `player-tango.js` 上では、`wd_type=1` は日→英、`wd_type=5` は英→日、`wd_type=7` は日→英/英→日を問題ごとにランダム選択する。
- `shuffleQuestions=true` のため、XML 上の順番ではなく画面テキストで照合する必要がある。
- `know_chk` は正答ではなく、既知/学習状態を表すフラグとして扱う。

実装上の対応:

- 汎用 JSON パーサより先に `tango_data_manipulate` 形式を判定する。
- 日→英では `keyword.ja` を画面照合用の `rawText`、`keyword.en` を `answers` として保存する。
- 英→日では `keyword.en` を画面照合用の `rawText`、`keyword.ja` を `answers` として保存する。
- `wd_type=7` または方向が取れない場合は、両方向の候補を保存し、実際に画面へ表示されている語句との照合で対象を決める。
- 単語テストは選択後にページ側が自動で次問へ進むため、`isAutoAdvance=true` として扱う。

fixture から確認した例:

- `はがき` の正答は `postcard`。
- `（手紙の冒頭で）親愛なる、いとしい、かわいい` の正答は `dear`。
- `可能にする` の正答は `enable`。
