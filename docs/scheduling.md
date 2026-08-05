# 平日運用スケジューラー

## 現在の実装範囲

`src/domain/scheduler/`は、注入されたClockのUTC時刻からJSTの運用枠を判定し、接続開始・停止の
intentを生成するdomainです。Minecraft、MySQL、Docker、process signalには依存しません。

運用枠は次のとおりです。祝日は判定しません。

| JST                            | 判定       | intent               |
| ------------------------------ | ---------- | -------------------- |
| 平日09:00:00以上、11:59:00未満 | 午前枠     | 枠へ入ったときに開始 |
| 平日11:59:00以上、12:00:00未満 | 切替時間   | 午前枠を停止         |
| 平日12:00:00以上、17:00:00未満 | 午後枠     | 枠へ入ったときに開始 |
| 平日17:00以降、09:00未満、土日 | 運用時間外 | 稼働中の枠を停止     |

内部の`evaluatedAt`、`startsAt`、`endsAt`はUTCのISO 8601文字列です。日付、曜日、境界のJST変換は
`weekday-scheduler.ts`へ集約しています。

## 重複防止と時計変動

- process起動時に現在が運用枠内なら、その枠の開始intentを1件生成します。
- 同じ枠を繰り返し評価してもintentを再生成しません。
- 枠が変わる場合は旧枠の停止、新枠の開始の順でintentを返します。
- 時計が前回評価時刻以前へ巻き戻った場合はintentを生成しません。
- 時計が境界を飛び越した場合、通過した全境界を再生せず、旧枠停止と現在枠開始の最小遷移だけを返します。
- 日付と枠を組み合わせたwindow IDにより、翌営業日の同じ午前・午後枠を別の枠として扱います。

`ScheduledRuntimeController`はintentを既存の読み取り専用runtime sessionへ接続します。停止intentでは
schedule状態を記録して`reason: "schedule_window_ended"`を発行し、runtime終了とsession cleanupを
awaitしてから次の開始intentを処理します。午前・午後は別のStateStore、MySQL run ID、InstanceLock取得とし、
同時接続を防ぎます。

他player検知、operator停止、回復不能エラー、再接続上限到達でsessionが終了しても、schedulerは同じwindowの
開始intentを再生成しません。SIGINT・SIGTERMはpoll待機を解除し、active sessionへ同じ停止理由を伝えて
安全終了します。通知・DB障害はruntimeの切断完了を妨げません。

Composeの`scheduled-runtime`は`scheduled` profileに隔離し、明示した場合だけ起動します。通常`runtime`と
同じ認証volumeを使いますが、各sessionのInstanceLockを取得できた場合だけ接続を開始します。

## 未実装

- 祝日判定
- 永続化されたscheduler checkpoint
- 実Minecraft serverでのスケジュール受入試験

Fake Clockによる境界、再起動相当、重複、巻戻り、飛越しは`tests/scheduler.test.ts`、Fake sessionによる
接続順序、停止、非再接続、signalは`tests/scheduled-runtime-controller.test.ts`で検証します。
