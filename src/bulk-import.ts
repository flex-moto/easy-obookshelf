import { type App, Notice } from "obsidian";
import { fetchByISBN } from "./book-api";
import { createBookNote } from "./note-creator";
import type { BookshelfSettings } from "./types";

interface DetectedBarcode {
	rawValue: string;
}

interface BarcodeDetectorInstance {
	detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
	new (options?: { formats?: string[] }): BarcodeDetectorInstance;
}

interface DesktopApis {
	dialog: {
		showOpenDialog(options: Record<string, unknown>): Promise<{
			canceled: boolean;
			filePaths: string[];
		}>;
		showSaveDialog(options: Record<string, unknown>): Promise<{
			canceled: boolean;
			filePath?: string;
		}>;
	};
	fs: {
		readdirSync(
			path: string,
			options: { withFileTypes: true },
		): Array<{
			name: string;
			isFile(): boolean;
		}>;
		readFileSync(path: string): Uint8Array;
		writeFileSync(path: string, data: string, encoding: string): void;
		unlinkSync(path: string): void;
	};
	path: {
		join(...parts: string[]): string;
	};
	childProcess: {
		execFileSync(file: string, args: string[], options?: { encoding: "utf8" }): string | undefined;
	};
	os: {
		tmpdir(): string;
	};
	crypto: {
		randomUUID(): string;
	};
}

interface IsbnCsvRow {
	filename: string;
	isbn: string;
	status: string;
	error: string;
}

interface OcrEngine {
	recognize(imagePath: string): string;
	cleanup(): void;
}

const OCR_OBJECTIVE_C_SOURCE = `
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) return 2;
        NSString *path = [NSString stringWithUTF8String:argv[1]];
        NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
        CGImageRef cgImage = [image CGImageForProposedRect:NULL context:nil hints:nil];
        if (!cgImage) return 3;

        VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.recognitionLanguages = @[@"ja-JP", @"en-US"];
        request.usesLanguageCorrection = NO;

        VNImageRequestHandler *handler =
            [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
        NSError *error = nil;
        if (![handler performRequests:@[request] error:&error]) {
            fprintf(stderr, "%s\\n", error.localizedDescription.UTF8String);
            return 4;
        }

        for (VNRecognizedTextObservation *observation in request.results) {
            VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
            if (candidate) printf("%s\\n", candidate.string.UTF8String);
        }
    }
    return 0;
}
`;

function getDesktopApis(): DesktopApis | null {
	// biome-ignore lint/suspicious/noExplicitAny: Obsidian desktop exposes Node/Electron through window.require.
	const windowRequire = (window as any).require as ((module: string) => any) | undefined;
	if (!windowRequire) return null;
	const electron = windowRequire("electron");
	const fs = windowRequire("fs");
	const path = windowRequire("path");
	const childProcess = windowRequire("child_process");
	const os = windowRequire("os");
	const crypto = windowRequire("crypto");
	const dialog = (electron.remote || electron).dialog;
	return dialog && fs && path && childProcess && os && crypto
		? { dialog, fs, path, childProcess, os, crypto }
		: null;
}

function normalizeIsbn(value: string): string {
	return value
		.replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
		.replace(/[^0-9Xx]/g, "")
		.toUpperCase();
}

