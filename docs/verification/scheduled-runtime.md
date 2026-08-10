# スケジュール運転runtime offline検証

## 対象

Issue #7で、平日scheduler intentと既存の読み取り専用runtime sessionを接続しました。Issue #8のoffline統合検証として、Fake Clock、
Fake Minecraft connection、隔離MySQL、Compose構成による検証であり、実Minecraft serverへ接続していません。

## 確認内容

- 09:00と12:00の各windowで接続sessionを一度だけ作成
- 11:59と17:00に`reason: "schedule_window_ended"`で正常停止
- 旧sessionの停止・cleanup完了後だけ次sessionを作成
- 同一BOT identityのInstanceLock競合拒否
- 他player検知、operator停止、session作成失敗後の同一window非再接続
- supervisor内の有限再接続上限を維持
- SIGINT・SIGTERMによるpoll待機解除とactive session安全終了
- schedule intent、接続、spawn、telemetry、task checkpoint、停止理由のrevision順保存
- schedule状態の読み取り専用operator照会
- DB障害をMinecraft安全停止から隔離
- movement、視点、block、item、chat、command送信APIを追加していないこと

## Issue #8の受入結果

Issue #8の必須ケースを、`tests/scheduler.test.ts`、`tests/scheduled-runtime-controller.test.ts`、
`tests/runtime.test.ts`、`tests/mysql-persistence.integration.test.ts`で検証しました。統合ケースではFake Clockを
08:59、09:00、11:59、12:00、17:00へ進め、午前sessionのcleanup完了後に午後sessionを開始すること、各sessionが
一度だけ安全停止すること、Minecraft送信操作がないことを確認します。MySQLケースは隔離サービスでのみ実行します。

実行結果:

- offline自動テスト: 合格
- 隔離MySQL統合テスト: 合格（15件）
- 実Minecraft server接続: 未実施

## 未実施

- 実Minecraft serverでの09:00、11:59、12:00、17:00受入
- production環境へのdeploy
- 祝日判定

実接続はIssue #9の承認gateに従い、専用test serverと既存認証volumeを使用して別途実施します。
