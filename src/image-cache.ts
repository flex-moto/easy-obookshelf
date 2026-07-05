import { type App, Notice, requestUrl } from "obsidian";
import { getElectronDialog, getWindowRequire } from "./desktop-api";

const MIN_COVER_WIDTH = 300;
const MIN_COVER_HEIGHT = 400;

function isLikelyPlaceholder(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
): boolean {
	const pixels = context.getImageData(0, 0, width, height).data;
	const step = Math.max(1, Math.floor(Math.max(width, height) / 120));
	let samples = 0;
	let white = 0;
	let colored = 0;
	let dark = 0;
	for (let y = 0; y < height; y += step) {
		for (let x = 0; x < width; x += step) {
			const index = (y * width + x) * 4;
			const red = pixels[index];
			const green = pixels[index + 1];
			const blue = pixels[index + 2];
			const maximum = Math.max(red, green, blue);
			const minimum = Math.min(red, green, blue);
			const brightness = (red + green + blue) / 3;
			samples++;
			if (minimum > 245) white++;
			if (maximum - minimum > 12) colored++;
			if (brightness < 130) dark++;
		}
	}
	return white / samples > 0.65 && colored / samples < 0.005 && dark / samples < 0.002;
}

async function urlToWebpArrayBuffer(
	url: string,
	allowLowResolution: boolean,
): Promise<ArrayBuffer> {
	const isBooksOrJp = url.startsWith("https://thumbnail-s.images.books.or.jp/");
	const response = await requestUrl({
		url,
		headers: isBooksOrJp
			? {
					Referer: "https://www.books.or.jp/",
					"User-Agent": "Mozilla/5.0",
				}
			: undefined,
	});
	if (response.status !== 200) {
		throw new Error(`画像の取得に失敗しました: ${response.status}`);
	}
	const contentType = response.headers?.["content-type"]?.split(";")[0].trim() || "image/jpeg";
	const blob = new Blob([response.arrayBuffer], { type: contentType });
	const imageBitmap = await createImageBitmap(blob);
	if (imageBitmap.width <= 1 || imageBitmap.height <= 1) {
		throw new Error("プレースホルダー画像のため保存をスキップしました");
	}
	const canvas = createEl("canvas");
	canvas.width = imageBitmap.width;
	canvas.height = imageBitmap.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas context の取得に失敗しました");
	ctx.drawImage(imageBitmap, 0, 0);
	if (isLikelyPlaceholder(ctx, imageBitmap.width, imageBitmap.height)) {
		throw new Error("image not available プレースホルダーのためスキップしました");
	}
	if (
		!allowLowResolution &&
		(imageBitmap.width < MIN_COVER_WIDTH || imageBitmap.height < MIN_COVER_HEIGHT)
	) {
		throw new Error(
			`低解像度画像のためスキップしました: ${imageBitmap.width}x${imageBitmap.height}`,
		);
	}
	return new Promise<ArrayBuffer>((resolve, reject) => {
		canvas.toBlob(
			(webpBlob) => {
				if (!webpBlob) {
					reject(new Error("WebP 変換に失敗しました"));
					return;
				}
				webpBlob.arrayBuffer().then(resolve).catch(reject);
			},
			"image/webp",
			0.9,
		);
	});
}

export async function downloadCover(
	app: App,
	isbn: string,
	coverUrl: string,
	coversFolder: string,
	force = false,
	allowLowResolution = false,
): Promise<string> {
	const fileName = `${isbn}.webp`;
	const vaultPath = `${coversFolder}/${fileName}`;
	if (!force && (await app.vault.adapter.exists(vaultPath))) {
		return vaultPath;
	}
	if (!(await app.vault.adapter.exists(coversFolder))) {
		await app.vault.createFolder(coversFolder);
	}
	const arrayBuffer = await urlToWebpArrayBuffer(coverUrl, allowLowResolution);
	await app.vault.adapter.writeBinary(vaultPath, arrayBuffer);
	return vaultPath;
}

export async function saveCoverFromFileObject(
	app: App,
	fileNameKey: string,
	file: File,
	coversFolder: string,
): Promise<string> {
	const sanitized = fileNameKey.replace(/[\\/:*?"<>|]/g, "_").trim();
	const vaultPath = `${coversFolder}/${sanitized}.webp`;
	if (!(await app.vault.adapter.exists(coversFolder))) {
		await app.vault.createFolder(coversFolder);
	}
	const imageBitmap = await createImageBitmap(file);
	const canvas = createEl("canvas");
	canvas.width = imageBitmap.width;
	canvas.height = imageBitmap.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas context の取得に失敗しました");
	ctx.drawImage(imageBitmap, 0, 0);
	const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
		canvas.toBlob(
			(webpBlob) => {
				if (!webpBlob) {
					reject(new Error("WebP 変換に失敗しました"));
					return;
				}
				webpBlob.arrayBuffer().then(resolve).catch(reject);
			},
			"image/webp",
			0.9,
		);
	});
	await app.vault.adapter.writeBinary(vaultPath, arrayBuffer);
	return vaultPath;
}

export async function setManualCover(
	app: App,
	isbn: string,
	coversFolder: string,
): Promise<string | null> {
	const windowRequire = getWindowRequire();
	if (!windowRequire) {
		new Notice("Electron API が利用できません。デスクトップ版 Obsidian で実行してください。");
		return null;
	}
	const dialog = getElectronDialog(windowRequire);
	if (!dialog) {
		new Notice("Electronのファイル選択APIが利用できません。");
		return null;
	}
	const result = await dialog.showOpenDialog({
		title: "表紙画像を選択",
		filters: [{ name: "WebP 画像", extensions: ["webp", "jpg", "jpeg", "png"] }],
		properties: ["openFile"],
	});
	if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
		return null;
	}
	const sourcePath = result.filePaths[0];
	const vaultPath = `${coversFolder}/${isbn}.webp`;
	if (!(await app.vault.adapter.exists(coversFolder))) {
		await app.vault.createFolder(coversFolder);
	}
	const fs = windowRequire("fs") as { readFileSync(path: string): Uint8Array };
	if (!fs?.readFileSync) {
		new Notice("ファイルシステム API が利用できません。");
		return null;
	}
	const sourceBuffer = fs.readFileSync(sourcePath);
	const sourceArrayBuffer = sourceBuffer.buffer.slice(
		sourceBuffer.byteOffset,
		sourceBuffer.byteOffset + sourceBuffer.byteLength,
	) as ArrayBuffer;
	const ext = sourcePath.split(".").pop()?.toLowerCase();
	if (ext === "webp") {
		await app.vault.adapter.writeBinary(vaultPath, sourceArrayBuffer);
	} else {
		const blob = new Blob([sourceArrayBuffer], { type: "image/*" });
		const imageBitmap = await createImageBitmap(blob);
		const canvas = createEl("canvas");
		canvas.width = imageBitmap.width;
		canvas.height = imageBitmap.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas context の取得に失敗しました");
		ctx.drawImage(imageBitmap, 0, 0);
		const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
			canvas.toBlob(
				(webpBlob) => {
					if (!webpBlob) {
						reject(new Error("WebP 変換に失敗しました"));
						return;
					}
					webpBlob.arrayBuffer().then(resolve).catch(reject);
				},
				"image/webp",
				0.9,
			);
		});
		await app.vault.adapter.writeBinary(vaultPath, arrayBuffer);
	}
	return vaultPath;
}
