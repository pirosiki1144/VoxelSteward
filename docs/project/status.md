# プロジェクト状況

## 基準

- 基準コミット: `deae5a6cfb5606885300ae65e46ea548c6a90b0c`
- 完成マイルストーン: MySQLへの状態・履歴保存の最小実装
- 現在の工程: 作業指示と作業キューの設計準備

## 完成済み

- Bedrockサーバーへの読み取り専用接続
- BOT識別子単位の`InstanceLock`
- 接続タイムアウトと上限付き指数バックオフ再接続
- SIGINT、SIGTERMによる正常終了
- 接続後の他プレイヤー参加時の安全切断
- スポーン前に受信した初期プレイヤー一覧のスポーン時検査
- 他プレイヤー安全停止後の再接続禁止
- runtimeとsmokeの競合防止
- Fake接続による自動テスト
- runtimeとsmokeのDockerイメージ
- 実サーバー試験A～C
- コマンド駆動の状態・進捗ストア
- freeze済みスナップショットと非同期状態変更購読
- runtimeの接続、spawn、telemetry、安全停止、再接続、エラー状態連携
- 外部サービス非依存の通知message、mapper、port、順序付きsubscriber
- No-op通知portとテスト専用Fake通知port
- revisionと有界notificationId履歴によるプロセス内重複防止
- 通知失敗のruntime・安全切断からの隔離
- 通知無効時のNo-opと有効時のIncoming Webhook切り替え
- 厳格なWebhook設定検証と秘密値を含めない配送エラー
- 5秒／最大3試行／総15秒の上限付き配送、429・限定5xx・通信失敗の再試行
- runtime終了時の進行中HTTP・待機中断
- 専用DiscordチャンネルとMinecraftテストサーバーによるWebhook受入試験1～3
- MySQL Repository portと状態イベント起点の直列永続化subscriber
- run ID・revisionによるsnapshot、履歴、作業checkpoint、通知outboxの冪等保存
- version管理されたMySQL migrationとtransaction rollback
- 隔離されたtmpfs MySQL 8.4によるmigration・Repository統合試験5件

実サーバー試験の詳細は
[通常運転ランタイム検証](../verification/runtime-readonly.md)を参照してください。
Discord実送信の計画は
[Discord Incoming Webhook受入計画](../verification/discord-webhook-plan.md)を参照してください。
非秘密な試験結果は
[Discord Incoming Webhook受入結果](../verification/discord-webhook.md)を参照してください。
MySQLの非秘密なローカル検証結果は
[MySQL状態・履歴保存のローカル検証](../verification/mysql-persistence.md)を参照してください。

## 現在の制約

- Minecraft内の操作機能はない
- 作業キューとスケジュール制御はない
- MySQL無効時は状態イベントを永続化しない
- Discord通知は設定時だけ有効で、再起動後の重複防止や永続配送はない
- 通知outbox dispatcherと配送済み状態の更新はなく、Discordはoutboxをまだconsumeしない
- runtime用のreadinessエンドポイントはない

## 次の完了条件

作業指示と作業キューについて、domain command、優先順位、停止・再開、Repository境界、
受入条件を設計します。外部・共有DBへの接続やmigration適用は承認が必要です。

## 未決定事項

- 停止直前通知をbest effortのまま扱う期間と、将来outboxで永続保証を開始する時点
- Webhook URLの本番secret管理方式
- 作業IDの生成責務と外部指示の形式
- JST表示をアプリケーション、通知アダプター、UIのどこで担当するか
