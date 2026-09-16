# Creation Trigger

Creation Trigger creates a Markdown metadata note for supported attachments in an Obsidian vault.

## Features

- Creates metadata notes for new and existing attachments.
- Keeps metadata notes synchronized when attachments are moved, renamed, or deleted.
- Can open an attachment through its metadata note.
- Can rewrite normal attachment links to point to metadata notes while preserving embeds, aliases, and headings.
- Supports configurable metadata folders and templates.

## Development

Install dependencies and build the plugin with npm:

```bash
npm install
npm run build
```

During development, use `npm run dev` to watch and rebuild the plugin.

## Metadata templates

The default template is `resources/_template.md`. Templates support these variables:

- `{{file.name}}`
- `{{file.basename}}`
- `{{file.path}}`
- `{{file.extension}}`
- `{{file.folder}}`
- `{{metadata.path}}`
- `{{date}}`

The plugin stores metadata notes under `resources` by default. Both values can be changed in the plugin settings.
