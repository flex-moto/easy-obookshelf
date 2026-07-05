export interface OpenDialogResult {
	canceled: boolean;
	filePaths: string[];
}

export interface SaveDialogResult {
	canceled: boolean;
	filePath?: string;
}

export interface ElectronDialog {
	showOpenDialog(options: Record<string, unknown>): Promise<OpenDialogResult>;
	showSaveDialog(options: Record<string, unknown>): Promise<SaveDialogResult>;
}

interface ElectronModule {
	dialog?: ElectronDialog;
	remote?: {
		dialog?: ElectronDialog;
	};
}

type WindowRequire = (moduleName: string) => unknown;

export function getWindowRequire(): WindowRequire | undefined {
	return (window as Window & { require?: WindowRequire }).require;
}

export function getElectronDialog(windowRequire: WindowRequire): ElectronDialog | undefined {
	const electron = windowRequire("electron") as ElectronModule;
	return electron.remote?.dialog ?? electron.dialog;
}
