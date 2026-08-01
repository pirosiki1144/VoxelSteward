# 単一dirt配置の実サーバー受入計画

## 現在のgate判定

**実配置試験はnot readyです。** 固定1.26.30 schemaで候補packetのoffline serializeは確認済みですが、
次を一次根拠とfixtureで確定するまで、実adapterは`unsupported`のままです。

- item registryから`minecraft:dirt`を一意に同定すること
- `ItemNew`観測からtransaction用`Item`を欠損なく構成できること
- support上面に対応するface数値の一次根拠
- standalone `inventory_transaction`とPlayerAuthInput埋込みの選択根拠
- authoritative tick・rotation・frameへ原子的に統合する境界

以下はgate解消後の段階計画です。段階C以降を実行してはなりません。

## 共通前提

この文書は将来の専用Minecraftテストサーバー試験計画です。現工程では実接続・実配置を行いません。
実Minecraft接続とgame操作は承認後だけ実施し、runtimeや通常作業queueへ自動接続せず、1回の操作上限を
維持します。認証volumeは既存のものを変更・初期化・削除しません。

- 他playerがいない隔離区域を用意する。
- targetは手の届く隣接空間1座標、事前状態はair、直下supportは既知のsolid blockとする。
- inventoryには試験用dirtを手動で1個以上準備し、slot・stack・runtime IDをログや文書へ記録しない。
- movement、jump、攻撃、採掘、chat、commandを同じ試験へ混在させない。
- player/BOT名、server endpoint、認証情報、実座標を検証記録へ残さない。

## 段階A: 読み取り専用観測

- runtime/smokeではなく、将来追加する専用acceptance entrypointだけを使用する。
- targetのair、直下supportのsolid、同一dimension、reach、selected slot、dirt同定を読み取り専用で確認する。
- packet送信、movement、item選択、block変更は0回とする。
- 期待logは座標やIDを含めず、`block_acceptance.observation_ready`相当を1件だけ記録する。
- timeout、他player、signal、disconnect、観測不一致はexit code 0の安全中止または設定・内部異常の非0とする。

## 段階B: dry-run

- Aと同じ観測と共通安全policyを実行し、typed instructionとcandidateを構成する。
- transport sendをFakeへ固定し、実client write回数が0であることを確認する。
- queueは`delivery_started`へ進めず、終了後も世界状態とinventoryが変化しないことをoperatorが確認する。

## 段階C: 単一配置

- ユーザーの明示承認と「他playerなし、isolated target確認済み」の合図後だけ開始する。
- dirt 1個、target 1座標、send最大1回、retry 0、`maxAttempts=1`を固定する。
- `delivery_started`保存後に1回だけ要求し、要求後のtimeout・disconnect・signalでは結果不明として再送しない。

## 段階D: server事後観測

- 同一targetのserver block updateがdirtになった場合だけ`verified`、completedとする。
- client申告、serializer成功、inventory減少、Discord通知だけでは合格にしない。
- send 1件、server verified 1件、disconnect 1件、exit code 0を確認する。

## 段階E: 中断

- 別runで送信前SIGTERM、他player検知、health/hungerまたはtelemetry無効、disconnectを各1条件ずつ確認する。
- 実player参加が必要な試験はBOTの接続・準備完了後にユーザーへ合図して待つ。
- 送信前中断はsend 0、送信後中断はsend 1以下で、どちらも再接続・再送0とする。
- signal/player安全停止は正常終了、内部・設定・永続化異常は非0とし、listenerとtimerを残さない。

## 実行コマンドgate

専用acceptance entrypointとCompose serviceは未実装です。既存`runtime`を代用して実行してはなりません。
実装後は空の表示用envを使うoffline検証と、秘密を表示しない専用service起動コマンドをこの節へ固定し、
段階ごとに送信上限をコードとlogで確認します。現在実行可能なのは次のoffline検証だけです。

```bash
npm test -- --run tests/bedrock-block-placement-schema.test.ts tests/block-operation.test.ts
```

## 後片付け

- runtime/smokeや無関係なserviceを起動しない。
- 専用containerだけを停止し、認証volumeや永続volumeを削除しない。
- 配置済みdirtのrollbackはユーザーの明示判断による手動回収だけとし、BOTで採掘しない。

## 旧段階概要

以前の1～5段階は、上記A～Eへ具体化しました。

## 中止条件

- targetまたはsupportが期待と異なる
- inventory、hotbar、stack ID、runtime ID、face、server observationを確定できない
- 他player検知、signal、telemetry異常、体力・空腹度低下、接続異常
- packetの重複、再試行、意図しないmovement・item・block操作
- server観測結果が欠落または曖昧

timeoutやdisconnect後は配置済みか不明なため再送しません。配置済みの場合のrollbackは、試験終了後に
ユーザーが明示同意した手動回収だけとし、BOTによる自動採掘を行いません。異常時は同じ試験を自動で
再実行せず、安全切断と非秘密な結果記録を優先します。
