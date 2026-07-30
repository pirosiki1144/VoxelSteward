# 状態・進捗管理

## 目的とスコープ

通常運転、将来のDiscord通知、MySQL保存、作業実行が同じ状態変化を利用できる、
インフラストラクチャ非依存の状態ストアを追加します。この段階では外部送信、DB接続、
Minecraft内操作、スケジュール制御を実装しません。

## 実装モジュール

```text
src/domain/state/
  types.ts          状態、スナップショット、イベントの型
  commands.ts       状態変更要求の判別共用体
  transitions.ts    許可された遷移と入力検証
  state-store.ts    スナップショット、dispatch、subscribe
  errors.ts         不正コマンドと不正遷移のdomainエラー
  index.ts          公開API
```

`RuntimeSupervisor`はコマンドをdispatchするだけとし、DiscordやMySQLを知りません。
将来の通知・永続化アダプターは`subscribe()`で同じイベントを受け取ります。

## 状態モデル

実装した中心型は次の構造です。すべての配列とオブジェクトは読み取り専用型として公開し、
スナップショット、ネストした値、変更イベントを実行時にも再帰的にfreezeします。

```ts
type RuntimeState =
  | "starting"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "stopping"
  | "stopped"
  | "failed";

type MinecraftConnectionState =
  "disconnected" | "connecting" | "connected" | "spawned";

type TaskState =
  | "idle"
  | "preparing"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

interface StateSnapshot {
  readonly revision: number;
  readonly runtime: RuntimeState;
  readonly minecraft: {
    readonly connection: MinecraftConnectionState;
    readonly spawnCompleted: boolean;
    readonly position?: Readonly<{ x: number; y: number; z: number }>;
    readonly health?: number;
    readonly hunger?: number;
    readonly otherPlayerDetected: boolean;
  };
  readonly task: {
    readonly id?: string;
    readonly type?: string;
    readonly state: TaskState;
    readonly startedAt?: string;
    readonly updatedAt: string;
    readonly finishedAt?: string;
    readonly progress?: number;
    readonly progressMessage?: string;
  };
  readonly stopReason?: string;
  readonly lastError?: Readonly<{
    code: string;
    message: string;
    occurredAt: string;
  }>;
  readonly updatedAt: string;
}
```

`progress`は0～1の正規化値として検証し、作業固有の詳細は`progressMessage`で表現します。
作業種別は初期段階では空でない文字列として検証し、将来の作業追加で状態ストア自体を
変更しない設計にします。

### Runtime

`starting`、`connecting`、`ready`、`reconnecting`、`stopping`、`stopped`、
`failed`

### Minecraft接続

`disconnected`、`connecting`、`connected`、`spawned`

`spawnCompleted`は明示的なbooleanとしても保持し、接続試行開始時に`false`へ戻します。

### Minecraftテレメトリー

- 現在位置
- 体力
- 空腹度
- 他プレイヤー検知済みか

プレイヤー名、サーバー接続情報、認証情報は含めません。

### 作業

- 作業ID
- 拡張可能な作業種別
- 状態: `idle`、`preparing`、`running`、`paused`、`completed`、`failed`、
  `stopped`
- 開始、最終更新、終了の各UTC時刻
- 進捗値
- 進捗メッセージ

全体には停止理由、最後のサニタイズ済みエラー、単調増加するrevision、最終更新UTC時刻を
持たせます。内部時刻はISO 8601 UTCとし、JST変換は表示側の責務にします。

## 公開インターフェース

```ts
interface StateStore {
  getSnapshot(): Readonly<StateSnapshot>;
  dispatch(command: StateCommand): StateChangeEvent | undefined;
  subscribe(listener: StateChangeListener): () => void;
}

interface Clock {
  now(): Date;
}

interface StateChangeEvent {
  readonly revision: number;
  readonly occurredAt: string;
  readonly cause: StateCommand["type"];
  readonly before: Readonly<StateSnapshot>;
  readonly after: Readonly<StateSnapshot>;
  readonly changedFields: readonly string[];
}

type StateChangeListener = (event: StateChangeEvent) => void | Promise<void>;

type StateCommand =
  | { type: "runtime.transition"; to: RuntimeState }
  | {
      type: "minecraft.connection.transition";
      to: MinecraftConnectionState;
    }
  | { type: "minecraft.spawn.update"; completed: boolean }
  | { type: "minecraft.telemetry.update"; telemetry: Telemetry }
  | { type: "safety.other_player_detected" }
  | { type: "task.prepare"; taskId: string; taskType: string }
  | { type: "task.transition"; to: TaskState }
  | {
      type: "task.progress.update";
      progress: number;
      message?: string;
    }
  | { type: "runtime.stop_reason.record"; reason: string }
  | {
      type: "runtime.error.record";
      error: {
        code: "connection_error" | "reconnect_exhausted" | "internal_error";
        message: string;
      };
    }
  | { type: "task.reset" };
```

- `getSnapshot()`は内部のfreeze済みスナップショットを返し、外部変更を実行時にも拒否する
- `dispatch()`は任意patchではなく判別共用体のコマンドだけを受ける
- Storeへ`Clock`を注入し、dispatch時刻をISO 8601 UTCとして一元生成する
- 実質的な変化がなければ更新せず、イベントも返さない
- 不正遷移は型または実行時検証で拒否する
- listenerはmicrotaskで呼び出し、同期例外とPromise rejectionを捕捉して他listenerと
  runtimeの安全停止を妨げない
- unsubscribe後はイベントを受け取らない
- subscriber障害は`onSubscriberError`へ渡し、状態dispatchへ再帰させない

