import { type App, Modal, Notice, Setting, requestUrl } from "obsidian";
import { fetchByISBN } from "./book-api";
import { EditBookModal } from "./edit-modal";
import { downloadCover, saveCoverFromFileObject } from "./image-cache";
import { createBookNote } from "./note-creator";
import type { BookMetadata, BookNoteFrontmatter, BookshelfSettings } from "./types";

function normalizeIsbn(input: string): string {
	const raw = input.replace(/[\s\-]/g, "");
	if (raw.length === 10 && /^\d{9}[\dXx]$/.test(raw)) {
		return convertIsbn10To13(raw);
	}
	return raw;
}

function convertIsbn10To13(isbn10: string): string {
	const digits = `978${isbn10.slice(0, 9)}`;
	let sum = 0;
	for (let i = 0; i < 12; i++) {
		sum += Number.parseInt(digits[i]) * (i % 2 === 0 ? 1 : 3);
	}
	const check = (10 - (sum % 10)) % 10;
	return digits + check.toString();
}

function isValidIsbn(isbn: string): boolean {
	return /^\d{13}$/.test(isbn) || /^\d{9}[\dXx]$/.test(isbn);
}

export class ISBNModal extends Modal {
	private settings: BookshelfSettings;
	private inputEl: HTMLInputElement | null = null;
	private statusEl: HTMLDivElement | null = null;
	private isLoading = false;

	constructor(app: App, settings: BookshelfSettings) {
		super(app);
		this.settings = settings;
	}

	onOpen(): void {
		this.showIsbnForm();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private showIsbnForm(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("bookshelf-modal");
		contentEl.createEl("h2", { text: "ISBN から本を追加" });

		new Setting(contentEl)
			.setName("ISBN")
			.setDesc("ISBN-10 または ISBN-13 を入力してください")
			.addText((text) => {
				text.setPlaceholder("例: 9784000000000");
				text.inputEl.style.width = "220px";
				this.inputEl = text.inputEl;
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") this.handleSearch();
				});
			});

		new Setting(contentEl)
			.addButton((btn) => {
				btn
					.setButtonText("検索して追加")
					.setCta()
					.onClick(() => this.handleSearch());
			})
			.addButton((btn) => {
				btn.setButtonText("手動で入力").onClick(() => {
					const raw = this.inputEl?.value ?? "";
					const isbn = raw ? normalizeIsbn(raw) : "";
					this.showManualForm(isbn);
				});
			});

