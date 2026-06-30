import { type App, Notice, type TFile } from "obsidian";
import { fetchDescriptionByTitle } from "./book-api";

interface KindleBookNote {
	file: TFile;
	title: string;
	author: string;
}

const KINDLE_DESCRIPTION_BLOCK =
	/<!-- kindle-description:start -->[\s\S]*?<!-- kindle-description:end -->/;
const KINDLE_DESCRIPTION_NOT_FOUND = "<!-- kindle-description:not-found -->";
const MAX_INCREMENTAL_BOOKS = 150;

function hasKindleTag(tags: unknown): boolean {
	if (typeof tags === "string") return tags.toLowerCase() === "kindle";
	return Array.isArray(tags) && tags.some((tag) => String(tag).toLowerCase() === "kindle");
}

function findKindleBookNotes(app: App, folder: string): KindleBookNote[] {
	const folderPrefix = `${folder.replace(/^\/+|\/+$/g, "")}/`;
	return app.vault.getMarkdownFiles().flatMap((file) => {
		if (!file.path.startsWith(folderPrefix)) return [];
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter || !hasKindleTag(frontmatter.tags)) return [];
		const title = String(frontmatter["kindle-title"] ?? frontmatter.title ?? "").trim();
		const author = String(frontmatter["kindle-author"] ?? frontmatter.author ?? "").trim();
		return title ? [{ file, title, author }] : [];
	});
}

function buildKindleDescriptionBlock(description: string, needsReview: boolean): string {
	const warning = needsReview
		? '<span style="color: red;">※一致していない可能性あるため、要確認</span>\n\n'
		: "";
	return `<!-- kindle-description:start -->\n## 概要\n\n${warning}${description.trim()}\n<!-- kindle-description:end -->`;
}

async function updateKindleDescription(
	app: App,
	file: TFile,
	description: string,
	needsReview: boolean,
): Promise<void> {
	const content = await app.vault.read(file);
	const block = buildKindleDescriptionBlock(description, needsReview);
	const withoutNotFound = content.replace(`${KINDLE_DESCRIPTION_NOT_FOUND}\n`, "");
	if (KINDLE_DESCRIPTION_BLOCK.test(withoutNotFound)) {
		await app.vault.modify(file, withoutNotFound.replace(KINDLE_DESCRIPTION_BLOCK, block));
		return;
	}
	const firstHeading = /^##\s+/m;
	const headingMatch = firstHeading.exec(withoutNotFound);
	if (headingMatch?.index !== undefined) {
		const before = withoutNotFound.slice(0, headingMatch.index).trimEnd();
		const after = withoutNotFound.slice(headingMatch.index);
		await app.vault.modify(file, `${before}\n\n${block}\n\n${after}`);
		return;
	}
	await app.vault.modify(file, `${withoutNotFound.trimEnd()}\n\n${block}\n`);
}

async function markKindleDescriptionNotFound(app: App, file: TFile): Promise<void> {
	const content = await app.vault.read(file);
	if (content.includes(KINDLE_DESCRIPTION_NOT_FOUND)) return;
	if (KINDLE_DESCRIPTION_BLOCK.test(content)) return;
	const firstHeading = /^##\s+/m;
	const headingMatch = firstHeading.exec(content);
	if (headingMatch?.index !== undefined) {
		const before = content.slice(0, headingMatch.index).trimEnd();
		const after = content.slice(headingMatch.index);
		await app.vault.modify(file, `${before}\n${KINDLE_DESCRIPTION_NOT_FOUND}\n\n${after}`);
		return;
	}
	await app.vault.modify(file, `${content.trimEnd()}\n${KINDLE_DESCRIPTION_NOT_FOUND}\n`);
}

async function hasKindleDescriptionResult(app: App, file: TFile): Promise<boolean> {
	const content = await app.vault.cachedRead(file);
	return KINDLE_DESCRIPTION_BLOCK.test(content) || content.includes(KINDLE_DESCRIPTION_NOT_FOUND);
}

async function processKindleDescriptions(
	app: App,
	folder: string,
	googleBooksApiKey?: string,
	refreshAll = false,
): Promise<void> {
	const notes = findKindleBookNotes(app, folder);
	if (notes.length === 0) {
		new Notice(`Kindle Highlightsノートが見つかりませんでした: ${folder}`);
		return;
	}
	const pending: KindleBookNote[] = [];
	for (const note of notes) {
		if (refreshAll || !(await hasKindleDescriptionResult(app, note.file))) pending.push(note);
	}
	if (pending.length === 0) {
		new Notice("未処理のKindle Highlightsノートはありません。");
		return;
	}
	const targets = refreshAll ? pending : pending.slice(0, MAX_INCREMENTAL_BOOKS);
	const action = refreshAll ? "概要を全件再取得中" : "概要を追加中";
	const progress = new Notice(`Kindle Highlightsの${action}... 0/${targets.length}`, 0);
	let updated = 0;
	let needsReview = 0;
	let notFound = 0;
	let failed = 0;
	for (let index = 0; index < targets.length; index++) {
		const { file, title, author } = targets[index];
		progress.setMessage(
			`Kindle Highlightsの${action}... ${index + 1}/${targets.length}\n${file.basename}`,
		);
		try {
			const result = await fetchDescriptionByTitle(title, author, googleBooksApiKey);
			if (!result) {
				await markKindleDescriptionNotFound(app, file);
				notFound++;
				continue;
			}
			await updateKindleDescription(app, file, result.description, result.needsReview);
			updated++;
			if (result.needsReview) needsReview++;
		} catch (error) {
			console.warn(`Kindle Highlightsの概要追加に失敗しました: ${file.path}`, error);
			failed++;
		}
	}
	progress.hide();
	const remaining = refreshAll ? 0 : Math.max(0, pending.length - targets.length);
	new Notice(
		`Kindle Highlightsの概要処理が完了しました。更新 ${updated}冊（要確認 ${needsReview}冊）/ 概要なし ${notFound}冊 / 失敗 ${failed}冊 / 次回処理 ${remaining}冊`,
		10000,
	);
}

export async function addDescriptionsToKindleHighlights(
	app: App,
	folder: string,
	googleBooksApiKey?: string,
): Promise<void> {
	await processKindleDescriptions(app, folder, googleBooksApiKey);
}

export async function refreshAllKindleHighlightDescriptions(
	app: App,
	folder: string,
	googleBooksApiKey?: string,
): Promise<void> {
	await processKindleDescriptions(app, folder, googleBooksApiKey, true);
}
