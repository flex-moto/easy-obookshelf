import { type App, Notice, type TFile } from "obsidian";
import { fetchDescriptionByTitle } from "./book-api";

interface KindleBookNote {
	file: TFile;
	title: string;
	author: string;
}

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
	const existingBlock = /<!-- kindle-description:start -->[\s\S]*?<!-- kindle-description:end -->/;
	if (existingBlock.test(content)) {
		await app.vault.modify(file, content.replace(existingBlock, block));
		return;
	}
	const firstHeading = /^##\s+/m;
	const headingMatch = firstHeading.exec(content);
	if (headingMatch?.index !== undefined) {
		const before = content.slice(0, headingMatch.index).trimEnd();
		const after = content.slice(headingMatch.index);
		await app.vault.modify(file, `${before}\n\n${block}\n\n${after}`);
		return;
	}
	await app.vault.modify(file, `${content.trimEnd()}\n\n${block}\n`);
}

export async function addDescriptionsToKindleHighlights(
	app: App,
	folder: string,
	googleBooksApiKey?: string,
): Promise<void> {
	const notes = findKindleBookNotes(app, folder);
	if (notes.length === 0) {
		new Notice(`Kindle Highlightsノートが見つかりませんでした: ${folder}`);
		return;
	}
	const progress = new Notice(`Kindle Highlightsへ概要を追加中... 0/${notes.length}`, 0);
	let updated = 0;
	let needsReview = 0;
	let notFound = 0;
	let failed = 0;
	for (let index = 0; index < notes.length; index++) {
		const { file, title, author } = notes[index];
		progress.setMessage(
			`Kindle Highlightsへ概要を追加中... ${index + 1}/${notes.length}\n${file.basename}`,
		);
		try {
			const result = await fetchDescriptionByTitle(title, author, googleBooksApiKey);
			if (!result) {
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
	new Notice(
		`Kindle Highlightsの概要追加が完了しました。更新 ${updated}冊（要確認 ${needsReview}冊）/ 概要なし ${notFound}冊 / 失敗 ${failed}冊`,
		10000,
	);
}
