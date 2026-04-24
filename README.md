# Obsidian Bookshelf Plugin

ISBN から書籍メタデータを取得してノートを作成し、本棚として管理する Obsidian プラグインです。

## 機能

- ISBN から書籍メタデータを自動取得（NDL / Google Books / Open Library）
- 表紙画像のダウンロード・WebP 変換・キャッシュ
- Bases ファイルによる本棚ビュー（読みたい / 読書中 / 読了）
- 書籍ノートの手動入力・編集
- 表紙画像の手動設定（ドラッグ&ドロップ / クリップボード貼り付け対応）

## インストール

### 手動インストール

[Releases](../../releases) から最新の `main.js` / `manifest.json` / `styles.css` をダウンロードし、以下のフォルダに配置してください。

```
<Vault>/.obsidian/plugins/ob-book/
├── main.js
├── manifest.json
└── styles.css
```

### BRAT 経由

[BRAT](https://github.com/TfTHacker/obsidian42-brat) プラグインを使ってこのリポジトリを追加してください。

## 開発

### 必要環境

- Node.js 24 (LTS) 以上
- pnpm 9 以上

### セットアップ

```sh
pnpm install
```

### コマンド

| コマンド | 説明 |
| --- | --- |
| `pnpm dev` | esbuild の watch モードで開発ビルド |
| `pnpm build` | 型チェック + 本番ビルド（`main.js` を生成） |
| `pnpm typecheck` | TypeScript の型チェックのみ |
| `pnpm lint` | Biome で lint |
| `pnpm format` | Biome で format（`--write`） |
| `pnpm check` | Biome の lint + format を一括実行（`--write`） |
| `pnpm check:ci` | Biome チェック（変更なし） |

### リリース

Git タグを push すると GitHub Actions が `main.js` / `manifest.json` / `styles.css` をビルドし、Release にアタッチします。

```sh
# manifest.json の version を更新した後
git tag 1.0.1
git push origin 1.0.1
```

## ライセンス

MIT
