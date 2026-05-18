import { type App, FuzzySuggestModal, type TFile } from "obsidian";
import { EditBookModal } from "./edit-modal";
import type { BookNoteFrontmatter, BookshelfSettings } from "./types";

export class BookSelectModal extends FuzzySuggestModal<TFile> {
	private settings: BookshelfSettings;

	constructor(app: App, settings: BookshelfSettings) {
		super(app);
		this.settings = settings;
		this.setPlaceholder("書籍ノートを検索...");
	}

	getItems(): TFile[] {
		const isBookNote = (file: TFile): boolean => {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter;
			return !!fm && (fm.isbn !== undefined || (Array.isArray(fm.tags) && fm.tags.includes("book")));
		};
		const items = this.app.vault.getMarkdownFiles().filter(isBookNote);
		const active = this.app.workspace.getActiveFile();
		if (active && isBookNote(active)) {
			const rest = items.filter((f) => f.path !== active.path);
			return [active, ...rest];
		}
		return items;
	}

	getItemText(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		const title = fm?.title ? String(fm.title) : file.basename;
		const hasCover = !!fm?.cover;
		return hasCover ? title : `${title} (表紙なし)`;
	}

	onChooseItem(file: TFile): void {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as BookNoteFrontmatter;
		new EditBookModal(this.app, file, fm, this.settings).open();
	}
}
