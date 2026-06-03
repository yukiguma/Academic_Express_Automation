# クイズパターン対応メモ

このドキュメントは、Academic Express の問題データと画面構造が既存パターンと違ったケース、および拡張機能側で入れた対応をまとめるものです。

## 共通の対応方針

- XML の `<answer>2</answer>` のような番号参照は、同じ `<question>` 内の `<choice no="2">...</choice>` に解決してからクリックする。
- 選択肢の表示順は `shuffleChoices="true"` で変わるため、番号や位置ではなく、解決済みの選択肢テキストでクリックする。
- 自動実行で「すでに解いた問題か」を判定するキーは、問題文だけではなく `displayOrder + questionNo + signature` を使う。
- 画面上に複数の問題コンポーネントが残る場合があるため、進捗表示と画面中の問題番号を使って、現在表示中の問題だけを対象にする。
- `shuffleQuestions="true"` の場合、画面の `1 / 23` は XML 上の1問目とは限らない。問題文がユニークなら画面テキスト照合を優先し、同じ問題文が重複していて音声・画像の素材 ID が取れる場合は現在読み込まれた素材 ID で絞り込む。
- `/student/` を含む選択画面では自動入力状態を必ず解除する。自動回答中の更新や中断後に選択画面へ戻った場合でも、次の教材を勝手に開始しないようにするため。

## 確認済みパターン一覧

| fixture | 大分類 | 確認済みの問題形式・挙動 | 自動テスト |
| --- | --- | --- | --- |
| `tests/fixtures/ListeningTest` | Listening | `listeningComprehension`、重複する `questionText`、番号参照の選択肢、単問進行 | parser / E2E |
| `tests/fixtures/ListeningTest2` | Listening | `listeningComprehension`、`trueFalse`、`multipleChoice`、`anaumeFilIn initialLetterShown="true"`、複数 blank の `ClozeTest` | parser / E2E |
| `tests/fixtures/ListeningTest3` | Listening | `shuffleQuestions="true"`、重複する `questionText`、音声・画像の素材 ID による現在問照合 | parser / E2E |
| `tests/fixtures/Dictation` / `Dictation2` / `Dictation3` | Listening | `typing` XML だが画面は Dictation 専用。input 要素なし、document の keyboard event で文字枠を開く。一部 prefix が最初から開いている場合や、`QuestionHeader` レイアウトの複数問進行あり | parser / E2E |
| `tests/fixtures/Scanning` | Reading | 開始画面つき `scanning`、本文中の該当英文クリック、複数問同時保存 | parser / E2E |
| `tests/fixtures/VocabraryMatching` | Reading | `matching`、本文中の複数 blank に候補語句を投入、複数 `<answer>` 保存 | parser / E2E |
| `tests/authoring2.xml` | Reading | `readingComprehension`、進捗範囲 `1 - 2 / 5`、1画面複数問 | parser |
| `tests/fixtures/ReadingTest` | Reading | `Insertion`、`readingComprehension`、`trueFalse`、`anaumeFilIn`、`multipleChoice` | parser / E2E |
| `tests/question_authoring.xml` | Grammar / mixed | `shuffleQuestions="true"`、XML 順と画面順の不一致、アポストロフィつき選択肢 | parser |
| `tests/fixtures/GrammarBank` | Grammar Bank | `sortingA`、slash 区切りの語句並べ替え、`multipleChoice` 混在、確定ボタン「完了」 | parser / E2E |
| `tests/fixtures/VocabularyBank` | Vocabulary Bank | `wd_type=5` 英→日、`save_progress_up`、自動次問遷移 | parser / E2E |
| `tests/fixtures/VocabrarySpelling` / `VocabrarySpelling2` / `VocabrarySpelling3` / `VocabrarySpelling4` | Vocabulary Bank | `wd_type=2` spelling / sentenceTyping、文字枠への keyboard event 入力、`save_progress_up` | parser / E2E |

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

## `tests/fixtures/ListeningTest2`

保存済みの Listening Test 画面と `authoring.cfc` payload を使う fixture。

特徴:

