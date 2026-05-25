# Easy Bookshelf

An Obsidian plugin that fetches book metadata from ISBN and helps you manage your personal bookshelf as notes.

## Features

- **Fetch book metadata by ISBN** from NDL (National Diet Library of Japan), Google Books, and Open Library
- **Automatic cover image download** with WebP conversion and local caching
- **Bookshelf views via Bases** (Want to read / Reading / Finished)
- **Manual entry and editing** of book notes
- **Manual cover image** (drag & drop, clipboard paste, or file picker)

## Installation

### From the Obsidian Community Plugins (planned)

Search for `Easy Bookshelf` in **Settings → Community plugins** and install.

### Manual installation

Download the latest `main.js`, `manifest.json`, and `styles.css` from the [Releases](../../releases) page and place them in:

```
<Vault>/.obsidian/plugins/easy-obookshelf/
├── main.js
├── manifest.json
└── styles.css
```

Then enable **Easy Bookshelf** in **Settings → Community plugins**.

### Via BRAT

Add this repository through the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.

## Usage

1. Click the **book-open** ribbon icon, or run the command **"Add book by ISBN"**.
2. Enter an ISBN. Metadata and cover are fetched automatically and a new note is created in your configured bookshelf folder.
3. Use the **book-marked** ribbon icon to edit an existing book note.
4. Update an existing note's metadata via the **"Update book note"** command.
5. Replace the cover image via the **"Set cover image manually"** command.

## Requirements

- Desktop only (uses Electron file dialog and local filesystem for cover caching).

## Network use

This plugin makes HTTPS requests to the following public services to fetch book metadata and cover images by ISBN. No personal data is sent — only the ISBN you enter.

- **NDL (National Diet Library of Japan)** — `https://ndlsearch.ndl.go.jp` — primary metadata source for Japanese books.
- **Google Books API** — `https://www.googleapis.com/books/v1` — fallback metadata source.
- **Open Library** — `https://openlibrary.org` and `https://covers.openlibrary.org` — final fallback for metadata and cover images.

All requests are issued through Obsidian's `requestUrl` API and are only triggered by an explicit user action (entering an ISBN). No background or telemetry traffic is generated.

## File system access

On desktop, the **"Set cover image manually"** command opens an Electron file picker so you can choose an image from anywhere on your local disk. The selected file is read once via Node `fs`, converted to WebP, and saved into your vault's configured covers folder. The plugin does not retain any path outside your vault.

## Development

### Prerequisites

- Node.js 24 (LTS) or later
- pnpm 9 or later

### Setup

```sh
pnpm install
```

### Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Build in watch mode |
| `pnpm build` | Type check + production build (emits `main.js`) |
| `pnpm typecheck` | TypeScript type check only |
| `pnpm lint` | Run Biome lint |
| `pnpm format` | Run Biome format (`--write`) |
| `pnpm check` | Run Biome lint + format (`--write`) |
| `pnpm check:ci` | Run Biome checks without writing |

### Releasing

Push a Git tag (matching the `manifest.json` version, **no `v` prefix**) and the GitHub Actions release workflow will build and attach `main.js`, `manifest.json`, and `styles.css` to the release.

```sh
# After bumping manifest.json and package.json
git tag 1.1.1
git push origin 1.1.1
```

## Migration from `ob-book` (v1.0.x)

Starting with v1.1.0, the plugin ID has changed from `ob-book` to `easy-obookshelf` to comply with Obsidian's naming guidelines. To migrate:

1. Disable and remove the old `ob-book` plugin from **Settings → Community plugins**.
2. Delete the `<Vault>/.obsidian/plugins/ob-book/` folder.
3. Install `easy-obookshelf` (see Installation above).
4. Existing book notes and cover images in your vault are not affected — only the plugin folder name changes.

## License

[MIT](./LICENSE)

---

## 日本語

ISBN から書籍メタデータを取得してノートを作成し、本棚として管理する Obsidian プラグインです。

### 主な機能

- ISBN からの自動メタデータ取得（NDL / Google Books / Open Library）
- 表紙画像のダウンロード・WebP 変換・キャッシュ
- Bases ファイルによる本棚ビュー（読みたい / 読書中 / 読了）
- 書籍ノートの手動入力・編集
- 表紙画像の手動設定（ドラッグ&ドロップ / クリップボード貼り付け対応）

### 手動インストール

[Releases](../../releases) から `main.js` / `manifest.json` / `styles.css` をダウンロードし、`<Vault>/.obsidian/plugins/easy-obookshelf/` に配置してください。

### v1.0.x からの移行

v1.1.0 でプラグイン ID が `ob-book` → `easy-obookshelf` に変更されました。旧プラグインを削除し、新フォルダ名で再インストールしてください。Vault 内の書籍ノート・表紙画像はそのまま使えます。
