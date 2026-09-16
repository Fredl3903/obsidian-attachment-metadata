import { App, PluginSettingTab, Setting } from 'obsidian';
import type CreationTrigger from './main';

export interface CreationTriggerSettings {
	metadataFolder: string;
	templatePath: string;
	redirectAttachmentOpens: boolean;
	rewriteAttachmentLinks: boolean;
}

export const DEFAULT_SETTINGS: CreationTriggerSettings = {
	metadataFolder: 'resources',
	templatePath: 'resources/_template.md',
	redirectAttachmentOpens: true,
	rewriteAttachmentLinks: true,
};

export class CreationTriggerSettingTab extends PluginSettingTab {
	plugin: CreationTrigger;

	constructor(app: App, plugin: CreationTrigger) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Attachment metadata')
			.setHeading();

		new Setting(containerEl)
			.setName('Metadata folder')
			.setDesc('Root folder in which metadata files are stored.')
			.addText(text => text
				.setPlaceholder('resources')
				.setValue(this.plugin.settings.metadataFolder)
				.onChange(async (value) => {
					this.plugin.settings.metadataFolder = value.trim().replace(/\/+$/, '');
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Metadata template')
			.setDesc('Vault path to the Markdown template used for new metadata files.')
			.addText(text => text
				.setPlaceholder('resources/_template.md')
				.setValue(this.plugin.settings.templatePath)
				.onChange(async (value) => {
					this.plugin.settings.templatePath = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Open attachments through metadata')
			.setDesc('When enabled, opening a tracked attachment opens its metadata file instead.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.redirectAttachmentOpens)
				.onChange(async (value) => {
					this.plugin.settings.redirectAttachmentOpens = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Rewrite attachment links')
			.setDesc('When enabled, links to tracked attachments point to their metadata files.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.rewriteAttachmentLinks)
				.onChange(async (value) => {
					this.plugin.settings.rewriteAttachmentLinks = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
