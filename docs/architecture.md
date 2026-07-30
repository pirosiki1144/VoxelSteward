# アーキテクチャ

## 1. 設計目標

このアーキテクチャでは、Minecraft、永続化、ホスティングに関する選択がタスクロジックへ
影響しないように、ポートとアダプターを使用します。安全ポリシーはアプリケーション境界に
配置し、アダプターから迂回できないようにします。

## 2. 目標とするコンポーネントモデル

```text
Entrypoint / lifecycle
        |
Application coordinator ---- Safety policy
        |                         |
        +---- Domain tasks -------+
        |
        +---- Minecraft port ---- bedrock-protocol adapter (read-only smoke)
        +---- Repository ports -- MySQL repositories (future)
        +---- Checkpoint port --- durable checkpoint repository (future)
        +---- Instance lock ----- DB lease/advisory lock (future)
```

将来推奨されるソース構成は次のとおりです。

```text
src/
  application/   orchestration, lifecycle, safety policy
  domain/        task state and rules without infrastructure imports
  ports/         Minecraft and Repository interfaces
  adapters/
    minecraft/   bedrock-protocol read-only integration
    persistence/ MySQL repositories and migrations
  infrastructure/ configuration, logging, health, signals
```

初期段階のソースは意図的に小さく保ちます。ディレクトリは、そこに配置するコードが
存在するようになった時点で導入します。

## 3. ライフサイクルと安全状態

将来実装するコーディネーターは、次の明示的な状態機械を持ちます。

```text
STARTING -> READY -> WORKING -> STOPPING -> STOPPED
                         \-> SAFETY_STOP -/
```

`normal`でのプレイヤー検知、安全でないワールド状態、ロックの喪失、または回復不能な
アダプターエラーが発生した場合は、`SAFETY_STOP`へ移行します。この状態では作業をキャンセルし、
安全に実行できる場合はチェックポイントを記録してからログアウトし、終了します。
`SAFETY_STOP`から`WORKING`へ戻る遷移はありません。

SIGTERMを受けた場合も、上限時間が設定された同じ停止処理を実行します。

## 4. 永続化

アプリケーションコードはSQLクライアントではなく、`Repository`インターフェースに
依存します。トランザクションとSQLは永続化アダプター内に留めます。スキーマ変更は、
順序付けされたマイグレーションファイルとして管理し、デプロイ手順の一環として適用
します。チェックポイントには、タスク識別子、バージョン、安全に再開できる位置、
状態ペイロード、タイムスタンプを含めます。

将来の永続化先はMySQLとします。分散デプロイでは、データベースを利用した更新可能な
リースを推奨します。リースキーには
BOTの識別情報を使用します。リースの取得または更新に失敗した場合は作業を実行せず、
安全に切断します。

## 5. 認証データ

Minecraftアダプターは、設定から認証キャッシュのパスを受け取ります。
ローカル環境では、リポジトリ外のバインドマウントまたは名前付きボリュームを使用します。
AWSでは、暗号化されたシークレット、またはライブラリに適した永続ストレージで管理する
必要があります。キャッシュの内容をログへ出力してはいけません。

## 6. 可観測性

プログラムは、Dockerまたはクラウドのログドライバーで収集できるように、JSONログを
stdoutへ出力します。現在、`/health`はプロセスの生存状態を返します。将来の準備状態には、
秘密情報を公開することなく、設定、インスタンスリース、データベース、Minecraftセッション
の状態を含めます。

## 7. デプロイの可搬性

アプリケーションは、リポジトリと外部の認証キャッシュを除いてステートレスです。環境変数
から設定を受け取り、stdoutへログを出力し、SIGTERMを処理し、HTTPヘルスチェックを公開
します。これにより、同じ成果物をCompose、systemd、ECS、またはその他のLinuxコンテナ
ランタイムで実行できます。

## 8. 読み取り専用スモークテスト

スモークテストのアプリケーション層は`ReadonlyMinecraftConnection`だけに依存します。
bedrock-protocolアダプターは受信パケットを型付きイベントへ変換し、ゲーム内行動を
送信するメソッドを公開しません。ライブラリが接続維持に必要として送信する応答と、
明示的な切断だけを許可します。

プレイヤー一覧イベントの変換はMinecraftアダプターが担当し、接続継続または停止の判断は
Minecraftへ依存しない`PlayerDetectionPolicy`が担当します。初期プレイヤー一覧はBOTの
認証名が確定したスポーン時に評価し、自身を除外します。`normal`は停止要求へ変換し、
`debug`は観測ログだけを出して接続を維持します。

認証キャッシュとインスタンスロックは、BOTアカウント識別子ごとの名前付きDocker
volumeへ保存します。実行コンテナは非rootかつread-onlyとし、認証volumeと一時的な
`/tmp`だけを書き込み可能にします。

## 9. 読み取り専用通常運転

`RuntimeSupervisor`は接続Factoryと中断可能な待機関数に依存し、Minecraftライブラリから
独立して接続試行、プレイヤー安全停止、シグナル停止、上限付き再接続を調整します。
各試行のイベントリスナーと接続タイマーは試行終了時に解除され、同時に複数の接続試行を
開始しません。`BedrockReadonlyConnection`は受信パケットの型付きイベント変換と
明示的な切断だけを担当します。

再試行対象は接続close、接続タイムアウト、およびエラーコードで明確に識別できる一時的な
ネットワークエラーです。未知エラーは安全側で回復不能と扱います。通常運転とsmokeは同じ
`InstanceLock`と認証volumeを使い、同じBOT識別子の同時使用を防ぎます。

## 10. 状態・進捗管理

状態管理はMinecraft、Discord、MySQLから独立したdomainモジュールとし、コマンドによる
検証済み遷移、読み取り専用スナップショット、プロセス内の変更イベントを提供します。
`RuntimeSupervisor`は接続イベントを状態コマンドへ変換します。将来のDiscord通知と
MySQL Repositoryは同じイベントを購読し、subscriber障害は安全切断経路から隔離します。
スナップショットとイベントは実行時に再帰的にfreezeし、時刻は注入可能なClockから
UTCで取得します。subscriberはmicrotaskで呼び出し、同期例外と非同期rejectionを
観測可能なエラー報告へ隔離します。詳細は[状態・進捗管理](state-management.md)を
参照してください。

## 11. 通知基盤

通知は`StateChangeEvent`だけを起点とし、MinecraftアダプターやRuntimeSupervisorから
送信ポートを直接呼びません。application層のmapperが変更前後の状態を固定テンプレートの
`NotificationMessage`へ変換し、`NotificationSubscriber`がrevision順に
`NotificationPort`へ直列配送します。

通常runtimeは起動時に通知設定を一度だけ検証し、無効時は`NoopNotificationPort`、
有効時はNode標準`fetch`を用いる`DiscordWebhookNotificationPort`を共有StateStoreへ
接続します。Discord固有処理はadapter層に限定し、HTTP transport、単調時計、待機、jitterを
テストから差し替えられます。送信例外とPromise rejectionは安全な分類へ変換して通知エラー
callbackへ隔離し、安全切断や状態dispatchを待たせません。

runtime終了時はsubscriberの新規受付を止めた後、別のruntime bindingが進行中HTTPと
レート制限・再試行待機をAbortします。`NotificationPort`の既存契約には終了責務を
追加しません。Webhook URLは状態、通知本文、ログへ渡しません。Discord Bot API、
定時報告、永続outboxは未実装です。詳細は[通知基盤](notifications.md)を参照してください。
