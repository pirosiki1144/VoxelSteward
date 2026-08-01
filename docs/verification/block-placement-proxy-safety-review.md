# Golden Capture proxy安全性レビュー

## 結論

固定依存`bedrock-protocol` 3.57.0の標準`Relay`は、Bedrock 1.26.30のschemaを読み込めますが、
VoxelStewardの読み取り専用capture proxyとしては採用しません。packet、接続先、認証情報を記録しないこと、
packetを改変・再送しないことを構造上保証できないためです。

新しいproxyを推測実装せず、Golden Fixtureの実取得は停止します。production配置adapterは`unsupported`、
Golden Capture entrypointは外部relay未接続のまま維持します。

## 調査対象

- `package.json`: `bedrock-protocol` 3.57.0固定
- `package-lock.json`: 同versionとnpm tarball integrityを固定
- `node_modules/bedrock-protocol/src/options.js`: current version 1.26.30
- `node_modules/minecraft-data/minecraft-data/data/bedrock/1.26.30/version.json`: protocol 1001
- `node_modules/bedrock-protocol/src/relay.js`: 標準Relayの中継、log、queue、切断処理
- `node_modules/bedrock-protocol/src/serverPlayer.js`: downstream login、認証情報のdecode、parse error処理
- `node_modules/bedrock-protocol/src/client/auth.js`: upstream Microsoft認証とcache
- `node_modules/bedrock-protocol/docs/API.md`: Relayがpacketを変更・cancel・追加送信できる公開契約

調査は固定されたローカル依存の読み取りとoffline testだけで行いました。proxy、Minecraft、Microsoft認証、
BDS、外部APIは起動・接続していません。

## Safety Evidence Matrix

| 確認事項                          | 固定実装の根拠                                                                                                    | 判定       | 理由                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| 1.26.30をdecode／encodeできる     | `options.js`のcurrent version、protocol 1001、既存offline serializer test                                         | 構文上対応 | schema対応は確認できるが、end-to-end relay互換性と安全性は証明しない               |
| Microsoft認証情報を記録しない     | `serverPlayer.js`がlogin JWT、profile、skin dataをdecode・保持。`client/auth.js`がAuthflowとprofiles folderを使用 | 不合格     | 標準Relayは認証境界そのものであり、認証情報非保持の受信専用境界ではない            |
| BDS接続先をlogへ出さない          | `relay.js`がdebug loggerへupstream host／portとclient addressを渡す                                               | 不合格     | `logging: false`はpacket helper logを止めても、別のdebug経路を型・構造上除去しない |
| raw packetを記録しない            | upstream parse失敗時に`dumpFailedBuffer`を呼び、addressとerrorをconsoleへ渡す                                     | 不合格     | malformed packet時にraw dumpと接続情報を出さない保証がない                         |
| packetを改変しない                | 全packetをdecode後に`queue(name, params)`で再serialize。`client_cache_status`を置換                               | 不合格     | byte-transparentではなく、固定実装自身が少なくとも1 packetを変更する               |
| packetを再送・順序変更しない      | upstream／downstream queueとflush処理を持つ                                                                       | 不合格     | 接続準備中packetを保持し、後から送るため、capture専用の観測のみではない            |
| 利用側がpacketを変更できない      | `serverbound`／`clientbound` listenerへ可変paramsとcancel可能なdecoded objectを公開                               | 不合格     | 公開APIが改変、cancel、任意queue送信を明示的に許可する                             |
| player disconnectで両方向を閉じる | `RelayPlayer.close`はupstreamを閉じ、upstream closeはdownstreamをdisconnect                                       | 部分適合   | 対向close経路はあるが、queue、timer、map cleanupを含む専用の決定論的試験がない     |
| capture終了後に再接続しない       | Relay自身にVoxelStewardの単発capture lifecycleはない                                                              | 不合格     | Relayの接続管理をcapture 1件で停止する既定契約がない                               |

## `logging: false`だけでは不十分な理由

`RelayPlayer`の4つのpacket helper loggerは無効化されますが、次は残ります。

- Relay本体のdebug loggerへclient address、destination host／portを渡す経路
- parse失敗時の`dumpFailedBuffer`と`console.error`
- downstream login JWT、profile、skin dataのdecodeと保持
- upstream Authflowの認証cache
- decoded paramsを再serializeする中継方式
- packet改変、cancel、追加queue送信を許す公開API

環境変数でdebug出力を抑えるだけでは、将来の設定変更やerror pathでも秘密情報を出さない構造的保証になりません。

## 切断処理

標準Relayにはdownstream closeからupstream close、upstream closeからdownstream disconnectへ進む経路があります。
ただしGolden Captureが要求する「1件取得後、queueとtimerを破棄し、再送・再接続なしで必ず終了する」専用契約では
ありません。切断経路だけを理由に、他の不合格項目を許容しません。

## 再開条件

次のいずれかが一次根拠とoffline testで成立するまで実取得を再開しません。

1. 認証と中継を所有せず、専用test serverがserverbound interactionのallow-list projectionだけを直接提供する。
2. packet byte、login data、profile、endpointへcapture processがアクセスできず、改変・queue・send APIを型と
   process境界で持たない監査済みrelayが提供される。

どちらの場合も、1.26.30固定、最大1件、timeout、packet上限、disconnect cleanup、秘密情報検査をFakeと
専用テスト環境で検証し、別のADRで採用を決定します。

## 最終判定

- 標準`bedrock-protocol` Relay: **不採用**
- 新しいcustom proxyの推測実装: **実施しない**
- Golden Capture実server取得: **blocked**
- offline capture bridge／entrypoint: **維持**
- production block placement: **`unsupported`を維持**
