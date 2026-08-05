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

この重複防止は単一scheduler instance内の判断です。実際のMinecraft接続・切断の一度だけの実行、
旧runの切断完了待ち、他player検知・operator停止後の非再開はIssue #7のruntime統合で実装します。

## 未実装

- scheduler intentと通常runtimeの接続
- 自動的なprocess起動や常駐timer
- 祝日判定
- 永続化されたscheduler checkpoint
- 実Minecraft接続

Fake Clockによる境界、再起動相当、重複、巻戻り、飛越しの検証は`tests/scheduler.test.ts`で行います。