function isValidIsbn13(isbn: string): boolean {
	if (!/^(978|979)\d{10}$/.test(isbn)) return false;
	let sum = 0;
	for (let index = 0; index < 12; index++) {
		sum += Number(isbn[index]) * (index % 2 === 0 ? 1 : 3);
	}
	return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

function isbn10To13(isbn10: string): string | null {
	if (!/^\d{9}[\dX]$/.test(isbn10)) return null;
	let isbn10Sum = 0;
	for (let index = 0; index < 10; index++) {
		const digit = isbn10[index] === "X" ? 10 : Number(isbn10[index]);
		isbn10Sum += digit * (10 - index);
	}
	if (isbn10Sum % 11 !== 0) return null;
	const first12 = `978${isbn10.slice(0, 9)}`;
	let sum = 0;
	for (let index = 0; index < 12; index++) {
		sum += Number(first12[index]) * (index % 2 === 0 ? 1 : 3);
	}
	return `${first12}${(10 - (sum % 10)) % 10}`;
}

function toValidIsbn13(value: string): string | null {
	const normalized = normalizeIsbn(value);
	if (isValidIsbn13(normalized)) return normalized;
	return normalized.length === 10 ? isbn10To13(normalized) : null;
}

function extractIsbnFromOcrText(text: string): string | null {
	const candidates = text.match(
		/[0-9０-９XxＸｘ][0-9０-９XxＸｘ \t\u3000-]{8,30}[0-9０-９XxＸｘ]/g,
	);
	for (const candidate of candidates ?? []) {
		const isbn = toValidIsbn13(candidate);
		if (isbn) return isbn;
	}
	return null;
}

function createOcrEngine(desktop: DesktopApis): OcrEngine {
	if (process.platform !== "darwin") {
		throw new Error("OCRは現在macOS版でのみ対応しています");
	}
	const id = desktop.crypto.randomUUID();
	const sourcePath = desktop.path.join(desktop.os.tmpdir(), `isbn-ocr-${id}.m`);
	const executablePath = desktop.path.join(desktop.os.tmpdir(), `isbn-ocr-${id}`);
	desktop.fs.writeFileSync(sourcePath, OCR_OBJECTIVE_C_SOURCE, "utf8");
	try {
		desktop.childProcess.execFileSync("/usr/bin/clang", [
			"-fobjc-arc",
			"-framework",
			"Foundation",
			"-framework",
			"AppKit",
			"-framework",
			"Vision",
			sourcePath,
			"-o",
			executablePath,
		]);
	} catch (error) {
		try {
			desktop.fs.unlinkSync(sourcePath);
		} catch {
			// Ignore cleanup errors after compilation failure.
		}
		throw error;
	}
	return {
		recognize(imagePath: string): string {
			return (
				desktop.childProcess.execFileSync(executablePath, [imagePath], {
					encoding: "utf8",
				}) ?? ""
			);
		},
		cleanup(): void {
			for (const path of [sourcePath, executablePath]) {
				try {
					desktop.fs.unlinkSync(path);
				} catch {
					// Ignore cleanup errors for temporary OCR files.
				}
			}
		},
	};
}

function csvEscape(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows: IsbnCsvRow[]): string {
	const lines = rows.map((row) =>
		[row.filename, row.isbn, row.status, row.error].map(csvEscape).join(","),
	);
	return `\uFEFFfilename,isbn,status,error\r\n${lines.join("\r\n")}\r\n`;
}

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (quoted) {
			if (character === '"' && text[index + 1] === '"') {
				field += '"';
				index++;
			} else if (character === '"') {
				quoted = false;
			} else {
				field += character;
			}
		} else if (character === '"') {
			quoted = true;
		} else if (character === ",") {
			row.push(field);
			field = "";
		} else if (character === "\n") {
			row.push(field.replace(/\r$/, ""));
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += character;
		}
	}
	if (field || row.length > 0) {
		row.push(field.replace(/\r$/, ""));
		rows.push(row);
	}
	return rows;
}

async function detectIsbn(
	imageBytes: Uint8Array,
	BarcodeDetectorApi: BarcodeDetectorConstructor,
): Promise<string | null> {
	const imageBuffer = Uint8Array.from(imageBytes).buffer;
	const imageBlob = new Blob([imageBuffer]);
	const bitmap = await createImageBitmap(imageBlob);
	try {
		const detector = new BarcodeDetectorApi({ formats: ["ean_13"] });
		const detected = await detector.detect(bitmap);
		for (const barcode of detected) {
			const isbn = toValidIsbn13(barcode.rawValue);
			if (isbn) return isbn;
		}
		return null;
	} finally {
		bitmap.close();
	}
}

function readImageBytes(sourcePath: string, isHeic: boolean, desktop: DesktopApis): Uint8Array {
	if (!isHeic) return desktop.fs.readFileSync(sourcePath);
	if (process.platform !== "darwin") {
		throw new Error("HEICの変換は現在macOS版でのみ対応しています");
	}
	const temporaryPath = desktop.path.join(
		desktop.os.tmpdir(),
		`isbn-back-cover-${desktop.crypto.randomUUID()}.jpg`,
	);
	try {
		desktop.childProcess.execFileSync("/usr/bin/sips", [
			"-s",
			"format",
			"jpeg",
			sourcePath,
			"--out",
			temporaryPath,
		]);
		return desktop.fs.readFileSync(temporaryPath);
	} finally {
		try {
			desktop.fs.unlinkSync(temporaryPath);
		} catch {
			// The conversion may fail before the temporary file is created.
		}
	}
}

