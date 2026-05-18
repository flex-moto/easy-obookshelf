import { type App, Modal, Notice, Setting, TFile } from "obsidian";
import { saveCoverFromFileObject } from "./image-cache";
import type { BookNoteFrontmatter, BookshelfSettings } from "./types";

function normalizeDate(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) return input;
	const parts = trimmed.split(/[-/]/);
	if (parts.length !== 3) return input;
	const [y, m, d] = parts;
	if (!/^\d+$/.test(y) || !/^\d+$/.test(m) || !/^\d+$/.test(d)) return input;
	let year = y;
	if (year.length === 2) year = `20${year}`;
	else if (year.length !== 4) return input;
	if (m.length > 2 || d.length > 2) return input;
	return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function todayYmd(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export class EditBookModal extends Modal {
	private file: TFile;
	private fm: BookNoteFrontmatter;
	private settings: BookshelfSettings;
	private pasteHandler: ((e: ClipboardEvent) => void) | null = null;

	constructor(app: App, file: TFile, fm: BookNoteFrontmatter, settings: BookshelfSettings) {
		super(app);
		this.file = file;
		this.fm = fm;
		this.settings = settings;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("bookshelf-modal");
		contentEl.createEl("h2", { text: "書籍ノートを編集" });

		let newCoverFile: File | null = null;

		const formEl = contentEl.createDiv("bookshelf-manual-form");
		const dropzoneEl = formEl.createDiv("bookshelf-dropzone");
		const dropzoneText = dropzoneEl.createDiv({
			cls: "bookshelf-dropzone-text",
			text: "表紙画像をドロップ / クリック / Ctrl+V で貼り付け",
		});

		let previewImg: HTMLImageElement | null = null;
		const coverPath = String(this.fm.cover || "");
		const coverTFile = coverPath ? this.app.vault.getAbstractFileByPath(coverPath) : null;
		if (coverTFile instanceof TFile) {
			dropzoneText.style.display = "none";
			previewImg = dropzoneEl.createEl("img");
			previewImg.src = this.app.vault.getResourcePath(coverTFile);
		}

		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".jpg,.jpeg,.png,.webp";
		fileInput.style.display = "none";
		contentEl.appendChild(fileInput);

		const setPreviewFile = (file: File) => {
			newCoverFile = file;
			const objectUrl = URL.createObjectURL(file);
			if (previewImg) {
				previewImg.src = objectUrl;
			} else {
				dropzoneText.style.display = "none";
				previewImg = dropzoneEl.createEl("img");
				previewImg.src = objectUrl;
			}
		};

		this.pasteHandler = (e: ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;
			for (const item of Array.from(items)) {
				if (item.type.startsWith("image/")) {
					const file = item.getAsFile();
					if (file) {
						setPreviewFile(file);
						e.preventDefault();
					}
					break;
				}
			}
		};
		document.addEventListener("paste", this.pasteHandler);

		dropzoneEl.addEventListener("click", () => fileInput.click());
		fileInput.addEventListener("change", () => {
			const file = fileInput.files?.[0];
			if (file) setPreviewFile(file);
		});
		dropzoneEl.addEventListener("dragover", (e) => {
			e.preventDefault();
			dropzoneEl.addClass("drag-over");
		});
		dropzoneEl.addEventListener("dragleave", () => {
			dropzoneEl.removeClass("drag-over");
		});
		dropzoneEl.addEventListener("drop", (e) => {
			e.preventDefault();
			dropzoneEl.removeClass("drag-over");
			const file = e.dataTransfer?.files?.[0];
			if (file && /\.(jpe?g|png|webp)$/i.test(file.name)) {
				setPreviewFile(file);
			}
		});

		const fieldsEl = formEl.createDiv("form-fields");

		let titleValue = String(this.fm.title || "");
		new Setting(fieldsEl).setName("タイトル").addText((text) => {
			text.setValue(titleValue);
			text.inputEl.style.width = "100%";
			text.onChange((v) => {
				titleValue = v;
			});
		});

		let authorValue = String(this.fm.author || "");
		new Setting(fieldsEl).setName("著者").addText((text) => {
			text.setValue(authorValue);
			text.inputEl.style.width = "100%";
			text.onChange((v) => {
				authorValue = v;
			});
		});

		let publisherValue = String(this.fm.publisher || "");
		new Setting(fieldsEl).setName("出版社").addText((text) => {
			text.setValue(publisherValue);
			text.inputEl.style.width = "100%";
			text.onChange((v) => {
				publisherValue = v;
			});
		});

		let publishDateValue = String(this.fm.publishDate || "");
		new Setting(fieldsEl).setName("出版日").addText((text) => {
			text.setValue(publishDateValue);
			text.inputEl.style.width = "100%";
			text.onChange((v) => {
				publishDateValue = v;
			});
		});

		let pagesValue = String(this.fm.pages || "");
		new Setting(fieldsEl).setName("ページ数").addText((text) => {
			text.setValue(pagesValue);
			text.inputEl.style.width = "100%";
			text.onChange((v) => {
				pagesValue = v;
			});
		});

		let languageValue = String(this.fm.language || "ja");
		new Setting(fieldsEl).setName("言語").addDropdown((dd) => {
			dd.addOption("ja", "日本語");
			dd.addOption("en", "English");
			dd.addOption("other", "その他");
			dd.setValue(languageValue);
			dd.onChange((v) => {
				languageValue = v;
			});
		});

		let statusValue = String(this.fm.status || "to-read");
		new Setting(contentEl).setName("ステータス").addDropdown((dd) => {
			dd.addOption("to-read", "読みたい");
			dd.addOption("reading", "読書中");
			dd.addOption("completed", "読了");
			dd.addOption("abandoned", "中断");
			dd.setValue(statusValue);
			dd.onChange((v) => {
				statusValue = v;
			});
		});

		let progressValue = Number(this.fm.progress ?? 0);
		const progressSetting = new Setting(contentEl).setName("進捗").setDesc(`${progressValue}%`);
		progressSetting.addSlider((slider) => {
			slider.setLimits(0, 100, 1);
			slider.setValue(progressValue);
			slider.onChange((v) => {
				progressValue = v;
				progressSetting.setDesc(`${v}%`);
			});
		});

		let ratingValue = Number(this.fm.rating ?? 0);
		const ratingSetting = new Setting(contentEl).setName("評価").setDesc(`${ratingValue}`);
		ratingSetting.addSlider((slider) => {
			slider.setLimits(0, 5, 1);
			slider.setValue(ratingValue);
			slider.onChange((v) => {
				ratingValue = v;
				ratingSetting.setDesc(`${v}`);
			});
		});

		let startDateValue = String(this.fm.startDate || "");
		let endDateValue = String(this.fm.endDate || "");
		new Setting(contentEl).setName("開始日").addText((text) => {
			text.setPlaceholder("例: 2024-01-01");
			text.setValue(startDateValue);
			text.onChange((v) => {
				startDateValue = v;
			});
			text.inputEl.addEventListener("blur", () => {
				const normalized = normalizeDate(text.inputEl.value);
				if (normalized !== text.inputEl.value) {
					text.inputEl.value = normalized;
				}
				startDateValue = text.inputEl.value;
			});
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.ctrlKey && e.key === ";") {
					e.preventDefault();
					const ymd = todayYmd();
					text.inputEl.value = ymd;
					startDateValue = ymd;
				}
			});
		});
		new Setting(contentEl).setName("終了日").addText((text) => {
			text.setPlaceholder("例: 2024-03-31");
			text.setValue(endDateValue);
			text.onChange((v) => {
				endDateValue = v;
			});
			text.inputEl.addEventListener("blur", () => {
				const normalized = normalizeDate(text.inputEl.value);
				if (normalized !== text.inputEl.value) {
					text.inputEl.value = normalized;
				}
				endDateValue = text.inputEl.value;
			});
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.ctrlKey && e.key === ";") {
					e.preventDefault();
					const ymd = todayYmd();
					text.inputEl.value = ymd;
					endDateValue = ymd;
				}
			});
		});

		const isbnStr = String(this.fm.isbn || "");
		if (isbnStr) {
			new Setting(contentEl).setName("ISBN").setDesc(isbnStr);
		}

		new Setting(contentEl)
			.addButton((btn) => {
				btn
					.setButtonText("保存")
					.setCta()
					.onClick(async () => {
						try {
							let newCoverPath: string | null = null;
							if (newCoverFile) {
								const key = String(this.fm.isbn || this.fm.title || "book");
								newCoverPath = await saveCoverFromFileObject(
									this.app,
									key,
									newCoverFile,
									this.settings.coversFolder,
								);
							}
							await this.app.fileManager.processFrontMatter(this.file, (front) => {
								front.title = titleValue;
								front.author = authorValue;
								front.publisher = publisherValue;
								front.publishDate = publishDateValue;
								front.pages = Number.parseInt(pagesValue) || front.pages;
								front.language = languageValue;
								front.status = statusValue;
								front.progress = progressValue;
								front.rating = ratingValue;
								front.startDate = startDateValue;
								front.endDate = endDateValue;
								if (newCoverPath) front.cover = newCoverPath;
							});
							new Notice("書籍ノートを更新しました");
							this.close();
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							new Notice(`エラー: ${message}`);
						}
					});
			})
			.addButton((btn) => {
				btn.setButtonText("キャンセル").onClick(() => this.close());
			});
	}

	onClose(): void {
		if (this.pasteHandler) {
			document.removeEventListener("paste", this.pasteHandler);
			this.pasteHandler = null;
		}
		this.contentEl.empty();
	}
}
