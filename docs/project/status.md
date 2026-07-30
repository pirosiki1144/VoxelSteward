# プロジェクト状況

## 基準

- 基準コミット: `db74ee1d1d6922e5ae23e97ef59a71d6b08647de`
- 完成マイルストーン: 状態・進捗管理
- 次工程: Discord実アダプターの設計と承認

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

実サーバー試験の詳細は
[通常運転ランタイム検証](../verification/runtime-readonly.md)を参照してください。

## 現在の制約

- Minecraft内の操作機能はない
- Discord実送信、MySQL、作業キュー、スケジュール制御はない
- 状態イベントはプロセス内だけで、再起動後の永続化や配送再試行はない
- 通知もプロセス内No-opだけで、再起動後の重複防止や永続配送はない
- runtime用のreadinessエンドポイントはない

## 次の完了条件

[通知基盤](../notifications.md)を入力として、実DiscordアダプターのAPI方式、認証、
設定境界、レート制限、上限付き再試行を設計します。SDK・Webhookクライアント追加と
実送信は別途承認が必要です。MySQL、作業キュー、Minecraft内操作は後続工程へ持ち越します。

## 未決定事項

- 永続化開始時のMySQLスキーマとマイグレーション方式
- DiscordのBot APIとWebhook APIの選択
- Discord通知の配送タイムアウト、上限付き再試行、レート制限
- 作業IDの生成責務と外部指示の形式
- JST表示をアプリケーション、通知アダプター、UIのどこで担当するか
