# 共通の安全制御

## 目的と現在の範囲

将来の作業executorが、runtimeとMinecraftの状態を個別に解釈して安全判断を迂回しないための
共通境界です。現在は純粋なdomain policyと、安全判定を通過した場合だけqueueをclaimする
application facadeを実装しています。Minecraft内の操作、executor、移動、採掘、設置、食事、
退避は実装していません。

## 判定入力

`DefaultWorkSafetyPolicy`はfreeze済み`StateSnapshot`だけを入力とし、開始前の`start`と、作業中の
各安全点で使用する`continue`を区別します。次を確認します。

- runtimeが`ready`
- Minecraft接続が`spawned`で、spawn完了済み
- 他playerを検知していない
- operatorまたはsignalによる停止要求がない
- 体力と空腹度が取得済みで有限かつ0～20の範囲内
- 体力が10以上、空腹度が6以上

安全値は設定で無効化できません。telemetryが未取得、不正、上限外の場合は推測で補完せず、
開始前は`block`、作業継続中は`stop`とするfail-closedです。閾値未満も同様です。

## 判定結果

判定結果は`allow`、`block`、`stop`と型付き理由を返します。接続準備中やtelemetry待ちは、状態が
安全になれば再評価できる一時的な`block`です。他player検知とoperator・signal停止は
`resumable: false`とし、同じprocessでの再開や再claimを認めません。

他player検知は他の停止条件より優先し、player名は判定入力、結果、queue、文書へ保存しません。
`debug` smokeは読み取り専用の観測専用例外であり、この作業実行境界へ接続しません。

## queueとの境界

executorは`TaskQueueService`を直接使用せず、`SafetyControlledTaskQueue`からclaimします。
facadeはclaim直前に最新snapshotを評価し、安全でない場合はRepositoryを呼びません。claim後は、
TOCTOU競合を閉じるため最新snapshotを再評価し、間に安全条件を失った場合はclaimed taskを即時に
stoppedへ終端化してexecutorへ返しません。Minecraftへ作用する各安全点の直前にも
`enforceContinuation`を呼ぶ設計とします。停止判定では
claimed taskを`stopped`へ終端化し、同一taskへの重複停止をプロセス内で抑制します。

現在の読み取り専用runtimeは`verify_arrival`と`record_position`だけを処理するqueue consumerを
この境界内で起動します。30秒のclaim leaseと期限切れ所有権の回収を実装済みですが、結果不明の
taskは自動再実行せずmanual reviewに残します。Minecraftへ作用するexecutorと分散worker間の
停止冪等性は後続工程です。

## 障害時の原則

- 不明なruntime状態、接続状態、telemetryは許可へ倒さない
- StateStoreが記録した停止理由がある間は作業を開始しない
- 他player検知後は再接続・再claim・作業再開しない
- 安全判定の失敗を理由にMinecraftの既存安全切断を待たせない
- 通知・DB障害から安全判定を変更しない
- 安全判定を無効化する環境変数やmodeを追加しない

閾値到達時の将来の回復動作（食事、退避、切断）と、体力・空腹度以外の危険入力は、実際の
Minecraft操作を設計・検証する後続工程で追加します。