- `return_url` は `/student/listening/unit/675?cat=12002`。
- `save_answer_url` は `../flash/data_manipulate.cfc`。
- `combinationQuestion type="listeningComprehension"` の中に True/False、multiple choice、`initialLetterShown="true"` つきの `anaumeFilIn` が入る。
- payload 末尾に、10個の blank を持つ `ClozeTest` が単独の `<question>` として入る。
- `ClozeTest` は parser 上では `typing` として扱い、`questionText` 内の `[...]` を左から順に正答配列へ展開する。

fixture の期待正答:

| `question_no` | XML type | parser type | 正答 |
| --- | --- | --- | --- |
| `30308812` | `trueFalse` | `trueFalse` | `True` |
| `30308912` | `trueFalse` | `trueFalse` | `True` |
| `30309012` | `multipleChoice` | `multipleChoice` | `Japanese beer.` |
| `30309112` | `multipleChoice` | `multipleChoice` | `on business and vacation.` |
| `30309212` | `anaumeFilIn` | `typing` | `software` |
| `30028710` | `ClozeTest` | `typing` | `everything`, `How`, `about`, `Here`, `appreciate`, `work`, `recommend`, `fantastic`, `close`, `to` |

新しく確認したパターン:

- 複数 blank の `ClozeTest`。typing 系として扱い、10個の blank を入力して採点完走できることを E2E で確認済み。
- `initialLetterShown="true"` つき `anaumeFilIn`。正答の先頭文字が画面に表示される可能性があるが、parser は完全な正答文字列を保持する。

## `tests/fixtures/ListeningTest3`

保存済みの Listening Test 画面と `question_authoring.cfc` payload を使う fixture。

特徴:

- `<book shuffleQuestions="true">` のため、XML 上の順番と画面上の出題順が一致しない。
- 複数問の `questionText` が `Click your answer on the screen.` で同一。
- 同一問題文の設問は選択肢も `a` / `b` / `c` / `d` だけで、画面テキストと進捗番号だけでは現在問を一意にできない。
- 各 `<question>` の `<sound>` / `<image>` URL には一意な `id` があり、プレイヤーは現在問の音声素材を resource として読み込む。

実装上の対応:

- parser は multiple choice / trueFalse などの選択式 XML の `<sound>` / `<image>` から `mediaSignatures` を保持する。
- parser は book の `shuffleQuestions="true"` を各 question に保持する。
- content 側は DOM 上の media URL と `performance.getEntriesByType("resource")` の直近 `materialSound.cfm` / `materialImage.cfm` から素材 ID を読み、`mediaSignatures` と一致した question を現在問として優先する。
- 素材 ID で現在問が決まった場合は、重複する問題文に対する進捗番号 fallback を使わず、その1問だけを解く。

fixture の期待正答:

| `question_no` | 正答保存値 |
| --- | --- |
| `1489` | `4` |
| `14948` | `1` |
| `1594` | `2` |
| `14866` | `4` |
| `15006` | `1` |
| `14768` | `2` |
| `1596` | `3` |
| `1494` | `4` |
| `1597` | `2` |
| `1591` | `4` |

## `tests/fixtures/Dictation` / `tests/fixtures/Dictation2` / `tests/fixtures/Dictation3`

保存済みのディクタン画面と `authoring.cfc` payload を使う fixture。

特徴:

- XML type は `typing` だが、`questionText` 全体が `[We can stay home and study by computer.]` のように正答で、画面側には通常の input / textarea / 採点ボタンがない。
- `Dictation2` では `Gene [began studying for his English test early this morning.]` のように、bracket の外側が最初から開いている prefix になる。自動入力するのは bracket 内の未入力部分だけ。
- `Dictation3` は `QuestionHeader__innerContainer` / `QuestionArea__dictationArea` を使う新しい画面構造で、`AppPc__common_inner` がない。拡張の自動入力ボタンは `QuestionHeader` にも差し込む。
- `Dictation3` は `window.config.question_no` がなく、画面の `1/10` 進捗表示から現在問を選ぶ。
- `Dictation3` の開始モーダルは拡張の `global-lock` の下に出るため、solver は lock を一時解除して「スタート」を押してから入力する。
- `Dictation3` は完答後にプレイヤー側が自動で次問へ進むため、拡張側では手動遷移を押さず、進捗変化を待って次の自動入力へ再開する。二重遷移すると偶数問が飛ばされる。
- 画面は `DictationBox` / `FontBox` の文字枠で構成され、document レベルの keyboard event を受けて1文字ずつ開く。
- 初期表示には「スタート」オーバーレイがあり、開始後にキー入力を受け付ける。
- `AppHeader__fixed-top` がなく、拡張の自動入力ボタンは `AppPc__common_inner` や `QuestionHeader__innerContainer` などの Dictation 用ヘッダーへ差し込む。
- プレイヤーは完答時に `write_answer_au` を自動送信し、`answer` 本文は空、`miss_cnt=0`、`correct_flag=5` で保存される。
- 効果音 `sounds/typing/sprite.mp3` の読み込みに失敗すると画面が終了 URL へ戻るため、E2E harness では mp3 も無音 WAV で返す。