		this.statusEl = contentEl.createDiv();
		setTimeout(() => this.inputEl?.focus(), 50);
	}

	private showManualForm(
		isbn: string,
		prefill?: { metadata: BookMetadata; autoCoverUrl?: string },
	): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("bookshelf-modal");
		contentEl.createEl("h2", {
			text: prefill ? "書籍情報を確認" : "書籍情報を手動で入力",
		});

		let coverFile: File | null = null;

		const formEl = contentEl.createDiv("bookshelf-manual-form");
		const dropzoneEl = formEl.createDiv("bookshelf-dropzone");
		const dropzoneText = dropzoneEl.createDiv({
			cls: "bookshelf-dropzone-text",
			text: "表紙画像をドロップ / クリック / Ctrl+V で貼り付け",
		});
		let previewImg: HTMLImageElement | null = null;
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".jpg,.jpeg,.png,.webp";
		fileInput.style.display = "none";
		contentEl.appendChild(fileInput);

		const showPreviewSrc = (src: string) => {
			if (previewImg) {
				previewImg.src = src;
			} else {
				dropzoneText.style.display = "none";
				previewImg = dropzoneEl.createEl("img");
				previewImg.src = src;
			}
		};

		const setPreviewFile = (file: File) => {
			coverFile = file;
			const objectUrl = URL.createObjectURL(file);
			showPreviewSrc(objectUrl);
		};

		if (prefill?.autoCoverUrl) {
			(async () => {
				try {
					const response = await requestUrl({ url: prefill.autoCoverUrl as string });
					if (response.status !== 200) return;
					const contentType =
						response.headers?.["content-type"]?.split(";")[0].trim() || "image/jpeg";
					const blob = new Blob([response.arrayBuffer], { type: contentType });
					const bitmap = await createImageBitmap(blob);
					if (bitmap.width <= 1 || bitmap.height <= 1) return;
					const objectUrl = URL.createObjectURL(blob);
					showPreviewSrc(objectUrl);
				} catch (err) {
					console.warn("自動取得した表紙のプレビューに失敗:", err);
				}
			})();
		}

		const pasteHandler = (e: ClipboardEvent) => {
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
		document.addEventListener("paste", pasteHandler);

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

		let titleValue = prefill?.metadata.title ?? "";
		new Setting(fieldsEl).setName("タイトル *").addText((text) => {
			text.setPlaceholder("書籍タイトル");
			text.inputEl.style.width = "100%";
			text.setValue(titleValue);
			text.onChange((v) => {
				titleValue = v;
			});
		});

		let authorValue = prefill?.metadata.author ?? "";
		new Setting(fieldsEl).setName("著者").addText((text) => {
			text.setPlaceholder("著者名");
			text.inputEl.style.width = "100%";
			text.setValue(authorValue);
			text.onChange((v) => {
				authorValue = v;
			});
		});

		let publisherValue = prefill?.metadata.publisher ?? "";
		new Setting(fieldsEl).setName("出版社").addText((text) => {
			text.setPlaceholder("出版社名");
			text.inputEl.style.width = "100%";
			text.setValue(publisherValue);
			text.onChange((v) => {
				publisherValue = v;
			});
		});

		let publishDateValue = prefill?.metadata.publishDate ?? "";
		new Setting(fieldsEl).setName("出版日").addText((text) => {
			text.setPlaceholder("例: 2023-01-01");
			text.inputEl.style.width = "100%";
			text.setValue(publishDateValue);
			text.onChange((v) => {
				publishDateValue = v;
			});
		});

		let pagesValue = prefill?.metadata.pages ? String(prefill.metadata.pages) : "";
		new Setting(fieldsEl).setName("ページ数").addText((text) => {
			text.setPlaceholder("例: 300");
			text.inputEl.style.width = "100%";
			text.setValue(pagesValue);
			text.onChange((v) => {
				pagesValue = v;
			});
		});

		let languageValue = prefill?.metadata.language ?? "ja";
		new Setting(fieldsEl).setName("言語").addDropdown((dd) => {
			dd.addOption("ja", "日本語");
			dd.addOption("en", "English");
			dd.addOption("other", "その他");
			dd.setValue(languageValue);
			dd.onChange((v) => {
				languageValue = v;
			});
		});

		const statusEl = contentEl.createDiv();

		new Setting(contentEl)
			.addButton((btn) => {
				btn
					.setButtonText("登録")
					.setCta()
					.onClick(async () => {
						const title = titleValue.trim();
						if (!title) {
							statusEl.empty();
							statusEl.createDiv({
								cls: "bookshelf-error",
								text: "タイトルは必須です",
							});
							return;
						}
						const normalizedIsbn = isbn && isValidIsbn(isbn) ? isbn : "";
						const metadata: BookMetadata = {
							title,
							author: authorValue.trim(),
							publisher: publisherValue.trim(),
							isbn: normalizedIsbn,
							publishDate: publishDateValue.trim(),
							pages: Number.parseInt(pagesValue) || 0,
							coverUrl: prefill?.autoCoverUrl ?? "",
							language: languageValue,
						};
						let coverPath = "";
						if (coverFile) {
							try {
								coverPath = await saveCoverFromFileObject(
									this.app,
									normalizedIsbn || title,
									coverFile,
									this.settings.coversFolder,
								);
							} catch (err) {
								console.warn("表紙画像の保存に失敗しました:", err);
							}
						} else if (prefill?.autoCoverUrl && normalizedIsbn) {
							try {
								coverPath = await downloadCover(
									this.app,
									normalizedIsbn,
									prefill.autoCoverUrl,
									this.settings.coversFolder,
								);
							} catch (err) {
								console.warn("表紙画像のダウンロードに失敗しました:", err);
							}
						}
						try {
							const file = await createBookNote(
								this.app,
								metadata,
								this.settings,
								coverPath || undefined,
							);
							document.removeEventListener("paste", pasteHandler);
							this.close();
							if (prefill) {
								const fm: BookNoteFrontmatter = {
									title: metadata.title,
									author: metadata.author,
									publisher: metadata.publisher,
									isbn: metadata.isbn,
									publishDate: metadata.publishDate,
									pages: metadata.pages,
									cover: coverPath,
									status: "to-read",
									progress: 0,
									startDate: "",
									endDate: "",
									rating: 0,
									language: metadata.language,
									tags: ["book"],
								};
								new EditBookModal(this.app, file, fm, this.settings).open();
							}
							return;
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							statusEl.empty();
							statusEl.createDiv({
								cls: "bookshelf-error",
								text: `エラー: ${message}`,
							});
							new Notice(`エラー: ${message}`);
						}
					});
			})
			.addButton((btn) => {
				btn.setButtonText("戻る").onClick(() => {
					document.removeEventListener("paste", pasteHandler);
					this.showIsbnForm();
				});
			});
	}

	private async handleSearch(): Promise<void> {
		if (this.isLoading) return;
		const raw = this.inputEl?.value ?? "";
		const isbn = normalizeIsbn(raw);
		if (!isValidIsbn(isbn.replace(/[\s\-]/g, ""))) {
			this.showError("有効な ISBN を入力してください（10桁または13桁の数字）。");
			return;
		}
		this.setLoading(true);
		try {
			const metadata = await fetchByISBN(isbn, this.settings.googleBooksApiKey || undefined);
			this.showManualForm(isbn, { metadata, autoCoverUrl: metadata.coverUrl });
		} catch (_e) {
			this.showManualForm(isbn);
			new Notice("書籍情報が見つかりませんでした。手動で入力してください。");
		} finally {
			this.setLoading(false);
		}
	}

	private setLoading(loading: boolean): void {
		this.isLoading = loading;
		if (!this.statusEl) return;
		this.statusEl.empty();
		if (loading) {
			const spinnerEl = this.statusEl.createDiv("bookshelf-spinner");
			spinnerEl.createDiv("bookshelf-spinner-icon");
			spinnerEl.createSpan({ text: "書籍情報を取得中..." });
		}
	}

	private showError(message: string): void {
		if (!this.statusEl) return;
		this.statusEl.empty();
		this.statusEl.createDiv({
			cls: "bookshelf-error",
			text: `エラー: ${message}`,
		});
	}
}
