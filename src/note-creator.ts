import { type App, Notice, type TFile } from "obsidian";
import { downloadCover } from "./image-cache";
import type { BookMetadata, BookshelfSettings } from "./types";

function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

function buildFrontmatter(metadata: BookMetadata, coverPath: string, settings: BookshelfSettings) {
	return {
		title: metadata.title,
		author: metadata.author,
		publisher: metadata.publisher,
		isbn: metadata.isbn,
		publishDate: metadata.publishDate,
		pages: metadata.pages,
		cover: coverPath,
		status: settings.defaultStatus,
		progress: settings.defaultProgress,
		startDate: "",
		endDate: "",
		rating: 0,
		language: metadata.language,
		tags: ["book"],
	};
}

function buildDescriptionBlock(description = ""): string {
	const content = description.trim();
	return `<!-- bookshelf-description:start -->\n## 概要\n\n${content}\n<!-- bookshelf-description:end -->`;
}

function buildNoteBody(coverPath: string, description = ""): string {
	const cover = coverPath
		? `\n<!-- bookshelf-cover:start -->\n![[${coverPath}|240]]\n<!-- bookshelf-cover:end -->\n`
		: "";
	return `${cover}\n${buildDescriptionBlock(description)}\n\n## メモ・感想\n\n`;
}

async function updateCoverInBody(app: App, file: TFile, coverPath: string): Promise<void> {
	if (!coverPath) return;
	const content = await app.vault.read(file);
	const coverBlock = `<!-- bookshelf-cover:start -->\n![[${coverPath}|240]]\n<!-- bookshelf-cover:end -->`;
	const blockPattern = /<!-- bookshelf-cover:start -->[\s\S]*?<!-- bookshelf-cover:end -->/;
	if (blockPattern.test(content)) {
		await app.vault.modify(file, content.replace(blockPattern, coverBlock));
		return;
	}
	const memoHeading = "\n## メモ・感想";
	if (content.includes(memoHeading)) {
		await app.vault.modify(file, content.replace(memoHeading, `\n${coverBlock}\n${memoHeading}`));
	}
}

async function updateDescriptionInBody(
	app: App,
	file: TFile,
	description: string | undefined,
): Promise<void> {
	const content = await app.vault.read(file);
	const descriptionBlock = buildDescriptionBlock(description);
	const blockPattern =
		/<!-- bookshelf-description:start -->[\s\S]*?<!-- bookshelf-description:end -->/;
	if (blockPattern.test(content)) {
		await app.vault.modify(file, content.replace(blockPattern, descriptionBlock));
		return;
	}
	const memoHeading = "\n## メモ・感想";
	if (content.includes(memoHeading)) {
		await app.vault.modify(
			file,
			content.replace(memoHeading, `\n${descriptionBlock}\n${memoHeading}`),
		);
	}
}

export async function createBookNote(
	app: App,
	metadata: BookMetadata,
	settings: BookshelfSettings,
	prebuiltCoverPath?: string,
): Promise<TFile> {
	const { booksFolder, coversFolder, duplicateIsbnAction } = settings;
	if (!(await app.vault.adapter.exists(booksFolder))) {
		await app.vault.createFolder(booksFolder);
	}
	const existingFile = metadata.isbn ? findNoteByISBN(app, metadata.isbn) : null;
	if (existingFile) {
		if (duplicateIsbnAction === "open") {
			new Notice(`既存ノートを開きます: ${existingFile.name}`);
			await app.workspace.getLeaf(false).openFile(existingFile);
			return existingFile;
		}
		if (duplicateIsbnAction === "overwrite") {
			return await overwriteNote(
				app,
				existingFile,
				metadata,
				coversFolder,
				settings,
				prebuiltCoverPath,
			);
		}
	}
	const coverPath =
		prebuiltCoverPath !== undefined
			? prebuiltCoverPath
			: await downloadCoverSafe(app, metadata, coversFolder, settings);
	const baseName = sanitizeFileName(metadata.title);
	let fileName = `${baseName}.md`;
	let filePath = `${booksFolder}/${fileName}`;
	if (await app.vault.adapter.exists(filePath)) {
		fileName = `${baseName}-${metadata.isbn}.md`;
		filePath = `${booksFolder}/${fileName}`;
	}
	const frontmatter = buildFrontmatter(metadata, coverPath, settings);
	const content = `---\n---\n${buildNoteBody(coverPath, metadata.description)}`;
	const file = await app.vault.create(filePath, content);
	await app.fileManager.processFrontMatter(file, (fm) => {
		Object.assign(fm, frontmatter);
	});
	await app.workspace.getLeaf(false).openFile(file);
	new Notice(`書籍ノートを作成しました: ${file.name}`);
	return file;
}

