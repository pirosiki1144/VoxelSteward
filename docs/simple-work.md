# 簡単なMinecraft内作業

## 対象範囲

最初の作業domainは、ワールドのブロック、entity、inventoryを変更しない次の3種類だけを扱います。

- `navigate_to`: 同一dimensionの検証済み目標へ移動する
- `verify_arrival`: serverから観測した現在位置が指定範囲内か確認する
- `record_position`: serverから観測した現在位置を型付き結果として返す

攻撃、採掘、設置、item使用、視点操作、jump、dimension移動は対象外です。

## domain契約

すべての指示は内部`taskId`と固定の`taskType`を持ちます。`taskId`は128文字以下の英数字、
ピリオド、アンダースコア、ハイフンだけを許可し、player名やserver endpointを格納しません。
位置と移動上限は移動domainと同じ検証を再利用します。到達確認の許容差は有限の0以上1以下に
限定します。

結果は`completed`、`stopped`、`failed`の判別可能unionです。進捗は`validated`、
`executing`、`completed`、`stopped`、`failed`の型付き通知であり、永続化や外部送信を
domain自身では行いません。`record_position`は結果を返すだけで、保存先の選択は後続の
application／Repository境界に残します。

## application境界

`SimpleWorkCoordinator`は実装済み`MovementCoordinator.execute`と、server観測位置を返す
読み取り関数だけに依存します。

- `navigate_to`だけが検証後に`MovementCoordinator`へ委譲される
- `navigate_to`はserver観測originと同じdimension・同じYの水平目標だけを許可する
- `verify_arrival`と`record_position`はMovementPortを呼ばない
- 観測位置が未取得または不正ならfail-closedで失敗する
- 送信目標や推測位置を観測位置として扱わない

この境界はruntime、queue consumer、Minecraft connectionへ接続していません。したがって、
モジュールをimportしただけでtask claim、接続、移動、再接続が始まることはありません。
実runtimeへの登録、非移動taskのqueue終端化、位置記録のRepository保存は別工程です。

## 昇格条件

`navigate_to`をruntimeから実行可能にする前に、専用test serverで移動adapterの受入試験を完了し、
実接続とgame actionの承認を得ます。`verify_arrival`と`record_position`も、通常runtimeの
他player検知、SIGTERM、telemetry異常による停止経路を迂回するexecutorへ接続してはいけません。
