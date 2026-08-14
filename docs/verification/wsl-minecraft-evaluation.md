# WSL上のMinecraft評価環境

Issue #32の実装では、実ネットワークへ接続しない評価ハーネスと専用Composeサービスを追加しました。
WSL2上で状況判断と安全gateを再現し、実BDS接続やゲーム内操作へ進む前の検証に使用します。

## 現在の実装

- `compose.dev.yaml`の`local-evaluation`は`network_mode: none`、`restart: "no"`、read-only filesystemで動作します。
- 認証volume、永続アプリケーションvolume、Minecraft接続設定をmountしません。
- `src/evaluation/local-evaluation.ts`は接続準備、spawn、telemetry、他player、危険状態をallow-list入力で評価します。
- block配置は既存のprotocol capability gateを評価し、`unsupported`の間は書込み操作を0件にして停止します。
- 評価結果はscenario、outcome、reason、読み取り件数、書込み件数だけを構造化ログへ出します。
- `evaluation-minecraft` profileにはdigest固定のBDS、評価専用world volume、評価専用認証volume、読み取り専用runtimeを定義します。通常Composeではprofileが無効です。
- BDSは`FORCE_WORLD_COPY=false`で既存worldを上書きせず、worldがない場合だけ`LEVEL_NAME=VoxelStewardLocal`で新規作成します。
- 新規worldの指定はsurvival、normal、hardcore無効です。座標表示は`showcoordinates=true`を初期設定へ渡し、起動後に実gameruleを確認します。
- WSL内Docker EngineをWindows側から利用する場合、UDP公開は既定でWSLの全インターフェースへbindし、Windows MinecraftクライアントからはWSLのIPと`19133`を指定します。`127.0.0.1`はWSL内部のloopbackであり、Windows側localhost転送を前提にしません。

## 実行方法

```bash
npm run verify:evaluation-compose
docker compose -f compose.yaml -f compose.dev.yaml --env-file /dev/null --profile evaluation build local-evaluation
docker compose -f compose.yaml -f compose.dev.yaml --env-file /dev/null --profile evaluation run --rm local-evaluation
```

上記は外部Minecraft、Discord、MySQL、認証volumeへ接続しません。実行後に作成した一時コンテナはComposeの`--rm`で破棄されます。

## 実BDS接続への進行条件

実BDS用serviceはComposeへ追加済みですが、`evaluation-minecraft` profileで隔離されています。次の条件を満たし、試験コマンドと停止条件をレビューした後に起動します。

1. 専用test worldとrollback区域を用意する。
2. 既存認証volumeと分離した評価用認証境界を確認する。
3. BDSのversionとclient protocolの互換性を固定する。
4. login、spawn、telemetry、安全停止を読み取り専用で確認する。
5. block配置のprotocol evidenceが`unsupported`から解消され、単一操作の明示承認を得る。

構成確認は次で行います。`/dev/null`を使うため、既存`.env`は読みません。

```bash
npm run verify:evaluation-compose
docker compose -f compose.yaml -f compose.dev.yaml --env-file /dev/null --profile evaluation-minecraft config --quiet
```

実BDS接続では、既存の本番・開発MySQL、認証volume、world volumeを使用しません。既存local worldは上書きせず、world設定を確認できない場合はruntimeを接続しません。

実接続中のplayer名、BOT情報、server endpoint、認証情報、raw packetはログ・DB・fixtureへ記録しません。

## 実BDS起動試験の結果（2026-08-13）

評価用BDSを単体で起動し、runtimeと実機クライアントは起動しませんでした。従来の`1.26.40`を
指定した試験では公式配布URLが404となり、公式配布ファイル名に合わせて現在の開発BDS既定値は`1.26.43.1`へ更新しています。
`bedrock-protocol`側の接続対応値は別管理のため、runtimeはこのBDSへ接続せず、互換性確認を保留します。
そのため、BDSコンテナはworld初期化前に停止し、login、spawn、gamerule、読み取り専用runtimeの
受入条件は未判定です。評価用world volumeは削除せず保持しています。

公式ダウンロードページは利用可能なlive/preview版を都度提示する方式のため、`1.26.43.1`の
実イメージ取得可否はコンテナ起動時に確認します。BDS単体の到達性確認と、固定したclient
protocolとの互換性確認は分離し、互換性が確認できるまでruntimeは起動しません。

## WSLホストからの接続確認（2026-08-14）

開発用BDSを`1.26.43.1`で起動し、Windows 11のMinecraftクライアントから
WSLの`eth0`アドレスとUDPポート`19133`を指定して接続できることを確認しました。
`127.0.0.1`ではWSL内Docker Engineのloopback bindにより到達できなかったため、
評価BDSの公開先をWSL全インターフェースへ変更しました。接続性確認時は評価用allow-listを
無効化し、runtime、smoke、認証volumeは起動・使用していません。MySQLは開発volumeを再利用して
起動しましたが、Minecraft runtimeの履歴保存試験は実施していません。
