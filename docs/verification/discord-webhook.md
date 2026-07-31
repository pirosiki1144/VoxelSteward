# Discord Incoming Webhook受入結果

## 検証対象

- 対象コミット: `7bef89078fc6870971a324479ec4e3b2c21e5735`
- 実施日: 2026-07-31
- 環境: 接続と通知の許可を得た専用テスト環境

Webhook URL、チャンネルID、DiscordメッセージID、Minecraft接続先、BOTアカウント名、
実プレイヤー名、認証情報は記録しません。

## 結果

| 試験 | 内容                                         | 結果 |
| ---- | -------------------------------------------- | ---- |
| 1    | 接続開始、login、spawnのWebhook通知          | 合格 |
| 2    | SIGTERM時の安全切断とDiscord配送からの隔離   | 合格 |
| 3    | 接続後の他プレイヤー検知、安全切断、非再接続 | 合格 |

### 試験1: 接続ライフサイクル通知

- 接続開始、login完了、spawn完了の通知を、この順序で各1件確認しました。
- 通知の重複、意図しないmention、秘密情報の混入はありませんでした。
- Webhook配送失敗は0件でした。

### 試験2: SIGTERMと配送の隔離

- SIGTERMを受信し、`reason: "signal_sigterm"`、`outcome: "normal"`、
  `exitCode: 0`で終了しました。
- 安全切断は3msで完了し、再接続は0件でした。
- 停止要求通知と正常停止通知はruntime終了時のbinding closeで`cancelled`となりました。
  停止直前の配送はbest effortであり、通知完了を待たずMinecraftの安全切断を優先する
  現行仕様どおりの結果です。

### 試験3: 他プレイヤー検知と安全停止

- BOT接続後の他プレイヤー検知を1件確認しました。
- 検知から安全切断まで2msで、`reason: "other_player_detected"`、
  `outcome: "normal"`、`exitCode: 0`で終了しました。
- 再接続は0件でした。
- 緊急停止通知はruntime終了時のbinding closeで`cancelled`となりました。通知配送を
  待たず、安全切断を優先するbest effort仕様どおりの結果です。

## 受入判断

Incoming Webhookによる接続ライフサイクル通知、mention抑止、重複抑止、および通知配送と
Minecraft安全停止の分離を専用テスト環境で確認しました。試験1～3はすべて合格です。

試験時点では永続outboxがなく、停止直前通知はbest effortでした。現在はMySQL outboxへの
記録を追加済みですが、配送worker、配送済み更新、再起動後の重複防止は未実装です。
