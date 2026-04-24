import { Notice, Plugin, type TFile } from "obsidian";
import { fetchByISBN } from "./book-api";
import { BookSelectModal } from "./book-select-modal";
import { EditBookModal } from "./edit-modal";
import { setManualCover } from "./image-cache";
import { ISBNModal } from "./isbn-modal";
import { updateBookNote } from "./note-creator";
import { BookshelfSettingTab } from "./settings";
import { type BookshelfSettings, DEFAULT_SETTINGS } from "./types";

export default class BookshelfPlugin extends Plugin {
	settings: BookshelfSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("book-open", "ISBN から本を追加", () => {
			new ISBNModal(this.app, this.settings).open();
		});
		this.addRibbonIcon("book-marked", "書籍ノートを編集", () => {
			new BookSelectModal(this.app, this.settings).open();
		});

		this.addCommand({
			id: "add-book-by-isbn",
			name: "ISBN から本を追加",
			callback: () => {
				new ISBNModal(this.app, this.settings).open();
			},
		});

		this.addCommand({
			id: "update-book-note",
			name: "書籍ノートを更新",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const cache = this.app.metadataCache.getFileCache(file);
				if (!cache?.frontmatter?.isbn) return false;
				if (!checking) {
					this.handleUpdateNote(file, cache.frontmatter.isbn);
				}
				return true;
			},
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
			id: "edit-book-note",
			name: "書籍ノートを編集",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const cache = this.app.metadataCache.getFileCache(file);
				const fm = cache?.frontmatter;
				const isBook =
					fm && (fm.isbn !== undefined || (Array.isArray(fm.tags) && fm.tags.includes("book")));
				if (!isBook) return false;
				if (!checking) {
					new EditBookModal(this.app, file, fm, this.settings).open();
				}
				return true;
			},
		});

		this.addCommand({
			id: "select-and-edit-book-note",
			name: "書籍ノートを選択して編集",
			callback: () => {
				new BookSelectModal(this.app, this.settings).open();
			},
		});

		this.addSettingTab(new BookshelfSettingTab(this.app, this));

		await this.ensureBasesFile();
	}

	onunload(): void {}

	private async handleUpdateNote(_file: TFile, isbn: string): Promise<void> {
		try {
			new Notice("書籍情報を取得中...");
			const metadata = await fetchByISBN(isbn, this.settings.googleBooksApiKey || undefined);
			await updateBookNote(this.app, metadata, this.settings);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`エラー: ${message}`);
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

	private async ensureBasesFile(): Promise<void> {
		const basesPath = `${this.settings.booksFolder}/本棚.base`;
		if (await this.app.vault.adapter.exists(basesPath)) return;
		if (!(await this.app.vault.adapter.exists(this.settings.booksFolder))) {
			await this.app.vault.createFolder(this.settings.booksFolder);
		}
		const basesContent = JSON.stringify(
			{
				filters: {
					conditions: [{ field: "tags", operator: "contains", value: "book" }],
				},
				views: [
					{
						type: "cards",
						name: "本棚",
						coverField: "cover",
						fields: ["title", "author", "status", "progress", "rating"],
					},
					{
						type: "cards",
						name: "読みたい",
						coverField: "cover",
						fields: ["title", "author", "rating"],
						filters: {
							conditions: [
								{ field: "tags", operator: "contains", value: "book" },
								{ field: "status", operator: "equals", value: "to-read" },
							],
						},
					},
					{
						type: "cards",
						name: "読書中",
						coverField: "cover",
						fields: ["title", "author", "progress"],
						filters: {
							conditions: [
								{ field: "tags", operator: "contains", value: "book" },
								{ field: "status", operator: "equals", value: "reading" },
							],
						},
					},
					{
						type: "cards",
						name: "読了",
						coverField: "cover",
						fields: ["title", "author", "rating", "endDate"],
						filters: {
							conditions: [
								{ field: "tags", operator: "contains", value: "book" },
								{ field: "status", operator: "equals", value: "completed" },
							],
						},
					},
				],
			},
			null,
			2,
		);
		await this.app.vault.create(basesPath, basesContent);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
