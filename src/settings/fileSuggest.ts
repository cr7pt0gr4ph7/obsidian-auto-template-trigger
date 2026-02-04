import { AbstractInputSuggest, TAbstractFile, TFile, TFolder } from "obsidian";
import { getTemplatesFolder } from "../utils/utils";

export class TemplateSuggest extends AbstractInputSuggest<TFile> {
	override async getSuggestions(inputStr: string): Promise<TFile[]> {
		const templatesFolder = await getTemplatesFolder(this.app);
		if (!templatesFolder) {
			return [];
		}
		const templateFiles = this.app.vault
			.getAllLoadedFiles();
		const files: TFile[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		templateFiles.forEach((file: TAbstractFile) => {
			if (
				file instanceof TFile &&
				file.extension === "md" &&
				file.path.toLowerCase().contains(lowerCaseInputStr)
			) {
				files.push(file);
			}
		});

		return files;
	}

	override renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	override selectSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(file.path);
		this.close();
	}
}

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	override async getSuggestions(inputStr: string): Promise<TFolder[]> {
		const templatesFolder = await getTemplatesFolder(this.app);

		const abstractFiles = this.app.vault.getAllLoadedFiles();
		const folders: TFolder[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();
		abstractFiles.forEach((folder: TAbstractFile) => {
			if (
				folder instanceof TFolder &&
				folder.path.toLowerCase().contains(lowerCaseInputStr) &&
				folder.path &&
				folder.path !== templatesFolder
			) {
				folders.push(folder);
			}
		});

		return folders;
	}

	override renderSuggestion(file: TFolder, el: HTMLElement): void {
		el.setText(file.path);
	}

	override selectSuggestion(file: TFolder): void {
		this.setValue(file.path);
		this.close();
	}
}
