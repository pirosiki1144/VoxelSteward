# 通知基盤

## 現在のスコープ

状態イベントから安全な通知内容を生成し、外部送信を抽象化するプロセス内基盤です。
通常runtimeは既定で`NoopNotificationPort`を使用します。明示的に有効化し、起動時の
厳格なURL検証を通過した場合だけ、Discord Incoming Webhookアダプターを使用します。
Discord SDK、Bot API、認証・チャンネル作成、定時報告、永続outboxは含みません。
自動テストは注入したFake HTTP transportだけを使用します。設定済みWebhookと既存の固定
templateを使う回数限定の開発・テスト・受入送信は、[開発権限と承認ゲート](project/governance.md)
の条件を満たす場合に自律実行できます。

## コンポーネント

```text
StateStore
   |
   v
NotificationSubscriber
   |
   +-- mapStateChangeToNotification
   |
   v
NotificationPort
   +-- NoopNotificationPort（通知無効時）
   +-- DiscordWebhookNotificationPort（明示的な有効時）
   +-- FakeNotificationPort（テスト専用）
```

- mapperは`StateChangeEvent.before`と`after`の実値を比較します。
- subscriberは通知対象をrevisionの昇順で直列配送します。
- portは外部配送方式を抽象化し、状態domainやRuntimeSupervisorから分離します。
- Minecraftイベントからportを直接呼び出しません。

## NotificationMessage

```ts
interface NotificationMessage {
  readonly notificationId: string;
  readonly sourceRevision: number;
  readonly type: NotificationType;
  readonly severity: "info" | "warning" | "error" | "critical";
  readonly occurredAt: string;
  readonly title: string;
  readonly body: string;
}
```

`notificationId`は`state:<revision>:<type>`として同じ状態イベントから決定論的に生成します。
メッセージは実行時にfreezeし、titleとbodyには固定テンプレートだけを使用します。

プレイヤー名、BOTアカウント名、接続先、ポート、Discordのtoken・Webhook URL・
channel ID、Cookie、認証キャッシュ、生のError、stackは含めません。状態の自由入力である
作業進捗messageやサニタイズ済みエラーmessageも、現在は本文へ転送しません。

## 通知マッピング

| 状態変化                               | 通知type                   | severity   |
| -------------------------------------- | -------------------------- | ---------- |
| Minecraft `disconnected -> connecting` | `minecraft_connecting`     | `info`     |
| Minecraft `connecting -> connected`    | `minecraft_connected`      | `info`     |
| spawn未完了から完了                    | `minecraft_spawned`        | `info`     |
| 運転継続中のMinecraft切断              | `minecraft_disconnected`   | `warning`  |
| runtimeが`reconnecting`へ遷移          | `reconnect_started`        | `warning`  |
| シグナルまたは明示停止理由の記録       | `stop_requested`           | `info`     |
| 安全な`stopped`遷移                    | `runtime_stopped`          | `info`     |
| 回復不能エラーの記録                   | `runtime_failed`           | `error`    |
| 再接続上限エラーの記録                 | `reconnect_exhausted`      | `error`    |
| 他プレイヤー未検知から検知済み         | `other_player_safety_stop` | `critical` |
| 作業`preparing`                        | `task_preparing`           | `info`     |
| 作業`preparing -> running`             | `task_started`             | `info`     |
| 作業`running -> paused`                | `task_paused`              | `warning`  |
| 作業`paused -> running`                | `task_resumed`             | `info`     |
| 作業`completed`                        | `task_completed`           | `info`     |
| 作業`failed`                           | `task_failed`              | `error`    |
| 作業`stopped`                          | `task_stopped`             | `warning`  |

他プレイヤー検知の原子的イベントは、通常停止より優先して緊急停止通知1件へ変換します。
その後の`stopped`は同じ理由の通常停止通知へ変換しません。telemetryと作業進捗更新は
通知対象外です。位置、体力、空腹度は将来の定時報告または明示的な危険閾値判定でのみ
利用し、更新ごとの通知は行いません。作業状態はruntimeがまだ更新していないため、
現在の作業通知はmapperと単体テストだけです。

