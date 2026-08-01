# 要件

## 1. 目的と現在の対象範囲

VoxelStewardは、将来的にMinecraft Bedrock Dedicated Server（BDS）へ接続し、
制御された作業を実行します。現在のマイルストーンでは、TypeScriptの開発基盤、
運用ドキュメント、ヘルスチェックエンドポイント、およびテスト用BDSへ接続する
読み取り専用の通常運転ランタイムとスモークテスト、プロセス内の状態・進捗管理、
状態イベントを起点とするIncoming Webhook通知、任意有効化のMySQL状態・履歴保存、および
作業を実行しない型付き作業queue、および作業開始・継続をfail-closedで判定する共通安全境界を
提供します。Webhook通知は専用テスト環境、MySQL adapterは隔離ローカルDBで受入試験を
完了しています。

このマイルストーンの対象範囲外となる項目は次のとおりです。

- 自律的な判断またはゲーム内での行動
- 本番環境へのデプロイおよび本番環境の認証情報
- 作業executorと外部からの作業指示入力
- Discordの定時報告、永続配送、再起動をまたぐ重複防止、Bot APIによる双方向操作

## 1.1 長期的な製品範囲

将来は平日09:00～17:00（JST）に作業支援を行い、09:00～12:00と12:00～17:00を
作業時間単位とします。体力、空腹度、位置、作業状態、進捗、異常を記録し、Discord通知と
MySQL保存を段階的に追加します。道路作成、道路修繕、探索、安全化、整地、植林・伐採、
耕作・収穫は、安全制御と移動の検証完了後に実装します。

## 2. プラットフォーム

- Node.js 24 LTS
- TypeScriptおよびnpm
- ローカルサービス用として、WSL2上のUbuntuで動作するDocker Engineおよび
  Docker Compose
- Linux VPSまたはAWSのコンテナランタイムへ移行可能な設計
- 状態snapshot、変更履歴、作業checkpoint、通知outboxを保存するMySQL adapter
- 型付き指示、priority付きFIFO、取消、終端状態、有限試行を持つ作業queue

## 3. 安全要件

以下の要件は不変条件であり、任意機能ではありません。

1. 新しい動作は、本番環境へ導入する前に、隔離されたテストサーバーで検証しなければ
   なりません。
2. `normal`で他のプレイヤーを検知した場合は、現在のタスクを直ちに中断し、
   ログアウトを開始しなければなりません。読み取り専用の`debug`観測試験では参加・退出を
   記録し、接続を維持します。
3. 安全制御には、迂回手段や無効化スイッチを設けてはいけません。
4. BOTは原則として戦闘を回避し、交戦する代わりに退避または切断しなければなりません。
5. SIGTERMを受けた場合は、作業受付の停止、チェックポイントの永続化、切断、
   インスタンスロックの解放、終了の順に、安全な終了処理を開始しなければなりません。
6. リースまたはロックを使用し、2つのプロセスが同じBOT識別情報を操作することを
   防止しなければなりません。
7. 長時間実行する作業は、永続的なチェックポイントから再開できなければなりません。
8. 認証キャッシュは、ソースとは別のマウントされた実行時データ領域に保存し、
   commitしてはいけません。

本番環境を有効化するには、テスト用設定とは明確に分離されたデプロイ設定と、該当する
動作がテストサーバーでの検証に合格した証拠が必要です。

## 4. エンジニアリング要件

- ログは改行区切りのJSONとし、timestamp、level、event、コンテキスト情報のフィールドを
  含めます。秘密情報とアカウント情報はマスキングしなければなりません。
- プロセスはヘルスチェックエンドポイントを公開します。外部依存関係を導入した後は、
  生存状態と準備状態を分離しても構いません。
- データベースアクセスは`Repository`インターフェースの背後に隠蔽します。
- データベースのスキーマ変更は、バージョン管理されたマイグレーションで管理します。
- 設定は環境変数から受け取り、起動時に検証します。
- 認証情報、`.env`ファイル、認証キャッシュ、ログ、実行時データはGitの管理対象外と
  します。
- 中核となる動作は、Minecraftやデータベースがなくても単体テストできるようにします。
- スモークテストでは、プロトコル維持と切断に必要な応答以外の送信パケットを
  実装しません。
- 接続は1回だけ試行し、自動再接続しません。

上記の単発接続要件はsmokeに適用します。通常運転は設定された上限回数だけ、一時的な
切断または構造化された一時ネットワークエラーから再接続します。他プレイヤー検知、
シグナル、設定エラー、認証を含む回復不能エラーでは再接続しません。

