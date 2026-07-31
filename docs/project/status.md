# プロジェクト状況

## 基準

- 基準コミット: `15314c54ef854504496526877ddb2e14da7fe042`
- 完成マイルストーン: Discord Incoming Webhookアダプターのローカル実装
- 現在の工程: 実Discord送信の受入準備（外部接続は未承認・未実施）

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

実サーバー試験の詳細は
[通常運転ランタイム検証](../verification/runtime-readonly.md)を参照してください。
Discord実送信の計画は
[Discord Incoming Webhook受入計画](../verification/discord-webhook-plan.md)を参照してください。

## 現在の制約

- Minecraft内の操作機能はない
- Discord実送信試験、MySQL、作業キュー、スケジュール制御はない
- 状態イベントはプロセス内だけで、再起動後の永続化や配送再試行はない
- Discord通知は設定時だけ有効で、再起動後の重複防止や永続配送はない
- runtime用のreadinessエンドポイントはない

## 次の完了条件

別途承認された専用Discordチャンネルと専用Minecraftテストサーバーで、秘密値を記録せず
Webhook配送、mention抑止、通知障害時の安全停止非依存を確認します。実送信前にはWebhook
URL設定、Discord送信、Minecraft接続、Dockerサービス起動の個別承認が必要です。試験結果を
非秘密な検証記録へ残した後、MySQL状態・履歴保存の設計工程へ進みます。

## 未決定事項

- 永続化開始時のMySQLスキーマとマイグレーション方式
- 停止直前通知をbest effortのまま扱う期間と、将来outboxで永続保証を開始する時点
- Webhook URLの本番secret管理方式
- 作業IDの生成責務と外部指示の形式
- JST表示をアプリケーション、通知アダプター、UIのどこで担当するか