実装上の対応:

- parser は `<sound>` と `<jpscript>` を持ち、`questionText` 全体が bracket で囲まれた `typing` を `dictation` として扱う。
- prefix つきの場合も同じく `dictation` として扱い、bracket 内だけを `answers` に保持する。
- solver は input 要素探索ではなく、正答文字列を document へ `keydown` / `keypress` / `keyup` として送る。
- keyboard event は `keydown` / `keyup` では物理キーの `keyCode` / `which`、`keypress` では文字コードを送る。プレイヤー側が `key` ではなく `keyCode` を見る場合、文字コードを物理キーとして送るとミスタイプ扱いになり、自動的に次問へ進む。
- Dictation プレイヤーはスペース、数字、アポストロフィ、ピリオドなどの区切りを直前の文字入力で自動補完するため、solver は英字だけを送る。入力対象外の区切りを追加送信するとミスカウントが増え、上限到達による自動遷移の原因になり得る。
- Dictation 入力前には、進捗表示だけでなく Dictation DOM が現在問として入力可能な状態であることを待つ。全文表示型は入力対象文字列の表示、prefix/空欄型は表示済み prefix と hidden box の残存で判定し、未準備なら入力せずに同じ問題を再試行する。進捗だけ先に変わった遷移中状態へキー入力すると、前問または未準備の listener に拾われてミス扱いになる。
- Dictation は key event を送っただけでは成功扱いにしない。1文字ごとに Dictation DOM の表示文字または hidden box 数が変化したことを確認し、変化しなければ入力を中断して同じ問題を再試行する。
- 複数問 Dictation はレイアウト検出に頼らず自動遷移扱いにする。入力中や入力直後の DOM 変化で `dictationArea` 検出が外れても、拡張側の手動 `次へ` / `採点` 遷移が割り込まないようにする。
- 「スタート」ボタンは画面最前面で押せる状態のときだけ solver が押す。保存 HTML の E2E では開始オーバーレイが残るため、テスト側で開始後に拡張を注入する。
- 画面テキストでは問題を照合できないため、`window.config.question_no` と `questionNo` の一致で active question を特定する。
- 完答後の遷移では「採点」「続ける」「判定」を優先し、それらがなければ Dictation の「終了」ボタンを押す。

fixture の期待正答:

| `question_no` | parser type | 正答 |
| --- | --- | --- |
| `20303814` | `dictation` | `We can stay home and study by computer.` |
| `20274614` | `dictation` | `began studying for his English test early this morning.` |
| `20280414` | `dictation` | `I have to go to the bank before lunch.` |
| `203016143` | `dictation` | `Don't be lazy. You have to study English harder.` |
| `20275814` | `dictation` | `It was snowing when I arrived at the library.` |
| `20302814` | `dictation` | `My uncle liked singing so he became a singer.` |
| `20296914` | `dictation` | `You have to take off your shoes here.` |
| `20288014` | `dictation` | `My brother and I were playing catch this morning.` |
| `20296514` | `dictation` | `Look at those white clouds in the blue sky.` |
| `203143143` | `dictation` | `You look very sick. What's the matter with you?` |
| `20299014` | `dictation` | `I believe her because she never tells a lie.` |

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

## `tests/fixtures/GrammarBank`

保存済みの Grammar Bank 画面と `question_authoring.cfc` payload を使う fixture。

特徴:

- `question_authoring.cfc` には `sortingA` が15問、`multipleChoice` が8問含まれる。
- `sortingA` の正答は `<questionText>` 内の `[That's/all/for/today]` のような slash 区切りで表現される。
- slash 区切りの各要素は1語とは限らず、`to apply`、`lot first`、`your mother`、`the top` のような空白を含む語句もある。
- `shuffleQuestions="true"` のため、画面の `1 / 23` は XML 上の1問目とは限らない。
- Grammar Bank の確定ボタンは「完了」で、保存 API は `/as/flash/data_manipulate.cfc` の `save_answer_s` を使う。

