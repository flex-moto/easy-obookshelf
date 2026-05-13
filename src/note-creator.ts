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

function buildNoteBody(): string {
	return "\n## メモ・感想\n\n";
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
	const content = `---\n---\n${buildNoteBody()}`;
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
	await app.workspace.getLeaf(false).openFile(file);
	new Notice(`書籍ノートを更新しました: ${file.name}`);
	return file;
}

async function downloadCoverSafe(
	app: App,
	metadata: BookMetadata,
	coversFolder: string,
	_settings: BookshelfSettings,
): Promise<string> {
	if (!metadata.coverUrl) return "";
	try {
		return await downloadCover(app, metadata.isbn, metadata.coverUrl, coversFolder);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const isPlaceholder = message.includes("プレースホルダー");
		if (isPlaceholder) {
			console.info("表紙画像が見つかりませんでした（プレースホルダーのためスキップ）");
			new Notice(
				"表紙画像が見つかりませんでした。\n手動フォームの表紙エリアから画像を追加できます。",
				6000,
			);
		} else {
			console.warn("表紙画像の取得に失敗しました:", err);
			const expectedPath = `${coversFolder}/${metadata.isbn || sanitizeFileName(metadata.title)}.webp`;
			new Notice(
				`表紙画像の取得に失敗しました。\n手動で ${expectedPath} に WebP 画像を配置してください。`,
				8000,
			);
		}
		return "";
	}
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
	await overwriteNote(app, file, metadata, settings.coversFolder, settings);
}