export async function exportIsbnsFromBackCovers(): Promise<void> {
	const desktop = getDesktopApis();
	if (!desktop) {
		new Notice("この機能はデスクトップ版 Obsidian でのみ利用できます。");
		return;
	}
	const BarcodeDetectorApi = (
		window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }
	).BarcodeDetector;
	if (!BarcodeDetectorApi) {
		new Notice("バーコード検出が利用できないため、OCRのみで読み取ります。", 5000);
	}
	const selected = await desktop.dialog.showOpenDialog({
		title: "本の裏表紙画像が入ったフォルダを選択",
		properties: ["openDirectory"],
	});
	if (selected.canceled || !selected.filePaths[0]) return;
	const directory = selected.filePaths[0];
	const imageNames = desktop.fs
		.readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(jpe?g|png|webp|gif|bmp|hei[cf])$/i.test(entry.name))
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right, "ja"));
	if (imageNames.length === 0) {
		new Notice("選択したフォルダに対応画像がありません。");
		return;
	}
	const saveResult = await desktop.dialog.showSaveDialog({
		title: "ISBN一覧CSVの保存先",
		defaultPath: desktop.path.join(directory, "isbn-list.csv"),
		filters: [{ name: "CSV", extensions: ["csv"] }],
	});
	if (saveResult.canceled || !saveResult.filePath) return;

	const progress = new Notice(`ISBNを読み取り中... 0/${imageNames.length}`, 0);
	const rows: IsbnCsvRow[] = [];
	let ocrEngine: OcrEngine | null = null;
	let ocrUnavailableReason = "";
	try {
		for (let index = 0; index < imageNames.length; index++) {
			const filename = imageNames[index];
			progress.setMessage(`ISBNを読み取り中... ${index + 1}/${imageNames.length}\n${filename}`);
			try {
				const sourcePath = desktop.path.join(directory, filename);
				const bytes = readImageBytes(sourcePath, /\.hei[cf]$/i.test(filename), desktop);
				let isbn = BarcodeDetectorApi ? await detectIsbn(bytes, BarcodeDetectorApi) : null;
				let status = isbn ? "detected_barcode" : "";
				if (!isbn && !ocrUnavailableReason) {
					try {
						ocrEngine ??= createOcrEngine(desktop);
						progress.setMessage(
							`ISBNをOCRで読み取り中... ${index + 1}/${imageNames.length}\n${filename}`,
						);
						isbn = extractIsbnFromOcrText(ocrEngine.recognize(sourcePath));
						if (isbn) status = "detected_ocr";
					} catch (error) {
						ocrUnavailableReason = error instanceof Error ? error.message : String(error);
						console.warn("ISBN OCRを利用できません:", error);
					}
				}
				rows.push({
					filename,
					isbn: isbn ?? "",
					status: isbn ? status : "not_found",
					error: isbn
						? ""
						: `ISBNを検出できませんでした${ocrUnavailableReason ? `（OCR: ${ocrUnavailableReason}）` : ""}`,
				});
			} catch (error) {
				rows.push({
					filename,
					isbn: "",
					status: "error",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	} finally {
		ocrEngine?.cleanup();
	}
	desktop.fs.writeFileSync(saveResult.filePath, rowsToCsv(rows), "utf8");
	progress.hide();
	const detectedCount = rows.filter((row) => row.isbn).length;
	new Notice(`CSVを作成しました。検出 ${detectedCount}冊 / 全${rows.length}画像`, 8000);
}

export async function createBookshelfFromCsv(app: App, settings: BookshelfSettings): Promise<void> {
	const desktop = getDesktopApis();
	if (!desktop) {
		new Notice("この機能はデスクトップ版 Obsidian でのみ利用できます。");
		return;
	}
	const selected = await desktop.dialog.showOpenDialog({
		title: "ISBN一覧CSVを選択",
		filters: [{ name: "CSV", extensions: ["csv"] }],
		properties: ["openFile"],
	});
	if (selected.canceled || !selected.filePaths[0]) return;
	const csvPath = selected.filePaths[0];
	const text = new TextDecoder("utf-8")
		.decode(desktop.fs.readFileSync(csvPath))
		.replace(/^\uFEFF/, "");
	const rows = parseCsv(text);
	if (rows.length === 0) {
		new Notice("CSVが空です。");
		return;
	}
	const header = rows[0].map((value) => value.trim().toLowerCase());
	const isbnColumn = header.indexOf("isbn");
	const dataRows = isbnColumn >= 0 ? rows.slice(1) : rows;
	const columnIndex = isbnColumn >= 0 ? isbnColumn : 0;
	const isbns = Array.from(
		new Set(
			dataRows
				.map((row) => toValidIsbn13(row[columnIndex] ?? ""))
				.filter((isbn): isbn is string => isbn !== null),
		),
	);
	if (isbns.length === 0) {
		new Notice("CSVに有効なISBNがありません。isbn列、または先頭列を確認してください。");
		return;
	}

	const progress = new Notice(`本棚を作成中... 0/${isbns.length}`, 0);
	let succeeded = 0;
	const failures: string[] = [];
	for (let index = 0; index < isbns.length; index++) {
		const isbn = isbns[index];
		progress.setMessage(`本棚を作成中... ${index + 1}/${isbns.length}\nISBN ${isbn}`);
		try {
			const metadata = await fetchByISBN(isbn, settings.googleBooksApiKey || undefined);
			await createBookNote(app, metadata, settings);
			succeeded++;
		} catch (error) {
			failures.push(`${isbn}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	progress.hide();
	if (failures.length > 0) {
		console.warn("CSVから本棚を作成できなかったISBN:", failures);
	}
	new Notice(
		`本棚の作成が完了しました。成功 ${succeeded}冊 / 失敗 ${failures.length}冊${failures.length ? "\n詳細は開発者コンソールを確認してください。" : ""}`,
		10000,
	);
}