実装上の対応:

- `sortingA` は parser 上では `sorting` として扱い、bracket 内の slash 区切りを左から順に `answers` 配列へ展開する。
- Sorting solver は問題文中の `to` などを誤クリックしないよう、`sortStringList` 配下の `li` を中心に表示テキストの完全一致でクリックする。
- `sortStringList` の候補テキストが正答トークン集合と一致しない場合でも、正答トークンがクリック可能になっていれば、表示中の `SortingAQuestionBuilder__questionBox` と進捗番号から現在問を fallback 判定する。描画途中の placeholder では解答を開始しない。
- 単問表示の Grammar Bank では `multipleChoice` 選択直後に次問へ進むことがあるため、進捗が変わったら同じ solver 実行内の残り候補は解かず、次の検出サイクルに渡す。
- fast mode でも `CLICK_WAIT` を解答直前に適用し、solver 内の明示的な待機は短縮しない。単問自動遷移で操作が速くなりすぎると、画面更新前に次の解答へ進むことがある。
- `multipleChoice` 選択後の DOM mutation が予定より早く `ensureSolveButton` を呼ぶことがあるため、自動進行後の再開時刻を gate し、MutationObserver 経由でも最低待機を守る。
- 単問進捗で複数候補が見つかる場合や sorting list を探す場合は、画面外に残った古い問題 DOM を誤答しないよう、viewport 内で一意に決まる候補だけを解く。曖昧な場合は解答しない。
- 解答後に `1 / N` の進捗が消えても「採点」「判定」「完了」などの手動遷移ボタンが表示されている場合は、自動遷移済みとは扱わず `handleTransition()` でクリックする。
- 自動遷移の候補に「完了」を含め、Grammar Bank の単問確定を進める。

fixture から確認した例:

| `question_no` | parser type | 正答トークン |
| --- | --- | --- |
| `20014237` | `sorting` | `That's`, `all`, `for`, `today` |
| `20014317` | `sorting` | `In`, `order`, `to apply`, `to`, `the`, `college` |
| `20013487` | `sorting` | `drive`, `to`, `a`, `parking`, `lot first` |
| `20014486` | `multipleChoice` | `singing` |
| `20013456` | `multipleChoice` | `with` |

## `tests/tango_data_manipulate.htm`

単語テストの `tango_data_manipulate.cfc?method=get_question...` から取得される JSON payload。

特徴:

- XML の `<answer>` や `correctAnswer` のような正解専用フィールドはない。
- `questions[]` の各要素に `keyword.ja` と `keyword.en` があり、この組み合わせが問題文と正答になる。
- `tangolists_jan` と `tangolists_eng` は選択肢リストで、出題方向によってどちらをクリックするかが変わる。
- 保存された `player-tango.js` 上では、`wd_type=1` は日→英、`wd_type=5` は英→日、`wd_type=7` は日→英/英→日を問題ごとにランダム選択する。
- `shuffleQuestions=true` のため、XML 上の順番ではなく画面テキストで照合する必要がある。
- `know_chk` は正答ではなく、既知/学習状態を表すフラグとして扱う。

`wd_type` の対応:

| `wd_type` | プレイヤー上の生成処理 | 問題形式 | 画面に出る主な問題文 | 正答 |
| --- | --- | --- | --- | --- |
| `1` | `f` | multipleChoice | `keyword.ja` | `keyword.en` |
| `2` | `h` | typing / sentenceTyping | `keyword.ja`、または `sentence.en` の穴埋め | `keyword.en`、または穴埋め後の英文 |
| `5` | `c` | multipleChoice | `keyword.en` | `keyword.ja` |
| `7` | `d` | multipleChoice | `keyword.ja` または `keyword.en` を問題ごとにランダム選択 | 表示方向と逆側の `keyword` |

補足:

