# 通知基盤

## 現在のスコープ

状態イベントから安全な通知内容を生成し、外部送信を抽象化するプロセス内基盤です。
Discordへの実送信、SDK、Webhookクライアント、認証・チャンネル設定、定時報告、
永続outboxは未実装です。通常runtimeは`NoopNotificationPort`を使用するため、
ネットワーク通信を行いません。テストだけが`FakeNotificationPort`を明示注入します。

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
   +-- NoopNotificationPort（現在のruntime標準）
   +-- FakeNotificationPort（テスト専用）
   +-- Discord adapter（未実装）
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

現在のruntimeで使うNo-op portは外部I/Oを行いません。将来の実アダプターを接続する場合も、
runtime停止時に外部送信完了を無期限に待つことは禁止します。

## 将来のDiscordアダプター

実アダプター工程では次を満たす必要があります。

- HTTP 429は`Retry-After`を尊重する
- 一時的な5xxまたは通信失敗だけを上限付き再試行する
- 認証失敗と不正リクエストは自動再試行しない
- 指数バックオフとjitterを使用する
- 再試行回数と総待機時間に上限を設ける
- 再試行中の重複送信防止に`notificationId`を使用する
- 緊急停止通知でもMinecraft切断を待たせない
- 永続配送が必要になった時点でMySQL等のoutboxを導入する

Webhook URL、token、channel IDは設定境界で管理し、状態、通知本文、ログ、テストfixture、
Gitへ保存しません。実Discord送信と認証設定には別途承認が必要です。
