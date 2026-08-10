# 検証環境向け通常runtime構成

## 対象

Issue #4では、既存の読み取り専用通常runtimeを検証環境で再現可能に起動するCompose境界を
追加しました。実Minecraft接続はこの検証記録の対象外です。

## 固定する条件

- `BOT_MODE=normal`
- `MYSQL_PERSISTENCE_ENABLED=true`
- `restart: "no"`
- 基底runtimeと同じread-only filesystem、非root user、InstanceLock、account別認証volume
- `--no-deps runtime`による単一Minecraft接続serviceの選択

## Offline・隔離検証

- 空のenv fileによるCompose構文検査
- 解決後Compose modelのnormal、MySQL有効、非再起動、read-only user、認証volume検査
- runtimeとsmokeのDocker image build
- Fake接続によるspawn、telemetry、SIGTERM、安全切断、listener・timer解放
- 隔離MySQLによる接続から停止までのrevision順履歴、checkpoint、通知outbox保存
- task復旧監査、完了済みtaskの非再実行、claimed残留のmanual review分類

構成検査、Fake、隔離MySQLではMinecraftへ接続しません。server endpoint、credential、player名、
BOT情報は入力、出力、fixture、文書へ含めません。

## 実接続gate

実Minecraft接続は別途承認を得た専用test serverに限定します。設定済み`.env`と既存認証volumeを
変更せず、runtime 1 serviceだけを1回起動します。SIGTERM、他player検知、DB障害時の安全切断を
確認し、認証volumeを削除しません。
