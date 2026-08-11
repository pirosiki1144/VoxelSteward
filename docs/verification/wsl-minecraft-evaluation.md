# WSL上のMinecraft評価環境

Issue #32の実装では、実ネットワークへ接続しない評価ハーネスと専用Composeサービスを追加しました。
WSL2上で状況判断と安全gateを再現し、実BDS接続やゲーム内操作へ進む前の検証に使用します。

## 現在の実装

- `compose.evaluation.yaml`の`local-evaluation`は`network_mode: none`、`restart: "no"`、read-only filesystemで動作します。
- 認証volume、永続アプリケーションvolume、Minecraft接続設定をmountしません。
- `src/evaluation/local-evaluation.ts`は接続準備、spawn、telemetry、他player、危険状態をallow-list入力で評価します。
- block配置は既存のprotocol capability gateを評価し、`unsupported`の間は書込み操作を0件にして停止します。
- 評価結果はscenario、outcome、reason、読み取り件数、書込み件数だけを構造化ログへ出します。

## 実行方法

```bash
npm run verify:evaluation-compose
docker compose -f compose.yaml -f compose.evaluation.yaml --env-file /dev/null --profile evaluation build local-evaluation
docker compose -f compose.yaml -f compose.evaluation.yaml --env-file /dev/null --profile evaluation run --rm local-evaluation
```

上記は外部Minecraft、Discord、MySQL、認証volumeへ接続しません。実行後に作成した一時コンテナはComposeの`--rm`で破棄されます。

## 実BDS接続への進行条件

現段階では実BDS用イメージ、バージョン、ライセンス、WSLネットワーク境界が未確定のため、Composeへ実BDSサービスを追加していません。
次の条件を満たし、試験コマンドと停止条件をレビューした後に別工程で追加します。

1. 専用test worldとrollback区域を用意する。
2. 既存認証volumeと分離した評価用認証境界を確認する。
3. BDSのversionとclient protocolの互換性を固定する。
4. login、spawn、telemetry、安全停止を読み取り専用で確認する。
5. block配置のprotocol evidenceが`unsupported`から解消され、単一操作の明示承認を得る。

実接続中のplayer名、BOT情報、server endpoint、認証情報、raw packetはログ・DB・fixtureへ記録しません。