- 保存された `player-tango.js` の `switch(o)` では `1`, `2`, `5`, `7` だけが扱われ、それ以外は `wd_type指定誤りです。` のエラーになる。
- `wd_type=7` は `Math.random() < .5` で `f` または `c` を選ぶため、URL やレスポンスの `wd_type` だけでは日→英/英→日のどちらが出るか確定できない。
- `contents_type_no` はモード判定に使われ、`21` は `drill`、`19`/`22`/`28` は `test`、`1` は `shiwake` として扱われる。これは出題方向ではない。

実装上の対応:

- 汎用 JSON パーサより先に `tango_data_manipulate` 形式を判定する。
- 日→英では `keyword.ja` を画面照合用の `rawText`、`keyword.en` を `answers` として保存する。
- 英→日では `keyword.en` を画面照合用の `rawText`、`keyword.ja` を `answers` として保存する。
- `wd_type=2` は multipleChoice として扱わず、`keyword.en` を入力する `typing` として保存する。`sentence.en` / `sentence.ja` がある場合は `sentenceTyping` として、穴埋め記号を外した英文を正答にする。
- `wd_type=7` または方向が取れない場合は、両方向の候補を保存し、実際に画面へ表示されている語句との照合で対象を決める。
- 単語テストは選択後にページ側が自動で次問へ進むため、`isAutoAdvance=true` として扱う。

fixture から確認した例:

- `はがき` の正答は `postcard`。
- `（手紙の冒頭で）親愛なる、いとしい、かわいい` の正答は `dear`。
- `可能にする` の正答は `enable`。

## `tests/fixtures/VocabularyBank`

保存済みの Vocabulary Bank 画面と `tango_data_manipulate.cfc` payload を使う E2E fixture。

特徴:

- `wd_type=5` の英→日 multiple choice。
- `get_xml_url` と `save_answer_url` はどちらも `./tango_data_manipulate.cfc`。
- 選択後はプレイヤー側が自動で次問へ進むため、拡張側は manual transition click を行わない。
- 問題順は `shuffleQuestions=true` で画面側が入れ替えるため、保存 API の送信順ではなく `word_no` と `answer` で検証する。
- 保存 API は `save_progress_up` を使い、送信 body の JSON `data` に `word_no`、`answer`、`ok_flag`、`save_type` が入る。

fixture の期待正答:

| `word_no` | 問題文 | 正答 |
| --- | --- | --- |
| `551` | `broad` | `（幅が）広い` |
| `6371` | `aware` | `気付いて、意識して、わかって` |
| `118079` | `recorder` | `録音機器、録画機器` |
| `105462` | `since` | `～して以来` |
| `9343` | `butterfly` | `蝶` |
| `7435` | `rely` | `頼る、あてにする（on ～で）` |
| `80` | `reply` | `返事、返答` |
| `601` | `colorful` | `カラフルな、変化に富んだ、面白い` |
| `4493` | `weight` | `重さ、重量、体重` |
| `4062` | `latest` | `最近の、最新の` |

E2E での確認:

- 10問分の `save_progress_up` が送信されること。
- 各 `word_no` に対して期待正答の `answer` が送信されること。
- 各保存 payload の `ok_flag` が `1` であること。
- 最終保存 payload の `save_type` が `1` であること。

## `tests/fixtures/VocabrarySpelling` / `tests/fixtures/VocabrarySpelling2` / `tests/fixtures/VocabrarySpelling3` / `tests/fixtures/VocabrarySpelling4`

保存済みの Vocabulary Bank spelling 画面と `tango_data_manipulate.cfc` payload を使う fixture。ディレクトリ名は追加時の `VocabrarySpelling` 表記をそのまま使っている。

特徴:

