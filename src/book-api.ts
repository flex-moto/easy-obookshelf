import { requestUrl } from "obsidian";
import type { BookMetadata } from "./types";

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
		const getTextContent = (tagName: string): string => {
			const elements = xml.getElementsByTagNameNS("*", tagName);
			for (let i = 0; i < elements.length; i++) {
				const text = elements[i].textContent?.trim();
				if (text) return text;
			}
			return "";
		};
		const title = getTextContent("title") || "";
		if (!title) return null;
		const author = getTextContent("creator") || getTextContent("contributor") || "";
		const publisher = getTextContent("publisher") || "";
		const publishDate = getTextContent("date") || "";
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

function buildCoverUrl(isbn: string, metadata: BookMetadata): string {
	if (metadata.coverUrl) return metadata.coverUrl;
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
		const forCover =
			(await fetchFromGoogleBooks(normalized, googleBooksApiKey)) ??
			(await fetchFromOpenLibrary(normalized));
		if (forCover?.coverUrl) {
			metadata.coverUrl = forCover.coverUrl;
		}
	}
	metadata.coverUrl = buildCoverUrl(normalized, metadata);
	return metadata;
}
