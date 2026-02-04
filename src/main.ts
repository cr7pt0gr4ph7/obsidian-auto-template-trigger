import { Plugin, TFile } from "obsidian";
import { shouldPreventTriggerIfTemplaterPluginUsed } from "./utils/templaterPluginUtils";
import {
	DEFAULT_SETTINGS,
	PluginSettings,
	Settings,
} from "./settings/Settings";
import {
	getTemplateFiles,
	getTemplatesFolder,
	isMarkdown,
	setPromptOpacity,
} from "utils/utils";

const INSERT_TEMPLATE_COMMAND = "insert-template";

export default class AutoTemplatePromptPlugin extends Plugin {
	isReady = false;
	settings: PluginSettings;
	focusedFile?: TFile;

	async onload() {
		setPromptOpacity(1);

		this.app.workspace.onLayoutReady(() => {
			this.isReady = true;
		});
		await this.loadSettings();

		this.addSettingTab(new Settings(this.app, this));

		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				this.focusedFile = undefined;

				if (!file) {
					return;
				}

				this.logGroup("[Auto Template Prompt] 📙 " + file.name);
				const shouldTriggerPrompt =
					await this.shouldTriggerTemplatePrompt(file);

				if (!shouldTriggerPrompt) {
					this.log('❌ No action')
				} else if (this.settings.deferPromptUntilNamed) {
					this.log("ℹ️ Deferring template prompt until the new file is renamed")
					this.focusedFile = file;
				} else {
					await this.handleTemplateTrigger();
				}

				this.logGroupEnd()
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				// Handle renames of template files and associated folders
				let settingsChanged = false;
				const folderSpecificTemplates = this.settings.folderSpecificTemplates;
				for (let i = 0; i < folderSpecificTemplates.length; i++) {
					const item = folderSpecificTemplates[i];

					// Track renames of folders with associated templates
					if (item.folderPath === oldPath) {
						item.folderPath = file.path;
						settingsChanged = true;
					} else if (item.folderPath.startsWith(oldPath + "/")) {
						item.folderPath = file.path + item.folderPath.slice(oldPath.length);
						settingsChanged = true;
					}

					// Track renames of template files
					if (item.templateName === oldPath) {
						item.templateName = file.path;
						settingsChanged = true;
					} else if (item.templateName.startsWith(oldPath + "/")) {
						item.templateName = file.path + item.templateName.slice(oldPath.length);
						settingsChanged = true;
					}
				}
				if (settingsChanged) {
					await this.saveSettings();
				}

				// Handle renames of newly created files
				if (!this.settings.deferPromptUntilNamed) {
					this.focusedFile = undefined;
					return;
				}

				this.log("ℹ️ Rename detected: " + oldPath + " => " + file.path);

				if (this.focusedFile === file) {
					this.logGroup("[Deferrred Auto Template Prompt] 📙 " + file.name);
					const shouldTriggerPrompt =
						await this.shouldTriggerTemplatePrompt(file as TFile);

					if (shouldTriggerPrompt) {
						await this.handleTemplateTrigger();
					} else {
						this.log('❌ No action');
					}

					this.logGroupEnd()
				} else {
					this.log('❌ Renamed file is unrelated to new file');
				}

				this.focusedFile = undefined;
			})
		);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async shouldTriggerTemplatePrompt(file: TFile): Promise<boolean> {
		if (!this.isReady) {
			this.log('ℹ️ Plugin is not yet ready');
			return false;
		}


		if (!isMarkdown(file)) {
			this.log('ℹ️ File is not markdown');
			return false;
		}

		const isFileNew = file.stat.ctime === file.stat.mtime;
		const isFileEmpty = file.stat.size === 0;
		const isFileFocused = this.app.workspace.getActiveFile()?.path === file.path;

		if (!isFileFocused) {
			this.log('ℹ️ File is not focused');
			return false
		}

		if (!isFileNew) {
			this.log('ℹ️ File is not new');
			return false;
		}

		if (!isFileEmpty) {
			this.log('ℹ️ File is not empty');
			return false;
		}

		const templatesFolder = await getTemplatesFolder(this.app);
		const isFileInTemplatesFolder = file.path.startsWith(templatesFolder);

		if (!templatesFolder || isFileInTemplatesFolder) {
			this.log('ℹ️ File is in templates folder');
			return false;
		}

		if (shouldPreventTriggerIfTemplaterPluginUsed(this, file)) {
			this.log('ℹ️ Templater plugin is used');
			return false;
		}

		return true;
	}

	async handleTemplateTrigger() {
		const templateFiles = await getTemplateFiles(this.app);
		if (templateFiles.length === 0) {
			console.error("⚠️ No templates found");
			return;
		}

		if (templateFiles.length === 1) {
			this.log('✔️ Apply the only template: ', templateFiles[0].basename);
			this.applySpecificTemplate(templateFiles[0].basename);
			return;
		}

		if (templateFiles.length > 1) {
			const mightHaveAssignedTemplate =
				this.settings.folderSpecificTemplates.length >= 0;

			const assignedTemplate = mightHaveAssignedTemplate
				? this.findAssignedTemplate()
				: null;

			if (assignedTemplate) {
				this.log('✔️ Apply folder specific template: ', assignedTemplate);
				this.applySpecificTemplate(assignedTemplate);
				return;
			}

			if (!this.settings.disablePrompt) {
				this.log("✔️ Prompting for a template");
				this.triggerTemplateSelectorPrompt();
				return;
			}

			this.log("ℹ️ Promtpting is disabled, and no folder specific template found")
			this.log('❌ No action')
		}

	}

	log(...args: Parameters<Console["debug"]>) {
		if (this.settings.debug) {
			console.log(...args);
		}
	}

	logGroup(...args: Parameters<Console["group"]>) {
		if (this.settings.debug) {
			console.group(...args);
		}
	}
	logGroupEnd() {
		if (this.settings.debug) {
			console.groupEnd();
		}
	}

	findAssignedTemplate() {
		const currentFolder = this.app.workspace.getActiveFile()?.parent;

		if (!currentFolder) {
			console.error("findAssignedTemplate: No active folder");
			return;
		}

		const rootFolder = "/";
		const pathFragments = currentFolder.path.split("/");

		// get the possible paths, for which we can have assigned templates in the settings
		// eg.: "/", "/folder1", "/folder1/folder2"
		const possiblePaths = pathFragments.reduce(
			(prevPaths, pathFragment) => {
				if (!prevPaths.length) {
					return [pathFragment];
				} else {
					const prevPath = prevPaths[prevPaths.length - 1];
					const newPath = [prevPath, pathFragment].join("/");
					return [...prevPaths, newPath];
				}
			},
			[]
		);
		possiblePaths.push(rootFolder);
		possiblePaths.sort((a, b) => b.length - a.length); // longest paths first, so the first match is the most specific one

		let assignedTemplateSetting:
			| PluginSettings["folderSpecificTemplates"][0]
			| undefined;

		possiblePaths.forEach((path) => {
			if (assignedTemplateSetting) {
				return;
			}
			const foundSetting = this.settings.folderSpecificTemplates.find(
				({ folderPath }) => folderPath === path
			);
			assignedTemplateSetting = foundSetting;
		});
		return assignedTemplateSetting?.templateName;
	}

	applySpecificTemplate(templateName: string) {
		const templatesPlugin: {
			insertTemplate(templateFile: TFile): void
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} = (this.app as any).internalPlugins.plugins.templates.instance;

		const templatePath = templateName;
		const templateFile = this.app.vault.getFileByPath(templatePath);
		if (!templateFile) {
			console.error("⚠️ Template file not found: " + templatePath);
			return;
		}

		templatesPlugin.insertTemplate(templateFile);
	}

	triggerTemplateSelectorPrompt() {
		//@ts-expect-error
		this.app.commands.executeCommandById(INSERT_TEMPLATE_COMMAND);
	}
}
