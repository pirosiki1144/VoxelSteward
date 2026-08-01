# 作業指示と作業キュー

## 目的と現在の範囲

作業指示をMinecraft実行機能から分離し、安全な型付きcommandとして受付、永続化、選択、
停止できる基盤です。現在はキュー管理だけを実装しており、claimしても移動、採掘、設置、
攻撃、チャットその他のMinecraft操作は開始しません。外部から指示を投入するHTTP API、
Discord command、scheduleも未実装です。

## 指示形式

共通envelopeは`taskId`、`taskType`、`priority`、`maxAttempts`を持ちます。単一dirt配置だけは
version 1の厳格な`details`として、完全な`PlaceSingleBlockInstruction`を保存します。任意JSON
payloadや自由文は受け付けず、未知version、余分なfield、ID・type不一致を復元時にも拒否します。
接続先、player名、BOT情報、credential、NBTを保存するfieldはありません。
identifierは64文字以内の小文字英数字と`.`、`_`、`-`、priorityは0～100、試行上限は1～10です。

## 状態とcommand

状態は`queued`、`claimed`、`completed`、`failed`、`stopped`、`cancelled`です。

- `task.enqueue`: task ID単位で冪等に受付
- `task.claim_next`: priority降順、同順位は作成時刻とtask ID順で1件を取得
- `task.cancel`: queued指示を取消
- `task.release`: claimed指示を再キュー。試行上限ならfailedへ終端化
- `task.mark_delivery_started`: 世界変更要求の直前に結果不明境界を永続化
- `task.mark_verified`: server事後観測を確認済みとして永続化
- `task.finish`: claimed指示をcompleted、failed、stoppedのいずれかへ終端化

終端状態からqueuedへ戻す遷移はありません。再投入には新しいtask IDが必要です。claim回数は
永続化し、無制限の再実行を防ぎます。

## 永続化と排他

application serviceは`TaskQueueRepository`だけに依存します。MySQL adapterはmigration 002の
`task_queue`を使用し、migration 003でversion付き指示と`not_started`、`delivery_started`、
`verified`の実行phaseを追加します。`SELECT ... FOR UPDATE SKIP LOCKED`をtransaction内で実行して
同じ指示の多重claimを防ぎます。同じIDの型付き指示は内容が一致する場合だけ冪等で、相違時は拒否します。

再起動後に`claimed`で残る指示は送信済みか判別できないため`manual_review`対象として扱い、queuedへ
戻したり自動再送したりしません。単一dirt配置は`maxAttempts=1`に固定します。

## 未実装

- 作業executorとMinecraft操作
- claimした作業と`StateStore`の作業状態を連携するorchestrator
- 外部指示入力と認可
- process crash後のclaimed作業を安全に照合するoperator workflow
- operatorによるpause/resume UI
- schedule

共通安全制御の最小境界は実装済みです。将来executorは`SafetyControlledTaskQueue`だけから
claimし、他player検知、operator停止、接続・spawn、体力・空腹度の判定を迂回しない設計です。
詳細は[共通の安全制御](safety-controls.md)を参照してください。executorとMinecraft操作は
引き続き未実装です。
