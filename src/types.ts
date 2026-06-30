export type DuplicateIsbnAction = "open" | "overwrite" | "create-new";

export type BookStatus = "to-read" | "reading" | "completed" | "abandoned";

export interface BookshelfSettings {
	booksFolder: string;
	coversFolder: string;
	googleBooksApiKey: string;
	duplicateIsbnAction: DuplicateIsbnAction;
	defaultStatus: BookStatus;
	defaultProgress: number;
}

export const DEFAULT_SETTINGS: BookshelfSettings = {
	booksFolder: "Books",
	coversFolder: "Books/covers",
	googleBooksApiKey: "",
	duplicateIsbnAction: "open",
	defaultStatus: "to-read",
	defaultProgress: 0,
};

export interface BookMetadata {
	title: string;
	author: string;
	publisher: string;
	isbn: string;
	publishDate: string;
	pages: number;
	coverUrl: string;
	coverUrls?: string[];
	language: string;
	description?: string;
}

export interface BookNoteFrontmatter {
	title?: string;
	author?: string;
	publisher?: string;
	isbn?: string;
	publishDate?: string;
	pages?: number;
	cover?: string;
	status?: BookStatus | string;
	progress?: number;
	startDate?: string;
	endDate?: string;
	rating?: number;
	language?: string;
	tags?: string[];
	[key: string]: unknown;
}
