import { type App, PluginSettingTab, Setting } from "obsidian";
import type BookshelfPlugin from "./main";
import type { DuplicateIsbnAction } from "./types";

export class BookshelfSettingTab extends PluginSettingTab {
	plugin: BookshelfPlugin;

	constructor(app: App, plugin: BookshelfPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Bookshelf 設定" });

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

		new Setting(containerEl)
			.setName("Google Books API キー（任意）")
			.setDesc("レート制限を緩和するために任意で設定できます")
			.addText((text) =>
				text
					.setPlaceholder("AIza...")
					.setValue(this.plugin.settings.googleBooksApiKey)
					.onChange(async (value) => {
						this.plugin.settings.googleBooksApiKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

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
	}
}
