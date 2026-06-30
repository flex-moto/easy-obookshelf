import { requestUrl } from "obsidian";
import type { BookMetadata } from "./types";

export type GoogleBooksApiKeyTestStatus =
	| "success"
	| "invalid"
	| "quota-exceeded"
	| "forbidden"
	| "network-error";

export interface GoogleBooksApiKeyTestResult {
	status: GoogleBooksApiKeyTestStatus;
	message: string;
}

interface GoogleBooksApiErrorResponse {
	error?: {
		code?: number;
		message?: string;
		status?: string;
		errors?: Array<{ reason?: string }>;
		details?: Array<{
			reason?: string;
			metadata?: {
				quota_metric?: string;
				service?: string;
			};
		}>;
	};
}

export async function testGoogleBooksApiKey(apiKey: string): Promise<GoogleBooksApiKeyTestResult> {
	const key = apiKey.trim();
	if (!key) {
		return {
			status: "invalid",
			message: "APIキーが入力されていません。",
		};
	}
	const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:9784797387247&maxResults=1&key=${encodeURIComponent(key)}`;
	try {
		const response = await requestUrl({ url, throw: false });
		if (response.status === 200 && Array.isArray(response.json?.items)) {
			return {
				status: "success",
				message: "APIキーは利用可能です。Google Booksから書籍情報を取得できました。",
			};
		}
		const data = response.json as GoogleBooksApiErrorResponse | undefined;
		const error = data?.error;
		const reasons = [
			...(error?.errors?.map((item) => item.reason ?? "") ?? []),
			...(error?.details?.map((item) => item.reason ?? "") ?? []),
		]
			.join(" ")
			.toLowerCase();
		const message = (error?.message ?? "").toLowerCase();
		if (
			response.status === 429 ||
			reasons.includes("ratelimit") ||
			reasons.includes("quota") ||
			message.includes("quota") ||
			message.includes("rate limit")
		) {
			return {
				status: "quota-exceeded",
				message: "APIの割当を超過しています。Google Cloud Consoleで割当を確認してください。",
			};
		}
		if (
			reasons.includes("keyinvalid") ||
			message.includes("api key not valid") ||
			message.includes("invalid api key")
		) {
			return {
				status: "invalid",
				message: "APIキーが無効です。入力内容を確認してください。",
			};
		}
		if (response.status === 401 || response.status === 403) {
			return {
				status: "forbidden",
				message: "アクセスが拒否されました。Books APIの有効化とAPIキーの制限を確認してください。",
			};
		}
		return {
			status: "network-error",
			message: `Google Books APIの確認に失敗しました（HTTP ${response.status}）。`,
		};
	} catch (error) {
		return {
			status: "network-error",
			message: `通信エラー: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function normalizeIsbn(isbn: string): string {
	return isbn.replace(/[\s\-]/g, "");
}

function isJapaneseIsbn(isbn: string): boolean {
	return isbn.startsWith("978-4") || isbn.startsWith("9784") || isbn.startsWith("4");
}

async function fetchFromNDL(isbn: string): Promise<BookMetadata | null> {
	const url = `https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&recordSchema=dcndl&recordPacking=xml&query=isbn%3D%22${isbn}%22`;
	try {
		const response = await requestUrl({ url });
		if (response.status !== 200) return null;
		const parser = new DOMParser();
		const xml = parser.parseFromString(response.text, "text/xml");
		const numberOfRecords = xml.querySelector("numberOfRecords")?.textContent?.trim();
		if (!numberOfRecords || numberOfRecords === "0") return null;
		const getTextContent = (tagName: string, prefix?: string): string => {
			const elements = Array.from(xml.getElementsByTagNameNS("*", tagName));
			const preferred = prefix ? elements.find((element) => element.prefix === prefix) : undefined;
			return (preferred ?? elements[0])?.textContent?.trim() ?? "";
		};
		const getNestedText = (parentName: string, childName: string): string => {
			const parent = Array.from(xml.getElementsByTagNameNS("*", parentName))[0];
			if (!parent) return "";
			return (
				Array.from(parent.getElementsByTagNameNS("*", childName))[0]?.textContent?.trim() ?? ""
			);
		};
		const partInformationCount = xml.getElementsByTagNameNS("*", "partInformation").length;
		const partTitle = partInformationCount === 1 ? getNestedText("partInformation", "title") : "";
		const title = partTitle || getTextContent("title", "dcterms");
		if (!title) return null;
		const partAuthor =
			partInformationCount === 1 ? getNestedText("partInformation", "creator") : "";
		const rawAuthor =
			partAuthor || getTextContent("creator", "dc") || getTextContent("creator", "dcterms");
		const author = rawAuthor.replace(/\s*(著|編|訳|監修|原著)\s*$/, "").trim();
		const publisher = getNestedText("publisher", "name") || getTextContent("publisher", "dcterms");
		const publishDate = getTextContent("date", "dcterms") || getTextContent("issued", "dcterms");
		const pages = Number.parseInt(getTextContent("extent") || "0", 10) || 0;
		return {
			title,
			author,
			publisher,
			isbn,
			publishDate,
			pages,
			coverUrl: "",
			language: "ja",
		};
	} catch (_e) {
		return null;
	}
}

interface GoogleBooksVolumeInfo {
	title?: string;
	authors?: string[];
	publisher?: string;
	publishedDate?: string;
	pageCount?: number;
	imageLinks?: { thumbnail?: string; smallThumbnail?: string };
	language?: string;
}

async function fetchFromGoogleBooks(isbn: string, apiKey?: string): Promise<BookMetadata | null> {
	let url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
	if (apiKey) url += `&key=${apiKey}`;
	try {
		const response = await requestUrl({ url });
		if (response.status !== 200) return null;
		const data = response.json;
		if (!data.items || data.items.length === 0) return null;
		const info: GoogleBooksVolumeInfo | undefined = data.items[0].volumeInfo;
		if (!info) return null;
		const title = info.title || "";
		if (!title) return null;
		const author = (info.authors || []).join(", ");
		const publisher = info.publisher || "";
		const publishDate = info.publishedDate || "";
		const pages = info.pageCount || 0;
		const coverUrl = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || "";
		const language = info.language || "en";
		return {
			title,
			author,
			publisher,
			isbn,
			publishDate,
			pages,
			coverUrl: coverUrl.replace(/^http:/, "https:"),
			language,
		};
	} catch (_e) {
		return null;
	}
}

interface OpenLibraryBook {
	title?: string;
	authors?: { name: string }[];
	publishers?: { name: string }[];
	publish_date?: string;
	number_of_pages?: number;
	cover?: { large?: string; medium?: string };
	languages?: { key: string }[];
}

async function fetchFromOpenLibrary(isbn: string): Promise<BookMetadata | null> {
	const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
	try {
		const response = await requestUrl({ url });
		if (response.status !== 200) return null;
		const data = response.json;
		const book: OpenLibraryBook | undefined = data[`ISBN:${isbn}`];
		if (!book) return null;
		const title = book.title || "";
		if (!title) return null;
		const author = (book.authors || []).map((a) => a.name).join(", ");
		const publisher = (book.publishers || []).map((p) => p.name).join(", ");
		const publishDate = book.publish_date || "";
		const pages = book.number_of_pages || 0;
		const coverUrl = book.cover?.large || book.cover?.medium || "";
		const languages = book.languages || [{ key: "/languages/eng" }];
		const language = languages[0]?.key?.split("/").pop() === "jpn" ? "ja" : "en";
		return {
			title,
			author,
			publisher,
			isbn,
			publishDate,
			pages,
			coverUrl: coverUrl.replace(/^http:/, "https:"),
			language,
		};
	} catch (_e) {
		return null;
	}
}

interface OpenBDSummary {
	isbn?: string;
	title?: string;
	volume?: string;
	series?: string;
	publisher?: string;
	pubdate?: string;
	cover?: string;
	author?: string;
}

interface OpenBDRecord {
	summary?: OpenBDSummary;
}

async function fetchFromOpenBD(isbn: string): Promise<BookMetadata | null> {
	const url = `https://api.openbd.jp/v1/get?isbn=${isbn}`;
	try {
		const response = await requestUrl({ url });
		if (response.status !== 200) return null;
		const data = response.json as (OpenBDRecord | null)[] | null;
		if (!Array.isArray(data) || data.length === 0) return null;
		const record = data[0];
		const summary = record?.summary;
		if (!summary) return null;
		const title = summary.title || "";
		if (!title) return null;
		const author = summary.author || "";
		const publisher = summary.publisher || "";
		const publishDate = summary.pubdate || "";
		const coverUrl = summary.cover || "";
		return {
			title,
			author,
			publisher,
			isbn,
			publishDate,
			pages: 0,
			coverUrl: coverUrl.replace(/^http:/, "https:"),
			language: "ja",
		};
	} catch (_e) {
		return null;
	}
}

function buildCoverUrl(isbn: string, metadata: BookMetadata): string {
	if (metadata.coverUrl) return metadata.coverUrl;
	if (isJapaneseIsbn(isbn)) {
		return `https://thumbnail-s.images.books.or.jp/${isbn}.jpg`;
	}
	return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
}

export async function fetchByISBN(isbn: string, googleBooksApiKey?: string): Promise<BookMetadata> {
	const normalized = normalizeIsbn(isbn);
	let metadata: BookMetadata | null = null;
	if (isJapaneseIsbn(normalized)) {
		metadata = await fetchFromNDL(normalized);
	}
	if (!metadata) {
		metadata = await fetchFromGoogleBooks(normalized, googleBooksApiKey);
	}
	if (!metadata) {
		metadata = await fetchFromOpenLibrary(normalized);
	}
	if (!metadata) {
		throw new Error(`書籍情報が見つかりませんでした: ISBN ${normalized}`);
	}
	if (!metadata.coverUrl) {
		let forCover: BookMetadata | null = null;
		if (isJapaneseIsbn(normalized)) {
			const openBdMetadata = await fetchFromOpenBD(normalized);
			if (openBdMetadata?.coverUrl) {
				forCover = openBdMetadata;
			}
		}
		if (!forCover?.coverUrl) {
			const googleMetadata = await fetchFromGoogleBooks(normalized, googleBooksApiKey);
			if (googleMetadata?.coverUrl) {
				forCover = googleMetadata;
			}
		}
		if (!forCover?.coverUrl) {
			const openLibraryMetadata = await fetchFromOpenLibrary(normalized);
			if (openLibraryMetadata?.coverUrl) {
				forCover = openLibraryMetadata;
			}
		}
		if (forCover?.coverUrl) {
			metadata.coverUrl = forCover.coverUrl;
		}
	}
	metadata.coverUrl = buildCoverUrl(normalized, metadata);
	return metadata;
}
