import { Notice, Plugin, type TFile } from "obsidian";
import { fetchByISBN } from "./book-api";
import { BookSelectModal } from "./book-select-modal";
import { createBookshelfFromCsv, exportIsbnsFromBackCovers } from "./bulk-import";
import { setManualCover } from "./image-cache";
import { addDescriptionsToKindleHighlights } from "./kindle-highlights";
import { updateBookMetadata } from "./note-creator";
import { BookshelfSettingTab } from "./settings";
import { type BookshelfSettings, DEFAULT_SETTINGS } from "./types";

export default class BookshelfPlugin extends Plugin {
	settings: BookshelfSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("scan-barcode", "裏表紙画像フォルダから ISBN 一覧 CSV を作成", () => {
			void exportIsbnsFromBackCovers();
		});
		this.addRibbonIcon("library-big", "ISBN 一覧 CSV から本棚を一括作成", () => {
			void createBookshelfFromCsv(this.app, this.settings);
		});
		this.addRibbonIcon("book-marked", "書籍ノートを編集", () => {
			new BookSelectModal(this.app, this.settings).open();
		});

		this.addCommand({
			id: "set-manual-cover",
			name: "表紙画像を手動で設定",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const cache = this.app.metadataCache.getFileCache(file);
				if (!cache?.frontmatter?.isbn) return false;
				if (!checking) {
					this.handleSetManualCover(file, cache.frontmatter.isbn);
				}
				return true;
			},
		});

		this.addCommand({
			id: "refresh-all-book-metadata",
			name: "全書籍の書籍情報・概要を再取得",
			callback: () => {
				void this.handleRefreshAllMetadata();
			},
		});

		this.addCommand({
			id: "add-descriptions-to-kindle-highlights",
			name: "Kindle Highlightsノートへ概要を一括追加",
			callback: () => {
				void addDescriptionsToKindleHighlights(
					this.app,
					this.settings.kindleHighlightsFolder,
					this.settings.googleBooksApiKey || undefined,
				);
			},
		});

		this.addSettingTab(new BookshelfSettingTab(this.app, this));

		await this.ensureBasesFile();
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.refreshBookshelfViewStyles();
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			this.refreshBookshelfViewStyles();
		});
	}

	onunload(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("bases")) {
			leaf.view.containerEl.removeClass("isbn-bulk-bookshelf-view");
		}
	}

	private refreshBookshelfViewStyles(): void {
		const bookshelfPath = `${this.settings.booksFolder}/本棚.base`;
		for (const leaf of this.app.workspace.getLeavesOfType("bases")) {
			const state = leaf.view.getState();
			leaf.view.containerEl.toggleClass("isbn-bulk-bookshelf-view", state.file === bookshelfPath);
		}
	}

	private async handleSetManualCover(file: TFile, isbn: string): Promise<void> {
		try {
			const vaultPath = await setManualCover(this.app, isbn, this.settings.coversFolder);
			if (!vaultPath) return;
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm.cover = vaultPath;
			});
			new Notice("表紙画像を設定しました。");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`エラー: ${message}`);
		}
	}

	private async handleRefreshAllMetadata(): Promise<void> {
		const books = this.app.vault.getMarkdownFiles().flatMap((file) => {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const isbn = typeof frontmatter?.isbn === "string" ? frontmatter.isbn : "";
			return isbn ? [{ file, isbn }] : [];
		});
		if (books.length === 0) {
			new Notice("ISBNを持つ書籍ノートがありません。");
			return;
		}
		const progress = new Notice(`書籍情報・概要を再取得中... 0/${books.length}`, 0);
		let succeeded = 0;
		let failed = 0;
		for (let index = 0; index < books.length; index++) {
			const { file, isbn } = books[index];
			progress.setMessage(
				`書籍情報・概要を再取得中... ${index + 1}/${books.length}\n${file.basename}`,
			);
			try {
				const metadata = await fetchByISBN(isbn, this.settings.googleBooksApiKey || undefined);
				await updateBookMetadata(this.app, file, metadata);
				succeeded++;
			} catch (error) {
				console.warn(`書籍情報の再取得に失敗しました: ${isbn}`, error);
				failed++;
			}
		}
		progress.hide();
		new Notice(
			`書籍情報・概要の再取得が完了しました。成功 ${succeeded}冊 / 失敗 ${failed}冊`,
			10000,
		);
	}

	private async ensureBasesFile(): Promise<void> {
		const basesPath = `${this.settings.booksFolder}/本棚.base`;
		if (await this.app.vault.adapter.exists(basesPath)) return;
		if (!(await this.app.vault.adapter.exists(this.settings.booksFolder))) {
			await this.app.vault.createFolder(this.settings.booksFolder);
		}
		const basesContent = `filters:
  and:
    - note.tags.contains("book")
views:
  - type: cards
    name: 本棚
    image: note.cover
    imageFit: contain
    cardSize: 180
    order:
      - title
      - author
      - status
      - progress
      - rating
  - type: cards
    name: 読みたい
    filters:
      and:
        - note.status == "to-read"
    image: note.cover
    imageFit: contain
    cardSize: 180
    order:
      - title
      - author
      - rating
  - type: cards
    name: 読書中
    filters:
      and:
        - note.status == "reading"
    image: note.cover
    imageFit: contain
    cardSize: 180
    order:
      - title
      - author
      - progress
  - type: cards
    name: 読了
    filters:
      and:
        - note.status == "completed"
    image: note.cover
    imageFit: contain
    cardSize: 180
    order:
      - title
      - author
      - rating
      - endDate
`;
		await this.app.vault.create(basesPath, basesContent);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