## 5. 初期受け入れ基準

- ドキュメントに記載されたプロジェクト構成が存在すること。
- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`が成功すること。
- build済みのプログラムを起動すると、`GET /health`を提供し、構造化ログを出力すること。
- SIGTERMによってヘルスチェックサーバーが正常に終了すること。
- 本番環境の秘密情報を埋め込まずに、Docker Composeでスモークテストと永続的な
  認証volumeを定義できること。

## 6. スモークテストの受け入れ基準

- bedrock-protocolがサーバー広告から対応バージョンを自動判定できること。
- Microsoftのdevice code認証キャッシュをBOTアカウント単位の名前付きDocker volumeへ
  保存できること。
- ログイン完了とスポーン完了を区別して検知できること。
- BOT名、ディメンション、座標、体力、空腹度、プレイヤー一覧について、受信済みの値
  だけを記録すること。
- `normal`で他プレイヤーを検知した場合は安全に切断すること。
- `debug`では他プレイヤーの参加・退出および接続継続を記録し、接続を維持すること。
- タイムアウト、SIGINT、SIGTERM、エラーで切断処理が一度だけ実行されること。

## 7. 通常運転の受け入れ基準

- `normal`固定の読み取り専用接続としてスポーン後も待機すること。
- スポーン時または接続後の他プレイヤー検知で、終了コード0として安全に切断すること。
- 一時切断は上限付き指数バックオフで再接続し、上限到達時は終了コード1とすること。
- SIGINTとSIGTERMは待機中・再接続待ち中のどちらでも再接続を中止し、安全に終了すること。
- Dockerの再起動ポリシーによって安全停止後の無限再起動を行わないこと。

## 8. 状態・進捗管理要件

- runtime、Minecraft接続、spawn、位置、体力、空腹度、他プレイヤー検知を保持すること。
- 作業ID、拡張可能な作業種別、作業状態、開始・更新・終了時刻、進捗値、進捗メッセージを
  保持すること。
- 作業状態は`idle`、`preparing`、`running`、`paused`、`completed`、`failed`、
  `stopped`を扱うこと。
- 現在状態をスナップショットとして取得し、変化をイベントとして購読できること。
- 同一状態の重複イベントを抑制し、不正遷移を拒否または検出すること。
- 内部時刻をUTCで保持し、表示側でJSTへ変換できること。
- subscriberの障害がruntimeの安全停止や他subscriberを妨げないこと。
- プレイヤー名、サーバー接続情報、認証情報を状態へ保存しないこと。
- DiscordとMySQLはMinecraft接続へ直結せず、同じ状態イベントだけを購読すること。
- 作業queueのclaimだけではMinecraft操作を開始せず、executorと共通安全制御を別工程とすること。
- MySQL保存はrun IDとrevisionで順序・冪等性を確保し、同一transactionでsnapshot、履歴、
  checkpoint、outboxを更新すること。
- DB障害は安全停止を妨げず、StateStoreへ再帰dispatchしないこと。
- DB無効時は接続せず、有効時の不正設定はMinecraft接続前に拒否すること。
- スナップショットと変更イベントはネストした値を含め外部から変更できないこと。
- 他プレイヤー検知、停止理由、停止遷移を単一の状態変更として通知すること。
- subscriberは非同期に呼び出し、その例外やrejectionを観測可能な形で隔離すること。
- 状態へ記録するエラーは機械判定用codeとサニタイズ済みmessageに限定し、生のError、
  stack、接続文字列を受け取らないこと。

## 9. 通知基盤要件

- 状態変更イベントを通知の唯一の起点とし、Minecraftイベントから外部送信を直接行わないこと。
- 通知送信を`NotificationPort`で抽象化し、状態domainへ外部サービス固有型を持ち込まないこと。
- 通知には決定論的ID、元revision、type、severity、UTC時刻、固定title・bodyを含めること。
- 他プレイヤー検知は名前を含めず、緊急停止通知1件へ変換すること。
- telemetryと自由入力の進捗messageを更新ごとに通知しないこと。
- 同じrevision・notificationIdと古いrevisionを同一プロセス内で重複配送しないこと。
- 重複履歴へ上限を設け、無制限にメモリを消費しないこと。
- 通知をrevision順に直列処理し、送信失敗をruntimeと安全切断から隔離すること。
- 通知無効時は外部送信を行わないNo-opを選び、Fakeはテストからのみ注入すること。
- Discord通知有効時だけ、起動時に検証したIncoming Webhookへ固定テンプレートを配送すること。
- Webhook URL、token、接続先、プレイヤー名、生Error、応答本文を通知やログへ含めないこと。
- Discord配送は1試行5秒、最大3試行、総15秒を上限とし、429の待機指定と限定した一時障害
  だけを再試行すること。
- 通知配送と待機はruntime終了時に中断し、安全切断やプロセス終了を待たせないこと。

## 10. 作業指示と作業キュー要件

- 指示は型付きフィールドだけを持ち、任意payload、player名、BOT情報、server情報、credentialを
  保存しないこと。
- priorityの高い順、同順位はFIFOでclaimし、同じtask IDのenqueueを冪等に扱うこと。
- queued、claimed、completed、failed、stopped、cancelledの遷移を明示commandで検証すること。
- 再キュー回数へ上限を設け、上限到達後はfailedへ終端化して無制限再試行しないこと。
- Repository境界を介して永続化し、並行workerが同じ指示を二重claimしないこと。
- claimはMinecraft操作を開始せず、executorと共通安全制御の実装完了まで読み取り専用runtimeへ
  接続しないこと。
- 実Webhook資格情報は実行環境だけで管理すること。設定済みWebhookと固定templateによる
  開発・テスト・受入送信は、回数、timeout、retryを制限し、秘密情報を送信せず、
  Minecraftの安全処理から隔離すること。
- Discordの定時報告、再起動後の重複防止、永続配送保証は別工程とすること。

## 11. 共通安全制御要件

- 将来executorはStateStore snapshotを入力とする共通policyを経由し、個別adapterやtask実装で
  作業開始・継続の安全判断を再実装しないこと。
- runtime ready、Minecraft spawned、spawn完了、他player未検知、停止要求なし、正常な体力・
  空腹度をすべて満たした場合だけ作業開始を許可すること。
- telemetryの未取得、非有限、0～20の範囲外をfail-closedで扱い、推測値で補完しないこと。
- 最小安全値は体力10、空腹度6とし、迂回用の環境変数やmodeを設けないこと。
- 開始前の一時的な未準備はblock、作業中の安全条件喪失はstopとして区別すること。
- 他player検知とoperator・signal停止は非再開可能とし、同じprocessで再claimしないこと。
- 同一taskへの停止要求を重複処理せず、既存の安全切断や上限付き再接続を妨げないこと。
- `debug` smokeの観測継続は読み取り専用試験だけに限定し、作業実行の安全policyへ適用しないこと。
- 現工程ではMinecraft操作、executor、回復行動、外部指示入力を実装しないこと。

## 12. 移動基盤要件

- 移動指示は現在位置、目標位置、dimension、最大step距離、最大step数、1 step timeout、到達許容差を
  型付きで表現すること。
- 非有限・範囲外座標、異dimension、無効な上限、最大step数を超えるplanを送信前に拒否すること。
- 移動は有限stepへ分割し、各stepの前後で共通安全policyを最新snapshotに対して評価すること。
- 各stepの観測位置をstep目標と照合し、許容差超過またはdimension不一致では後続stepを送らないこと。
- 安全条件喪失、cancel、signal/operator停止後は新規stepを送らず、portの停止を多重実行しないこと。
- timeout、port障害、不正な観測位置を安全な結果へ分類し、stepを無制限にretryしないこと。
- 正常経路ではStateStoreと永続queueの作業状態をcompleted、failed、stoppedのいずれかへ各1回だけ
  終端化すること。外部Repository障害は`finalization_error`で有限終了し、自動再実行しないこと。
- domain/applicationはBedrock packetへ依存せず、実送信を`MovementPort`のadapterへ限定すること。
- 実adapterが未検証の間は通常runtimeへ接続せず、読み取り専用動作を維持すること。
- 視点変更、jump、採掘、設置、攻撃、item、chat、commandを移動基盤へ含めないこと。
- `player_auth_input`はallow-list済みversionとschemaでのみ生成し、必須field、有限値、単調tickを
  送信前に検証すること。item・block等のconditional fieldと対象外input flagを生成しないこと。
- 送信した申告位置を到達結果にせず、own entityのserver観測だけを正本とすること。server補正、
  dimension不一致、切断、Abort後は後続packetを送らないこと。
- frame生成規則が実サーバーで未検証の間は通常runtimeのmovement bindingを無効のまま維持し、
  queue consumerや実行機能を自動開始しないこと。

## 13. 簡単な作業domain要件

- 最初の作業種別は`navigate_to`、`verify_arrival`、`record_position`だけとし、任意payloadを許可しないこと。
- `navigate_to`だけが共通安全policy付きMovementCoordinator境界へ委譲できること。
- `navigate_to`はserver観測originと同じdimension・同じYの水平移動だけに限定すること。
- 到達確認と位置記録はserver観測位置だけを使用し、観測欠損・不正値をfail-closedで扱うこと。
- block、entity、inventory、視点、jump、chatを変更する指示を型で表現しないこと。
- runtime consumer、外部指示API、実Minecraft操作は別工程とし、自動開始しないこと。

## 14. 最初のblock操作要件

- 最初のblock変更は、airと観測した1座標へのdirt 1個配置だけを型付きで表現すること。
- target、直下support、同一dimension、整数座標、最大3 blockのreach、有限timeoutを検証すること。
- 配置要求は1回だけとし、timeout、disconnect、Abort、結果不明時に自動再試行しないこと。
- server観測した同一座標のdirtだけを成功とし、client申告値やinventory変化だけで完了しないこと。
- 指示はversion付きstrict codecで完全復元し、未知version、余分なfield、ID・type不一致を拒否すること。
- 世界変更要求の直前を永続化し、claimedまたは送信結果不明の指示を再起動後に自動再送しないこと。
- schema serialize成功だけで実adapterを有効化せず、item同定、face、transaction envelope、authoritative
  frameの意味論が確定しない場合は`unsupported`を維持すること。
- 実adapter未対応時はfail-closedとし、runtimeの既定をdisabledに保つこと。
- movementとblock placementは同じauthoritative frame streamを排他所有し、stale観測、tick重複・逆行、
  dimension不一致、reach超過、安全停止後のframeを拒否すること。
- 専用配置acceptanceは既定無効、normal固定、operator確認、1 task・1座標・1試行に限定し、capability
  unsupported時はInstanceLock・client生成・接続より前に停止すること。

## 15. Bedrock world・inventory観測要件

- 固定protocol versionのserver受信packetだけを観測元とし、生packetをdomainへ渡さないこと。
- spawn前、dimension移行中、disconnect後の観測を利用不能にすること。
- block観測はdimension付き整数座標、runtime ID、air判定、UTC観測時刻、sourceに限定すること。
- block cacheは上限を持ち、dimension変更とdisconnectで破棄すること。
- held itemはown entityのselected slot、network ID、count、block runtime ID、schema上存在するstack ID
  だけを保持し、NBT、表示名、lore、player情報を保存しないこと。
- schemaから確定できないfull inventoryとstack IDを推測せず`unsupported`としてfail-closedにすること。
- 1.26.30の`item_registry`を接続generationごとに検証し、重複・不正・dirt欠落時は利用不能にすること。
- registryから保持するitem mappingは`minecraft:dirt`だけとし、NBTやcustom item名を保存しないこと。
- `ItemNew`からtransaction候補へ使う値はmetadata、stack ID、block runtime ID、空extraをallow-list検査し、
  欠損やopaque dataがある場合は利用不能にすること。
- item network IDとblock runtime IDを混同しないこと。
- face数値またはtransaction envelopeの選択を固定schemaで確定できない間は実adapterを有効化しないこと。
- snapshotとeventを実行時にも変更不能にし、同値更新と古いsequenceのeventを抑制すること。
- subscriber障害をruntime安全動作から隔離し、unsubscribeとcloseでlistenerを解放すること。

## 16. 開発エージェントの実行権限要件

- [開発権限と承認ゲート](project/governance.md)を運用権限の正式な情報源とすること。
- ロードマップまたは依頼範囲内の編集、固定version依存追加、ローカル検証、隔離Docker
  service、ローカルテストDB、条件付きDiscord送信、検証済みlocal commitを自律実行できること。
- 実Minecraft接続とgame操作、外部・共有DB、本番・cloud変更、認証volume変更、remote Git
  操作、主要architectureまたは安全境界の変更は事前承認を必要とすること。
- `.env`、credential、Webhook URL、player名、BOT情報、server endpointを表示、記録、
  test fixture化、Discord送信、commitしないこと。
- Codexの上位policy、sandbox、実行環境を回避しないこと。ただし、自律実行可能なlocal service、
  localhost統合test、image build、明示stage、local commitについては、sandbox権限を理由とする
  会話上の再承認を求めず、必要最小限の権限昇格をautomatic reviewerへ直接提出すること。
- 上位system自身が人間判断を強制する場合を除き、自律範囲の作業を冗長な承認待ちで停止しないこと。