async function overwriteNote(
	app: App,
	file: TFile,
	metadata: BookMetadata,
	coversFolder: string,
	settings: BookshelfSettings,
	prebuiltCoverPath?: string,
): Promise<TFile> {
	const coverPath =
		prebuiltCoverPath !== undefined
			? prebuiltCoverPath
			: await downloadCoverSafe(app, metadata, coversFolder, settings);
	const frontmatter = buildFrontmatter(metadata, coverPath, settings);
	await app.fileManager.processFrontMatter(file, (fm) => {
		Object.assign(fm, frontmatter);
	});
	await updateCoverInBody(app, file, coverPath);
	await updateDescriptionInBody(app, file, metadata.description);
	await app.workspace.getLeaf(false).openFile(file);
	new Notice(`書籍ノートを更新しました: ${file.name}`);
	return file;
}

async function downloadCoverSafe(
	app: App,
	metadata: BookMetadata,
	coversFolder: string,
	_settings: BookshelfSettings,
	force = false,
	showNotice = true,
): Promise<string> {
	const coverUrls = metadata.coverUrls?.length ? metadata.coverUrls : [metadata.coverUrl];
	const errors: string[] = [];
	const validUrls = coverUrls.filter(Boolean);
	for (const allowLowResolution of [false, true]) {
		for (const coverUrl of validUrls) {
			try {
				return await downloadCover(
					app,
					metadata.isbn,
					coverUrl,
					coversFolder,
					force,
					allowLowResolution,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`${coverUrl}: ${message}`);
				console.info(`表紙候補をスキップしました: ${message}`, coverUrl);
			}
		}
	}
	if (errors.length > 0) {
		console.warn(`表紙画像を取得できませんでした: ISBN ${metadata.isbn}`, errors);
		if (showNotice) {
			new Notice(
				"十分な解像度の表紙画像が見つかりませんでした。\n手動で表紙画像を設定できます。",
				8000,
			);
		}
	}
	return "";
}

export async function refreshBookCover(
	app: App,
	file: TFile,
	metadata: BookMetadata,
	settings: BookshelfSettings,
): Promise<boolean> {
	const coverPath = await downloadCoverSafe(
		app,
		metadata,
		settings.coversFolder,
		settings,
		true,
		false,
	);
	if (!coverPath) return false;
	await app.fileManager.processFrontMatter(file, (fm) => {
		fm.cover = coverPath;
	});
	await updateCoverInBody(app, file, coverPath);
	return true;
}

export function findNoteByISBN(app: App, isbn: string): TFile | null {
	const files = app.vault.getMarkdownFiles();
	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.isbn === isbn) {
			return file;
		}
	}
	return null;
}

export async function updateBookMetadata(
	app: App,
	file: TFile,
	metadata: BookMetadata,
): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm) => {
		fm.title = metadata.title;
		fm.author = metadata.author;
		fm.publisher = metadata.publisher;
		fm.isbn = metadata.isbn;
		fm.publishDate = metadata.publishDate;
		fm.pages = metadata.pages;
		fm.language = metadata.language;
	});
	await updateDescriptionInBody(app, file, metadata.description);
}

export async function updateBookNote(
	app: App,
	metadata: BookMetadata,
	settings: BookshelfSettings,
): Promise<void> {
	const file = app.workspace.getActiveFile();
	if (!file) {
		new Notice("アクティブなノートがありません。");
		return;
	}
	const cache = app.metadataCache.getFileCache(file);
	if (!cache?.frontmatter?.isbn) {
		new Notice("このノートには ISBN フィールドがありません。");
		return;
	}
	await updateBookMetadata(app, file, metadata);
	await refreshBookCover(app, file, metadata, settings);
	await app.workspace.getLeaf(false).openFile(file);
	new Notice(`書籍情報を更新しました: ${file.name}`);
}
