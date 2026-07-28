# VoxelSteward

VoxelStewardは、安全性を重視したMinecraft Bedrock Dedicated Server（BDS）向け
自動化クライアントの基盤です。このマイルストーンには、TypeScriptツールチェーン、
ドキュメント、起動・終了時の構造化ログ、HTTPヘルスチェックエンドポイント、
ローカル環境用のPostgreSQL Composeサービスが含まれます。現時点ではMinecraftへの
接続や自律動作は**行いません**。

## 前提環境

- Node.js 24 LTS
- npm 11以降
- Ubuntu/WSL2上のDocker EngineおよびDocker Compose（データベース用）

## セットアップ

```bash
npm install
cp .env.example .env
npm run typecheck
npm run lint
npm test
npm run build
```

最小構成のサービスを起動します。

```bash
npm start
curl http://127.0.0.1:3000/health
```

将来の開発で使用するデータベースを起動します。

```bash
docker compose up -d db
```

現在のアプリケーションは、このデータベースには接続しません。このサービス定義は、
ローカルインフラストラクチャの基本構成をあらかじめ整えるために用意しています。

## スクリプト

- `npm run build` — TypeScriptをコンパイルし、`dist/`へ出力します
- `npm run typecheck` — ファイルを出力せずに型を検査します
- `npm run lint` — ESLintを実行します
- `npm test` — Vitestを1回実行します
- `npm run format` — Prettierで対応ファイルを整形します
- `npm run format:check` — ファイルが整形済みか確認します

## 安全性

本番環境で使用できる段階には達していません。将来実装する動作は、専用のテストサーバー
で事前に検証する必要があります。BOTは、他のプレイヤーを検知した場合に作業を中断して
ログアウトし、戦闘を回避し、チェックポイントを保存し、同時に複数のプロセスから操作
されることを防止し、SIGTERMを受けた場合に安全に終了しなければなりません。これらの
安全制御を迂回してはいけません。

`.env`、認証情報、Minecraftアカウント情報、認証キャッシュ、実行時データ、ログは
commitしないでください。

詳しくは、[要件](docs/requirements.md)、[アーキテクチャ](docs/architecture.md)、
[運用手順](docs/operations.md)、[技術的な意思決定](docs/decisions.md)を参照してください。
