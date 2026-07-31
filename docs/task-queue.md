# 作業指示と作業キュー

## 目的と現在の範囲

作業指示をMinecraft実行機能から分離し、安全な型付きcommandとして受付、永続化、選択、
停止できる基盤です。現在はキュー管理だけを実装しており、claimしても移動、採掘、設置、
攻撃、チャットその他のMinecraft操作は開始しません。外部から指示を投入するHTTP API、
Discord command、scheduleも未実装です。

## 指示形式

指示は`taskId`、`taskType`、`priority`、`maxAttempts`だけを持ちます。任意JSON payloadや自由文を
受け付けないため、接続先、player名、BOT情報、credentialを保存する経路を作りません。
identifierは64文字以内の小文字英数字と`.`、`_`、`-`、priorityは0～100、試行上限は1～10です。

## 状態とcommand

状態は`queued`、`claimed`、`completed`、`failed`、`stopped`、`cancelled`です。

- `task.enqueue`: task ID単位で冪等に受付
- `task.claim_next`: priority降順、同順位は作成時刻とtask ID順で1件を取得
- `task.cancel`: queued指示を取消
- `task.release`: claimed指示を再キュー。試行上限ならfailedへ終端化
- `task.finish`: claimed指示をcompleted、failed、stoppedのいずれかへ終端化

終端状態からqueuedへ戻す遷移はありません。再投入には新しいtask IDが必要です。claim回数は
永続化し、無制限の再実行を防ぎます。

## 永続化と排他

application serviceは`TaskQueueRepository`だけに依存します。MySQL adapterはmigration 002の
`task_queue`を使用し、`SELECT ... FOR UPDATE SKIP LOCKED`をtransaction内で実行して同じ指示の
多重claimを防ぎます。重複enqueueは既存内容を変更しません。

## 未実装

- 作業executorとMinecraft操作
- claimした作業と`StateStore`の作業状態を連携するorchestrator
- 外部指示入力、認可、指示schemaの個別parameter
- process crash後のclaimed作業を回収するlease
- operatorによるpause/resume UI
- schedule

次工程では共通安全制御を先に実装し、executorが他player検知、operator停止、体力・空腹度などの
停止判断を迂回できない境界を設計します。
