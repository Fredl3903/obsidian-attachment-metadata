import {
    Plugin,
    TFile,
    Notice,
} from 'obsidian';

import { extensions } from './constants';
import {
    CreationTriggerSettings,
    CreationTriggerSettingTab,
    DEFAULT_SETTINGS
} from './settings';

export default class CreationTrigger extends Plugin {

    settings!: CreationTriggerSettings;

    // Prevents our own file operations from triggering
    // the opposite synchronization operation.
    private syncing = false;

    // Prevents the attachment-open redirect from firing when
    // an attachment is being opened as part of its metadata note.
    private openingMetadata = false;

    async onload() {

        await this.loadSettings();

        // Add the settings tab
        this.addSettingTab(
            new CreationTriggerSettingTab(this.app, this)
        );

        // --------------------------------------------------
        // CREATE
        // --------------------------------------------------

        this.registerEvent(
            this.app.vault.on("create", async (file) => {

                if (!(file instanceof TFile)) {
                    return;
                }

                // New asset
                if (this.isTrackedFile(file)) {
                    await this.createMetadataFile(file);
                }
            })
        );

        // --------------------------------------------------
        // RENAME / MOVE
        // --------------------------------------------------

        this.registerEvent(
            this.app.vault.on("rename", async (file, oldPath) => {

                if (!(file instanceof TFile) || this.syncing) {
                    return;
                }

                // Asset renamed/moved
                if (this.isTrackedFile(file)) {
                    await this.handleAssetRename(file, oldPath);
                    return;
                }

                // Metadata renamed/moved
                if (this.isMetadataFile(file)) {
                    await this.handleMetadataRename(file, oldPath);
                }
            })
        );

        // --------------------------------------------------
        // DELETE
        // --------------------------------------------------

        this.registerEvent(
            this.app.vault.on("delete", async (file) => {

                if (!(file instanceof TFile) || this.syncing) {
                    return;
                }

                // Asset deleted
                if (this.isTrackedFile(file)) {
                    await this.handleAssetDelete(file);
                    return;
                }

                // Metadata deleted
                if (this.isMetadataFile(file)) {
                    await this.handleMetadataDelete(file);
                }
            })
        );

        this.registerEvent(
            this.app.vault.on("modify", (file) => {
                if (!this.settings.rewriteAttachmentLinks) return;
                if (!(file instanceof TFile)) return;
                if (file.extension !== "md") return;

                // Give Obsidian's metadata/link cache a moment to catch up
                // before attempting to resolve newly-added links.
                window.setTimeout(() => {
                    void this.rewriteAttachmentLinks(file);
                }, 100);
            })
        );

        // --------------------------------------------------
        // OPEN
        // --------------------------------------------------

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async (leaf) => {
                if (!this.settings.redirectAttachmentOpens) return;
                if (!leaf || this.openingMetadata) return;

                const state = leaf.getViewState();
                const filePath = state.state?.file;

                if (typeof filePath !== "string") return;

                const file =
                    this.app.vault.getAbstractFileByPath(filePath);

                if (!(file instanceof TFile)) return;
                if (!this.isTrackedFile(file)) return;

                const metadataPath = this.getMetadataPath(file.path);
                const metadataFile =
                    this.app.vault.getAbstractFileByPath(metadataPath);

                if (!(metadataFile instanceof TFile)) return;

                this.openingMetadata = true;

                try {
                    await leaf.openFile(metadataFile);
                } finally {
                    this.openingMetadata = false;
                }
            })
        );

        // --------------------------------------------------
        // STARTUP
        // --------------------------------------------------

        // Handle files that were added while Obsidian was closed.
        await this.processExistingFiles();
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            (await this.loadData()) as Partial<CreationTriggerSettings>
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // ======================================================
    // FILE TYPE CHECKS
    // ======================================================

    /**
     * Determine whether a file is an attachment that should
     * have a metadata file.
     */
    private isTrackedFile(file: TFile): boolean {

        // Never treat anything inside the metadata folder
        // as an attachment.
        if (
            file.path === this.settings.metadataFolder ||
            file.path.startsWith(
                this.settings.metadataFolder + "/"
            )
        ) {
            return false;
        }

        return file.extension in extensions;
    }

    /**
     * Determine whether a file is one of our metadata files.
     */
    private isMetadataFile(file: TFile): boolean {

        const prefix =
            this.settings.metadataFolder + "/";

        return (
            file.path.startsWith(prefix) &&
            file.path.endsWith(".info.md")
        );
    }

    // ======================================================
    // PATH CONVERSION
    // ======================================================

    /**
     * Convert an asset path into its metadata path.
     *
     * Example:
     *
     * notes/assets/image.png
     *
     * ->
     *
     * resources/notes/assets/image.png.info.md
     */
    private getMetadataPath(assetPath: string): string {

        return `${this.settings.metadataFolder}/${assetPath}.info.md`;
    }

    /**
     * Convert a metadata path back into its asset path.
     *
     * Example:
     *
     * resources/notes/assets/image.png.info.md
     *
     * ->
     *
     * notes/assets/image.png
     */
    private getAssetPath(metadataPath: string): string {

        const prefix =
            this.settings.metadataFolder + "/";

        if (!metadataPath.startsWith(prefix)) {
            return "";
        }

        return metadataPath
            .substring(prefix.length)
            .replace(/\.info\.md$/, "");
    }

    // ======================================================
    // STARTUP PROCESSING
    // ======================================================

    /**
     * Scan the vault when Obsidian starts.
     *
     * This catches assets that were added while Obsidian
     * was closed.
     */
    private async processExistingFiles() {
        const files = this.app.vault.getFiles();

        for (const file of files) {
            if (this.isTrackedFile(file)) {
                await this.createMetadataFile(file);
            }
        }

        if (this.settings.rewriteAttachmentLinks) {
            for (const file of files) {
                if (
                    file instanceof TFile &&
                    file.extension === "md" &&
                    !this.isMetadataFile(file)
                ) {
                    await this.rewriteAttachmentLinks(file);
                }
            }
        }
    }

    // ======================================================
    // CREATE METADATA
    // ======================================================

    /**
     * Create a metadata file for an attachment.
     */
    private async createMetadataFile(file: TFile) {

        const metadataPath =
            this.getMetadataPath(file.path);

        // Don't create it if it already exists.
        if (
            this.app.vault.getAbstractFileByPath(
                metadataPath
            )
        ) {
            return;
        }

        // Make sure the directory structure exists.
        const metadataDirectory =
            this.getParentDirectory(metadataPath);

        await this.ensureDirectory(metadataDirectory);

        // Generate the metadata content from the template.
        const content =
            await this.getTemplateContent(file);

        this.syncing = true;

        try {

            await this.app.vault.create(
                metadataPath,
                content
            );

            new Notice(
                "Metadata note created for " + file.name
            );

        } finally {

            this.syncing = false;
        }
    }

    // ======================================================
    // TEMPLATE
    // ======================================================

    /**
     * Read the configured template and replace its variables.
     */
    private async getTemplateContent(file: TFile): Promise<string> {

        const templateFile =
            this.app.vault.getAbstractFileByPath(
                this.settings.templatePath
            );

        // If no template exists, use a basic default.
        if (!(templateFile instanceof TFile)) {

            return [
                "---",
                `source: ${file.path}`,
                `type: ${file.extension}`,
                "---",
                "",
                `# ${file.basename}`,
                "",
                `![[${file.path}]]`,
                ""
            ].join("\n");
        }

        let content =
            await this.app.vault.read(templateFile);

        const folder =
            this.getParentDirectory(file.path);

        const metadataPath =
            this.getMetadataPath(file.path);

        content = content
            .replace(/\{\{file\.name\}\}/g, file.name)
            .replace(/\{\{file\.basename\}\}/g, file.basename)
            .replace(/\{\{file\.path\}\}/g, file.path)
            .replace(/\{\{file\.extension\}\}/g, file.extension)
            .replace(/\{\{file\.folder\}\}/g, folder)
            .replace(/\{\{metadata\.path\}\}/g, metadataPath)
            .replace(/\{\{date\}\}/g, this.getDate());

        return content;
    }

    /**
     * Return today's date as YYYY-MM-DD.
     */
    private getDate(): string {

        const date = new Date();

        const year =
            date.getFullYear();

        const month =
            String(date.getMonth() + 1).padStart(2, "0");

        const day =
            String(date.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    // ======================================================
    // ASSET RENAME / MOVE
    // ======================================================

    private async handleAssetRename(
        file: TFile,
        oldPath: string
    ) {

        const oldMetadataPath =
            this.getMetadataPath(oldPath);

        const newMetadataPath =
            this.getMetadataPath(file.path);

        const oldMetadata =
            this.app.vault.getAbstractFileByPath(
                oldMetadataPath
            );

        // No metadata file exists.
        // Create one at the new location.
        if (!(oldMetadata instanceof TFile)) {

            await this.createMetadataFile(file);
            return;
        }

        const newDirectory =
            this.getParentDirectory(newMetadataPath);

        await this.ensureDirectory(newDirectory);

        // Don't overwrite an existing metadata file.
        if (
            oldMetadataPath !== newMetadataPath &&
            !this.app.vault.getAbstractFileByPath(
                newMetadataPath
            )
        ) {

            this.syncing = true;

            try {

                await this.app.vault.rename(
                    oldMetadata,
                    newMetadataPath
                );

            } finally {

                this.syncing = false;
            }
        }
    }

    // ======================================================
    // ASSET DELETE
    // ======================================================

    private async handleAssetDelete(file: TFile) {

        const metadataPath =
            this.getMetadataPath(file.path);

        const metadata =
            this.app.vault.getAbstractFileByPath(
                metadataPath
            );

        if (!metadata) {
            return;
        }

        this.syncing = true;

        try {

            await this.app.vault.delete(metadata);

        } finally {

            this.syncing = false;
        }
    }

    // ======================================================
    // METADATA RENAME / MOVE
    // ======================================================

    private async handleMetadataRename(
        file: TFile,
        oldPath: string
    ) {

        const oldAssetPath =
            this.getAssetPath(oldPath);

        const newAssetPath =
            this.getAssetPath(file.path);

        if (!oldAssetPath || !newAssetPath) {
            return;
        }

        const asset =
            this.app.vault.getAbstractFileByPath(
                oldAssetPath
            );

        if (!(asset instanceof TFile)) {
            return;
        }

        const newDirectory =
            this.getParentDirectory(newAssetPath);

        await this.ensureDirectory(newDirectory);

        // Don't overwrite an existing asset.
        if (
            oldAssetPath !== newAssetPath &&
            !this.app.vault.getAbstractFileByPath(
                newAssetPath
            )
        ) {

            this.syncing = true;

            try {

                await this.app.vault.rename(
                    asset,
                    newAssetPath
                );

            } finally {

                this.syncing = false;
            }
        }
    }

    // ======================================================
    // METADATA DELETE
    // ======================================================

    private async handleMetadataDelete(file: TFile) {

        const assetPath =
            this.getAssetPath(file.path);

        if (!assetPath) {
            return;
        }

        const asset =
            this.app.vault.getAbstractFileByPath(
                assetPath
            );

        if (!asset) {
            return;
        }

        this.syncing = true;

        try {

            await this.app.vault.delete(asset);

        } finally {

            this.syncing = false;
        }
    }

    // ======================================================
    // DIRECTORY UTILITIES
    // ======================================================

    /**
     * Return the directory portion of a path.
     *
     * Example:
     *
     * resources/notes/assets/image.png.info.md
     *
     * ->
     *
     * resources/notes/assets
     */
    private getParentDirectory(path: string): string {

        const lastSlash =
            path.lastIndexOf("/");

        if (lastSlash === -1) {
            return "";
        }

        return path.substring(
            0,
            lastSlash
        );
    }

    /**
     * Recursively create a directory and all missing
     * parent directories.
     */
    private async ensureDirectory(path: string) {

        if (!path) {
            return;
        }

        // Already exists.
        if (
            this.app.vault.getAbstractFileByPath(path)
        ) {
            return;
        }

        const parent =
            this.getParentDirectory(path);

        if (parent) {
            await this.ensureDirectory(parent);
        }

        // Check again in case it was created while
        // creating the parent.
        if (
            !this.app.vault.getAbstractFileByPath(path)
        ) {
            await this.app.vault.createFolder(path);
        }
    }

    private rewritingLinks = false;

    private async rewriteAttachmentLinks(file: TFile) {
        if (this.rewritingLinks) return;
        if (file.extension !== "md") return;

        // Don't rewrite the metadata files themselves. Their embedded
        // attachment links are intentionally supposed to point to the
        // real attachment.
        if (this.isMetadataFile(file)) return;

        let content = await this.app.vault.read(file);
        const originalContent = content;

        // Protect fenced code blocks so example wikilinks are not changed.
        const codeBlocks: string[] = [];

        content = content.replace(
            /```[\s\S]*?```/g,
            (match: string) => {
                const index = codeBlocks.length;
                codeBlocks.push(match);
                return `@@CREATION_TRIGGER_CODE_BLOCK_${index}@@`;
            }
        );

        // Rewrite normal Obsidian wikilinks, but NOT embeds.
        //
        // Rewrites:
        //   [[image.jpg]]
        //   [[image.jpg|My image]]
        //   [[image.jpg#heading]]
        //   [[image.jpg^block-id]]
        //
        // Leaves these alone:
        //   ![[image.jpg]]
        //   ![[image.jpg|My image]]
        //   ![[image.jpg#heading]]
        //
        // The metadata file itself will contain the embed:
        //   ![[image.jpg]]
        //
        // so embeds should continue pointing to the real attachment.
        content = content.replace(
            /(!?)\[\[([^\]|]+?)(\|[^\]]+)?\]\]/g,
            (
                match: string,
                embedPrefix: string,
                target: string,
                alias: string | undefined
            ): string => {

                // If this is an embed (![[...]]), leave it completely unchanged.
                if (embedPrefix === "!") {
                    return match;
                }

                const cleanTarget = target.trim();

                if (!cleanTarget) {
                    return match;
                }

                // Already points to a metadata file.
                if (cleanTarget.endsWith(".info.md")) {
                    return match;
                }

                // Don't touch external links.
                if (
                    cleanTarget.startsWith("http://") ||
                    cleanTarget.startsWith("https://")
                ) {
                    return match;
                }

                // Separate heading/block references from the actual file path.
                //
                // image.jpg#heading
                // image.jpg^block-id
                let fileTarget = cleanTarget;
                let reference = "";

                const referenceIndex = cleanTarget.search(/[#^]/);

                if (referenceIndex !== -1) {
                    fileTarget = cleanTarget.substring(0, referenceIndex);
                    reference = cleanTarget.substring(referenceIndex);
                }

                fileTarget = fileTarget.trim();

                if (!fileTarget) {
                    return match;
                }

                // Resolve the linked file.
                const linkedFile = this.resolveVaultFile(
                    fileTarget,
                    file.path
                );

                if (!(linkedFile instanceof TFile)) {
                    return match;
                }

                // Only rewrite configured attachment types.
                if (!this.isTrackedFile(linkedFile)) {
                    return match;
                }

                // Convert:
                //
                // [[image.jpg]]
                //
                // into:
                //
                // [[resources/path/image.jpg.info.md]]
                //
                // while preserving aliases and references:
                //
                // [[image.jpg|My image]]
                // -> [[resources/path/image.jpg.info.md|My image]]
                //
                // [[image.jpg#heading]]
                // -> [[resources/path/image.jpg.info.md#heading]]
                //
                // [[image.jpg#heading|My image]]
                // -> [[resources/path/image.jpg.info.md#heading|My image]]
                const metadataPath =
                    this.getMetadataPath(linkedFile.path);

                return (
                    "[[" +
                    metadataPath +
                    reference +
                    (alias || "") +
                    "]]"
                );
            }
        );

        // Restore protected code blocks.
        content = content.replace(
            /@@CREATION_TRIGGER_CODE_BLOCK_(\d+)@@/g,
            (_match: string, index: string) =>
                codeBlocks[Number(index)] ?? ""
        );

        if (content === originalContent) {
            return;
        }

        this.rewritingLinks = true;

        try {
            await this.app.vault.modify(file, content);
        } finally {
            this.rewritingLinks = false;
        }
    }

    /**
     * Resolve an Obsidian link target to a real vault file.
     *
     * We normally let Obsidian's metadata cache resolve the link, but also
     * fall back to direct vault-path checks. This makes the rewrite more
     * reliable immediately after a file/link is created, before the cache
     * has fully caught up.
     */
    private resolveVaultFile(
        linkPath: string,
        sourcePath: string
    ): TFile | null {

        let cleanPath = linkPath.trim();

        if (cleanPath.startsWith("/")) {
            cleanPath = cleanPath.substring(1);
        }

        // First: use Obsidian's normal link resolution.
        const resolved =
            this.app.metadataCache.getFirstLinkpathDest(
                cleanPath,
                sourcePath
            );

        if (resolved instanceof TFile) {
            return resolved;
        }

        // Second: treat the target as an exact vault path.
        const exact =
            this.app.vault.getAbstractFileByPath(cleanPath);

        if (exact instanceof TFile) {
            return exact;
        }

        // Third: try a path relative to the note containing the link.
        const sourceFolder =
            this.getParentDirectory(sourcePath);

        const relativePath =
            sourceFolder
                ? `${sourceFolder}/${cleanPath}`
                : cleanPath;

        const relative =
            this.app.vault.getAbstractFileByPath(relativePath);

        if (relative instanceof TFile) {
            return relative;
        }

        // Last: if the target is just a filename, use it when there is
        // exactly one matching tracked attachment in the vault.
        const basename =
            cleanPath.split("/").pop();

        if (!basename) {
            return null;
        }

        const candidates =
            this.app.vault
                .getFiles()
                .filter(candidate =>
                    candidate.name === basename &&
                    this.isTrackedFile(candidate)
                );

        if (candidates.length === 1) {
            return candidates[0]!;
        }

        return null;
    }

}