## 順序と重複防止

- subscriberは受理したrevisionを単調増加させ、同じrevisionと古いrevisionを無視します。
- 状態イベントの到着順にPromiseチェーンへ追加し、送信開始をrevision順に直列化します。
- 同じ`notificationId`は送信しません。
- notificationId履歴は既定256件のFIFO上限を持ち、無制限に増加しません。
- 古いrevisionが遅れて到着しても巻き戻して送信しません。
- `flush()`で受理済み配送の完了をテストでき、`unsubscribe()`または`close()`で新規受付を
  停止できます。

この保証は同一プロセス内だけです。再起動後の重複防止と永続配送は保証しません。
将来MySQL等へ配送済みnotificationIdとoutboxを保存し、revision順の再開を設計します。

## 障害隔離

状態dispatchは通知完了を待ちません。同期送信例外とPromise rejectionは配送チェーン内で
捕捉し、`onNotificationError`へ渡します。エラー報告callback自体の例外も隔離し、
状態dispatchや通知を再帰的に発生させません。通知失敗はruntimeを停止させず、
他プレイヤー検知時のMinecraft切断を待たせません。

No-op portは外部I/Oを行いません。Webhook portの同期例外とrejectionも同じ境界で隔離し、
既知の配送エラーはcode、classification、任意のstatus、attemptsだけをログへ投影します。
未知エラーも固定分類へ変換し、生Error、stack、cause、URL、応答本文を記録しません。

## Discord Incoming Webhookアダプター

- `DISCORD_NOTIFICATIONS_ENABLED`は未設定または厳密な`false`で無効、厳密な`true`で有効です。
- 無効時はURLを検証せずNo-opを選びます。
- 有効時はHTTPS、厳密な`discord.com`、標準Webhook path、資格情報・port・query・hashなしを
  Minecraft接続前に検証します。
- `wait=true`のPOSTで、`content`と`allowed_mentions: { parse: [] }`だけをJSON送信します。
- contentは固定済みNotificationMessageフィールドだけから生成し、JavaScript文字列長
  2,000を超えた場合は切り詰めず通信前に拒否します。
- 1試行5秒、最大3試行、HTTP時間と全待機を含む総15秒を上限にします。
- 429は数値検証した`Retry-After`、次に16KiB以下のJSON `retry_after`を秒として使用します。
- 500、502、503、504、通信失敗、試行timeoutだけを上限付きで再試行します。
- 通常バックオフは250ms、500msを基礎とし、小さなjitterを加えます。
- 成功応答のRemainingが0ならReset-Afterを次通知の事前待機へ使用します。
- Discordのlimit値はハードコードしません。
- HTTP transport、単調時計、Abort可能wait、jitterはFakeへ差し替え可能です。

runtimeはsubscriberを閉じて新規受付を停止した後、通知bindingを閉じます。bindingは
進行中fetch、レート制限待機、再試行バックオフをAbortし、配送完了を待ちません。
`NotificationPort`の公開契約にはcloseを追加していません。

実Webhook URL、token、channel IDは設定境界で管理し、状態、通知本文、ログ、テストfixture、
Gitへ保存しません。プロセス再起動後の重複防止・永続配送には、将来MySQL等のoutboxが
必要です。専用テスト環境で実Discord送信を含む受入試験1～3が完了しています。非秘密な
結果は[Discord Incoming Webhook受入結果](verification/discord-webhook.md)を参照してください。

実送信は既存templateだけを使用し、mentionを無効化し、送信回数、timeout、retryを有限に
保ちます。`.env`、Webhook URL、tokenを表示・記録・コピーせず、配送障害を主要処理と
Minecraftの安全停止から隔離します。Webhook URLの作成・変更・rotation・削除、Discord側の
channel、Webhook、Bot、role、権限変更、Bot API、双方向通信、自由文、大量送信は承認必須です。
