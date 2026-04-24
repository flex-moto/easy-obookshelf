import { type App, Notice, requestUrl } from "obsidian";

async function urlToWebpArrayBuffer(url: string): Promise<ArrayBuffer> {
	const response = await requestUrl({ url });
	if (response.status !== 200) {
		throw new Error(`画像の取得に失敗しました: ${response.status}`);
	}
	const contentType = response.headers?.["content-type"]?.split(";")[0].trim() || "image/jpeg";
	const blob = new Blob([response.arrayBuffer], { type: contentType });
	const imageBitmap = await createImageBitmap(blob);
	if (imageBitmap.width <= 1 || imageBitmap.height <= 1) {
		throw new Error("プレースホルダー画像のため保存をスキップしました");
	}
	const canvas = document.createElement("canvas");
	canvas.width = imageBitmap.width;
	canvas.height = imageBitmap.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas context の取得に失敗しました");
	ctx.drawImage(imageBitmap, 0, 0);
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
): Promise<string> {
	const fileName = `${isbn}.webp`;
	const vaultPath = `${coversFolder}/${fileName}`;
	if (await app.vault.adapter.exists(vaultPath)) {
		return vaultPath;
	}
	if (!(await app.vault.adapter.exists(coversFolder))) {
		await app.vault.createFolder(coversFolder);
	}
	const arrayBuffer = await urlToWebpArrayBuffer(coverUrl);
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
	const canvas = document.createElement("canvas");
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
	// biome-ignore lint/suspicious/noExplicitAny: Electron APIs are accessed via window.require in Obsidian desktop.
	const windowRequire = (window as any).require as ((mod: string) => any) | undefined;
	const electron = windowRequire?.("electron");
	if (!electron) {
		new Notice("Electron API が利用できません。デスクトップ版 Obsidian で実行してください。");
		return null;
	}
	const { dialog } = electron.remote || electron;
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
	const fs = windowRequire?.("fs");
	if (!fs) {
		new Notice("ファイルシステム API が利用できません。");
		return null;
	}
	const sourceBuffer = fs.readFileSync(sourcePath);
	const ext = sourcePath.split(".").pop()?.toLowerCase();
	if (ext === "webp") {
		await app.vault.adapter.writeBinary(vaultPath, sourceBuffer.buffer);
	} else {
		const blob = new Blob([sourceBuffer], { type: "image/*" });
		const imageBitmap = await createImageBitmap(blob);
		const canvas = document.createElement("canvas");
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
