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
        +---- Repository ports -- PostgreSQL repositories (future)
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
    persistence/ PostgreSQL repositories and migrations
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

プレイヤーの検知、安全でないワールド状態、ロックの喪失、または回復不能なアダプター
エラーが発生した場合は、`SAFETY_STOP`へ移行します。この状態では作業をキャンセルし、
安全に実行できる場合はチェックポイントを記録してからログアウトし、終了します。
`SAFETY_STOP`から`WORKING`へ戻る遷移はありません。

SIGTERMを受けた場合も、上限時間が設定された同じ停止処理を実行します。

## 4. 永続化

アプリケーションコードはSQLクライアントではなく、`Repository`インターフェースに
依存します。トランザクションとSQLは永続化アダプター内に留めます。スキーマ変更は、
順序付けされたマイグレーションファイルとして管理し、デプロイ手順の一環として適用
します。チェックポイントには、タスク識別子、バージョン、安全に再開できる位置、
状態ペイロード、タイムスタンプを含めます。

分散デプロイでは、データベースを利用した更新可能なリースを推奨します。リースキーには
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

認証キャッシュとインスタンスロックは、BOTアカウント識別子ごとの名前付きDocker
volumeへ保存します。実行コンテナは非rootかつread-onlyとし、認証volumeと一時的な
`/tmp`だけを書き込み可能にします。