- `wd_type=2` の typing / sentenceTyping。
- `tangolists_jan` と `tangolists_eng` は配列ではなく空文字になるため、tango payload 判定は `keyword.ja` / `keyword.en` を基準にする。
- 通常の input / textarea はなく、`FontBox` 文字枠が document-level の keyboard event を受けて進む。
- 単語 spelling では先頭など一部文字がヒント表示済みになることがあり、未入力の文字枠だけを送る。
- `sentenceTyping` では画面上の英文から bracket 内の単語だけが空欄になり、保存 payload 上の正答は全文になる。solver は parser が保持した bracket 付き `rawText` から空欄語を取り出して入力する。
- `VocabrarySpelling3` では `[Both] [of]` のように複数 bracket が連続し、空欄入力にスペースが必要になる。solver は bracket 群をスペースで結合して `Both of` のように入力する。
- spelling では `[post office]` のように1つの bracket 内にスペースを含む正答がある。画面側の `FontBox` ではスペース枠の DOM ラベルが空になる場合があるため、solver は `answers[0]` の正答文字列からスペースを復元して keyboard event を送る。
- 画面 DOM に空欄語の hidden label が含まれない場合があるため、`sentenceTyping` の照合では bracket 内を除いた文の骨格も使う。例: `David was badly [injured] in the accident.` は `David was badly in the accident.` とも一致させる。
- `VocabrarySpelling4` のように `sentenceTyping` の画面テキストが日本語例文だけになる場合がある。parser は解答抽出用の bracket 付き英文 `rawText` を保持しつつ、content 側の現在問照合用に日本語例文の `matchSignatures` も保持する。
- 実環境ではキー入力が速すぎると React 側の文字枠更新が追いつかず誤答になることがあるため、solver は1文字ごとに `FontBox` の状態変化を待ってから次の文字を送る。反映後の固定待機は短くし、状態変化の検知を主な同期条件にする。
- 保存 API は `save_progress_up` を使う。typing 系では送信 body の JSON `data.answer` は空文字で、`ok_flag=1` と `word_no` で完走を検証する。
- 最終問題後は `isAutoAdvance` のまま解答一覧画面へ遷移するため、auto mode 中に `続ける` ボタンが表示されたら1回だけクリックして次の画面へ進める。
- `続ける` 直後は次の XHR 反映前に古い問題データが残ることがあるため、自動進行の語彙問題では問題番号だけの fallback 解答を使わない。
- 自動進行の語彙問題はプレイヤー側が保存後に進むため、解答後の固定待機は短くし、画面変化と XHR 反映を待つ。
- `1/5` のような単問画面では、ゼロサイズで残った古い問題 DOM を可視扱いせず、現在画面に表示されている問題だけを照合対象にする。
- 画面の総数表示が `1/5` でも XHR payload が3問だけ返ることがあるため、自動進行では総数不一致でも進捗番号を使い、現在の `displayOrder` だけを解く。
- XHR payload が5問全部でも DOM 上に複数問のテキストが残ることがあるため、自動進行の単問表示では複数候補を現在の進捗番号1問へ最後に絞る。
- `shuffleQuestions=true` の spelling では payload 順の `displayOrder` と画面の `3/5` が一致しない。出題中の `Tango...QuestionBuilder__questionBox` を現在番号で特定し、その箱の中だけを照合する。
- `get_question` の XHR は5問全体ではなく現在問だけの `question` オブジェクトを返す場合がある。最新 XHR をパースできないと storage に古い回答データが残るため、`questions` 配列だけでなく現在問単体の payload も `wd_type=2` として取り込む。
- 現在問だけの payload では parser 側の `displayOrder` が常に `1` になるため、画面表示が `2/5` 以降でも進捗番号だけでは弾かない。単問 payload は表示文面との照合を優先する。
- XHR 取得後は background 側の storage 更新完了を待ってから content 側に success を返す。これにより、次の自動解答が古い `questionData` を読み直す競合を避ける。

fixture の期待正答:

| `word_no` | parser type | 問題文 | 正答 |
| --- | --- | --- | --- |
| `3526` | `typing` | `特別な、特殊な` | `special` |
| `3405` | `sentenceTyping` | `I want to play freely in a [field].` | `I want to play freely in a field.` |
| `9696` | `sentenceTyping` | `Organic [oil] is expensive.` | `Organic oil is expensive.` |
| `100012` | `typing` | `両方の` | `both` |
| `100088` | `sentenceTyping` | `This [study] is about the human brain.` | `This study is about the human brain.` |

`VocabrarySpelling4` の期待正答:

