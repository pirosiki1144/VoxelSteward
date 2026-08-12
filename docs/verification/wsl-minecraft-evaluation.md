# WSL上のMinecraft評価環境

Issue #32の実装では、実ネットワークへ接続しない評価ハーネスと専用Composeサービスを追加しました。
WSL2上で状況判断と安全gateを再現し、実BDS接続へ進む前の検証に使用します。

## 現在の実装

- `compose.evaluation.yaml`の`local-evaluation`は`network_mode: none`、`restart: "no"`、read-only filesystemで動作します。
- 認証volume、永続アプリケーションvolume、Minecraft接続設定をmountしません。
- `src/evaluation/local-evaluation.ts`は接続準備、spawn、telemetry、他player、危険状態をallow-list入力で評価します。
- block配置は既存のprotocol capability gateを評価し、`unsupported`の間は書込み操作を0件にして停止します。
- 評価結果はscenario、outcome、reason、読み取り件数、書込み件数だけを構造化ログへ出します。
- `evaluation-minecraft` profileには、digest固定のBDS、tmpfs MySQL、runtimeを分離して定義します。通常のCompose起動ではprofileが無効です。

## 実行方法

```bash
npm run verify:evaluation-compose
docker compose -f compose.yaml -f compose.evaluation.yaml --env-file /dev/null --profile evaluation build local-evaluation
docker compose -f compose.yaml -f compose.evaluation.yaml --env-file /dev/null --profile evaluation run --rm local-evaluation
```

上記は外部Minecraft、Discord、MySQL、認証volumeへ接続しません。実行後に作成した一時コンテナはComposeの`--rm`で破棄されます。

## 実BDS接続への進行条件

実BDS用serviceはComposeへ追加済みですが、通常起動からはprofileで隔離しています。次の条件を満たし、試験コマンドと停止条件をレビューした後に起動します。

1. 専用test worldとrollback区域を用意する。
2. 既存認証volumeと分離した評価用認証境界を確認する。
3. BDSのversionとclient protocolの互換性を固定する。
4. login、spawn、telemetry、安全停止を読み取り専用で確認する。
5. block配置のprotocol evidenceが`unsupported`から解消され、単一操作の明示承認を得る。

構成確認だけを行う場合は次を実行します。`/dev/null`を使うため、既存`.env`は読みません。

```bash
npm run verify:evaluation-compose
docker compose -f compose.yaml -f compose.evaluation.yaml --env-file /dev/null --profile evaluation-minecraft config --quiet
```

実BDS接続は`runtime-evaluation`を1回だけ起動し、`MYSQL_PERSISTENCE_ENABLED=true`の開発MySQLへ履歴を保存します。
既存認証volumeは使用せず、評価専用volumeを使います。評価専用認証volumeの作成は起動前に承認します。

開発MySQLだけの保存確認は、Minecraftを起動せずに次で行います。

```bash
docker compose -f compose.yaml -f compose.evaluation.yaml --env-file /dev/null --profile evaluation-minecraft up -d mysql-evaluation
npm run build
npm run verify:evaluation-mysql
docker compose -f compose.yaml -f compose.evaluation.yaml --profile evaluation-minecraft stop mysql-evaluation
```

実接続中のplayer名、BOT情報、server endpoint、認証情報、raw packetはログ・DB・fixtureへ記録しません。
