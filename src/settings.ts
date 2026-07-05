import { type App, PluginSettingTab, Setting, TFolder } from "obsidian";
import { testGoogleBooksApiKey } from "./book-api";
import type BookshelfPlugin from "./main";
import type { BookStatus, DuplicateIsbnAction } from "./types";

// The declarative settings API requires Obsidian 1.13; this plugin supports minAppVersion 1.9.0.
export class BookshelfSettingTab extends PluginSettingTab {
	plugin: BookshelfPlugin;

	constructor(app: App, plugin: BookshelfPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("全般").setHeading();

		new Setting(containerEl)
			.setName("書籍ノートの保存フォルダ")
			.setDesc("書籍ノートを保存するフォルダのパス（Vault ルートからの相対パス）")
			.addText((text) =>
				text
					.setPlaceholder("Books")
					.setValue(this.plugin.settings.booksFolder)
					.onChange(async (value) => {
						this.plugin.settings.booksFolder = value.trim() || "Books";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("表紙画像のキャッシュフォルダ")
			.setDesc("表紙画像（WebP）を保存するフォルダのパス")
			.addText((text) =>
				text
					.setPlaceholder("Books/covers")
					.setValue(this.plugin.settings.coversFolder)
					.onChange(async (value) => {
						this.plugin.settings.coversFolder = value.trim() || "Books/covers";
						await this.plugin.saveSettings();
					}),
			);

		const kindleFolders = this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder && file.path !== "/")
			.map((folder) => folder.path)
			.sort((left, right) => left.localeCompare(right, "ja"));
		if (
			this.plugin.settings.kindleHighlightsFolder &&
			!kindleFolders.includes(this.plugin.settings.kindleHighlightsFolder)
		) {
			kindleFolders.unshift(this.plugin.settings.kindleHighlightsFolder);
		}
		new Setting(containerEl)
			.setName("Kindle Highlightsノートのフォルダ")
			.setDesc("概要を一括追加するKindle Highlightsノートの保存フォルダ")
			.addDropdown((dropdown) => {
				for (const folder of kindleFolders) {
					dropdown.addOption(folder, folder);
				}
				dropdown.setValue(this.plugin.settings.kindleHighlightsFolder).onChange(async (value) => {
					this.plugin.settings.kindleHighlightsFolder = value;
					await this.plugin.saveSettings();
				});
			});

		const googleBooksSetting = new Setting(containerEl)
			.setName("Google Books API キー（任意）")
			.setDesc("レート制限を緩和するために任意で設定できます");
		googleBooksSetting
			.addText((text) =>
				text
					.setPlaceholder("AIza...")
					.setValue(this.plugin.settings.googleBooksApiKey)
					.onChange(async (value) => {
						this.plugin.settings.googleBooksApiKey = value.trim();
						await this.plugin.saveSettings();
					}),
			)
			.addButton((button) =>
				button.setButtonText("APIキーをテスト").onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("確認中...");
					apiStatusEl.setText("Google Books APIへ接続しています...");
					apiStatusEl.removeClass("is-success", "is-error");
					const result = await testGoogleBooksApiKey(this.plugin.settings.googleBooksApiKey);
					apiStatusEl.setText(result.message);
					apiStatusEl.addClass(result.status === "success" ? "is-success" : "is-error");
					button.setButtonText("APIキーをテスト");
					button.setDisabled(false);
				}),
			);
		const apiStatusEl = containerEl.createDiv("bookshelf-api-test-status");

		new Setting(containerEl)
			.setName("重複 ISBN 時の動作")
			.setDesc("同じ ISBN のノートが既に存在する場合の動作を選択してください")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("open", "既存ノートを開く")
					.addOption("overwrite", "既存ノートを上書き")
					.addOption("create-new", "新規ノートを作成")
					.setValue(this.plugin.settings.duplicateIsbnAction)
					.onChange(async (value) => {
						this.plugin.settings.duplicateIsbnAction = value as DuplicateIsbnAction;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("デフォルトステータス")
			.setDesc("新規書籍ノート作成時の初期ステータス")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("to-read", "読みたい")
					.addOption("reading", "読書中")
					.addOption("completed", "読了")
					.addOption("abandoned", "中断")
					.setValue(this.plugin.settings.defaultStatus)
					.onChange(async (value) => {
						this.plugin.settings.defaultStatus = value as BookStatus;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("デフォルト進捗 (%)")
			.setDesc("新規書籍ノート作成時の初期進捗")
			.addSlider((slider) =>
				slider
					.setLimits(0, 100, 1)
					.setValue(this.plugin.settings.defaultProgress)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.defaultProgress = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