イベントは`revision`、`occurredAt`、`cause`、変更前後のスナップショット、
変更フィールドを持ちます。dispatch順でdeliveryを開始しますが、非同期subscriberの完了順と
永続配送は保証しません。MySQL工程では順序付きキューと再試行を別途設計します。

初期状態はruntime `starting`、Minecraft `disconnected`、`spawnCompleted: false`、
作業`idle`、`revision: 0`とします。Storeは内部に可変なスナップショットを保持せず、
凍結済みスナップショットを返します。

## 状態遷移

### Runtime

```text
starting -> connecting -> ready
connecting -> reconnecting | stopping | failed
ready -> reconnecting | stopping | failed
reconnecting -> connecting | stopping | failed
stopping -> stopped | failed
starting -> stopping
```

他プレイヤー検知後は`stopping -> stopped`だけを許し、`connecting`や`reconnecting`へ
戻しません。

`starting -> stopping`は接続試行開始前のSIGINT、SIGTERM、明示停止を安全に表現するため、
初期案へ追加した遷移です。

### 作業

```text
idle -> preparing
preparing -> running | failed | stopped
running -> paused | completed | failed | stopped
paused -> running | failed | stopped
completed | failed | stopped -> idle  （明示的resetのみ）
```

開始前の進捗更新、終了済み作業の更新、非終端状態からのresetを拒否します。

## Runtimeへの接続点

- 起動開始: runtime `starting`
- 接続試行: runtime `connecting`、Minecraft `connecting`
- login完了: Minecraft `connected`
- spawn完了: runtime `ready`、Minecraft `spawned`
- `state`イベント: 位置、体力、空腹度を更新
- 一時切断: runtime `reconnecting`、Minecraft `disconnected`
- 他プレイヤー検知: 検知booleanと停止理由を同一dispatchで記録
- SIGINT、SIGTERM、明示停止: 停止理由を記録して`stopping`
- 正常終了: runtime `stopped`
- 回復不能エラー: 最後のエラーをサニタイズしてruntime `failed`

安全切断は状態購読者の完了を待たずに進めます。通知・DB障害はログへ隔離し、
Minecraft切断を妨げません。

`RuntimeSupervisor`は`StateStore`を注入可能とし、未指定時はプロセス内ストアを生成します。
状態コマンドが不正またはストア障害で失敗しても、`runtime.state_update_failed`を記録して
既存の切断経路を続行します。認証完了イベントのアカウント名、他プレイヤー名、
接続設定はStateStoreへ渡しません。

## 自動テスト

以下をFake Clock、Fake Minecraft接続、microtask flushで検証しています。

1. 初期スナップショット
2. UTC時刻と注入Clock
3. 有効なruntime遷移
4. 不正なruntime遷移の拒否
5. 有効な作業遷移
6. 不正な作業遷移と終了後更新の拒否
7. 位置、体力、空腹度の部分更新
8. 同一状態更新のイベント抑制
9. revisionとイベント順序
10. 複数購読者への配信
11. 購読解除
12. 同期listener例外とasync rejectionの隔離・障害報告
13. スナップショットとイベントの実行時変更防止
14. プレイヤー名や接続情報を持たない公開形
15. 他プレイヤー検知と停止理由の原子的更新
16. 他プレイヤー検知後の再接続遷移拒否
17. RuntimeSupervisorのlogin、spawn、telemetry反映
18. SIGINT、SIGTERM、接続エラー、再接続上限の反映
19. 状態dispatch失敗時にも安全切断すること
20. 既存のプレイヤー安全停止とsmoke回帰テスト
21. 終了後にlistener、接続タイマーを残さないこと

Fake接続とFake Clockを使用し、実時間sleepや外部接続は行いません。

## 受入条件

- 必須状態を単一スナップショットとして取得できる
- 有効な変化だけを順序付きイベントとして購読できる
- 同一状態の重複イベントが発生しない
- 不正遷移を検出して状態を変更しない
- listener障害がruntimeと他listenerへ伝播しない
- runtimeの接続、spawn、telemetry、停止、エラーが反映される
- 他プレイヤー検知後に再接続状態へ遷移できない
- 状態にプレイヤー名、接続先、認証情報を格納しない
- 既存回帰を含む全84自動テストが成功する
- format、typecheck、lint、build、Compose検証、Dockerイメージビルドが成功する

## subscriberの配送保証

dispatch順にmicrotaskを登録し、各subscriberの呼び出し開始順を維持します。ただし、
async subscriberの完了順、再試行、永続配送は保証しません。将来のMySQL永続化では、
revision順に処理する単一の順序付きキュー、失敗時の再試行、停止時のflush期限を
アダプター側で設計する必要があります。

## エラー情報の境界

StateStoreは生の`Error`、stack、接続ライブラリのメッセージを受け取らず、
`SanitizedError`の`code`と安全に表示可能な`message`だけを受け取ります。現在の
RuntimeSupervisorは固定文言だけを渡します。将来の呼出側も外部例外のmessageをそのまま
渡してはならず、境界で許可済みcodeと固定または明示的にサニタイズした文言へ変換します。

## 本番コードへの影響

新規domainモジュールとRuntimeSupervisorへの状態コマンド追加が中心です。
Minecraft接続ポート、PlayerDetectionPolicy、再接続判断、smokeの振る舞いは変更しません。
公開する状態はプロセス内APIだけで、HTTP、Discord、MySQLへの出力は追加していません。

## 将来工程の未決定事項

- 永続化工程で追加する`lastError`コード
- 完了作業をいつ`idle`へresetするか
- 状態イベントの将来の永続化粒度
