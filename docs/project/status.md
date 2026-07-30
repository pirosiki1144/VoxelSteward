# プロジェクト状況

## 基準

- 基準コミット: `c239b954d759e77bf52c2576e55884771e22e628`
- 完成マイルストーン: 状態駆動通知基盤
- 現在の工程: Discord Incoming Webhookアダプターのローカル実装と検証

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

## 現在の制約

- Minecraft内の操作機能はない
- Discord実送信試験、MySQL、作業キュー、スケジュール制御はない
- 状態イベントはプロセス内だけで、再起動後の永続化や配送再試行はない
- Discord通知は設定時だけ有効で、再起動後の重複防止や永続配送はない
- runtime用のreadinessエンドポイントはない

## 次の完了条件

コードレビューとcommit後、別途承認された専用Discordチャンネルで、秘密値を記録せず
Webhook配送、429相当の運用、通知障害時の安全停止非依存を確認します。実送信前には
Webhook URL設定と外部接続の個別承認が必要です。MySQL、作業キュー、Minecraft内操作は
後続工程へ持ち越します。

## 未決定事項

- 永続化開始時のMySQLスキーマとマイグレーション方式
- Discord実送信試験の安全なfixtureと合格条件
- Webhook URLの本番secret管理方式
- 作業IDの生成責務と外部指示の形式
- JST表示をアプリケーション、通知アダプター、UIのどこで担当するか