| `word_no` | parser type | 問題文 | 正答 |
| --- | --- | --- | --- |
| `9948` | `sentenceTyping` | `The suit is a classic [type].` | `The suit is a classic type.` |
| `9787` | `sentenceTyping` | `The sales department [reported] that sales were far below expectations.` | `The sales department reported that sales were far below expectations.` |
| `100118` | `sentenceTyping` | `His job is the [import] and export of things.` | `His job is the import and export of things.` |
| `295` | `sentenceTyping` | `You should e-mail the [document].` | `You should e-mail the document.` |
| `20` | `typing` | `実在の、現実の、実際の` | `actual` |
| `904` | `sentenceTyping` | `He has the [ability] to motivate people.` | `He has the ability to motivate people.` |
| `392` | `sentenceTyping` | `The [branches] of the bank are less known.` | `The branches of the bank are less known.` |
| `912` | `sentenceTyping` | `I want you to [accept] my offer.` | `I want you to accept my offer.` |
| `968` | `sentenceTyping` | `My father [allowed] me to use his car.` | `My father allowed me to use his car.` |
| `1053` | `sentenceTyping` | `The new sofa was half off, so I consider the purchase a [bargain].` | `The new sofa was half off, so I consider the purchase a bargain.` |

## `tests/fixtures/ReadingTest`

保存済みの Reading Test 画面と `authoring.cfc` payload を使う E2E fixture。

特徴:

- `return_url` は `/student/reading/unit/884?cat=11001`。
- `save_answer_url` は `../flash/data_manipulate.cfc` で、テスト用 HTTP サーバーでは `/as/flash/data_manipulate.cfc` として受ける。
- 最初に Insertion 問題が1問あり、その後に `readingComprehension` 内の True/False、穴埋め入力、multiple choice が続く。
- Insertion の `<questionText>` 内に正答文が `[...]` で埋め込まれており、parser はこの bracket 部分を5つの正答として扱う。
- multiple choice は `shuffleChoices="true"` のため、保存 API の `answer` は選択肢番号だが、画面操作は正答テキストで行う。

fixture の期待正答:

| `question_no` | 問題形式 | 正答 |
| --- | --- | --- |
| `6613` | `Insertion` | `0` |
| `30165411` | `trueFalse` | `True` |
| `30165511` | `trueFalse` | `False` |
| `30257711` | `anaumeFilIn` | `refused` |
| `30165711` | `multipleChoice` | `Michelangelo's nose` |
| `30257911` | `multipleChoice` | `lead` |

E2E での確認:

- 6問分の保存 POST が送信されること。
- 各 `question_no` に対して期待どおりの保存 `answer` が送信されること。Insertion は5つの正答文を画面上で選んだ結果、プレイヤーの保存値として `0` が送信される。
- 各保存 payload の `correct_flag` が `1` であること。
- 最終保存 payload の `totalscore` が `100`、`save_type` が `1` であること。

## `tests/fixtures/Scanning`

保存済みの Reading Bank / Scanning 画面と `authoring.cfc` payload を使う E2E fixture。

特徴:

- `return_url` は `/student/reading/unit/886?cat=11001`。
- 通常の player 画面の前に開始画面があり、「スタート」を押してから `AppHeader` と問題画面が表示される。
- `combinationQuestion type="scanning"` の中に3問が入り、各問は本文中の該当英文をクリックする。
- 保存 API は各 `question_no` について選択した英文を `<answer>` に入れて送る。

fixture の期待正答:

| `question_no` | 正答 |
| --- | --- |
| `5914` | `In 1847 he was elected for two years to the House of Representatives.` |
| `5916` | `Lincoln thought slavery was evil and joined the Republican Party, which opposed it.` |
| `5918` | `Lincoln was re-elected president in 1864 and the Confederates surrendered shortly afterwards.` |

E2E での確認:

- 開始画面の「スタート」を押した後に自動入力を実行できること。
- 3問分の保存 POST が送信されること。
- 各保存 payload の `correct_flag` が `1`、`totalscore` が `100`、`save_type` が `1` であること。

## `tests/fixtures/VocabraryMatching`

保存済みの vocabulary matching 画面と `authoring.cfc` payload を使う E2E fixture。ディレクトリ名は追加時の `VocabraryMatching` をそのまま使っている。

特徴:

- `return_url` は `/student/reading/unit/970?cat=11001`。
- XML type は `matching`。
- 本文中の8つの blank に、候補語句 `nature`、`tended to`、`trend`、`ended up with`、`get lost`、`numerous`、`except`、`relatively` を順番に入れる。
- 保存 API では1つの `question_no` に対して複数の `<answer>` が送られる。

E2E での確認:

- `question_no=16269` の保存 POST が送信されること。
- 保存 payload の `<answer>` が `0` から `7` までの8件になること。
- 保存 payload の `correct_flag` が `1`、`totalscore` が `100`、`save_type` が `1` であること。
