**JavaScript Standard Style** automatically lints all open files, then reports errors and warnings in Nova's **Issues** sidebar and the editor gutter.

![Screenshot of Nova.app running the JavaScript Standard Style extension](https://raw.githubusercontent.com/klaemo/nova-standardjs/main/Images/screenshot.png)

Even though `standard` treats all rule violations as errors, this extensions (in order to reduce visual clutter) displays auto-fixable issues as "hints" and all other issues as "errors".

## Features

- supported syntaxes: `javascript`, `jsx`, `markdown`, `html`
- `Fix all auto-fixable issues` command that can be invoked through the command palette
- `Auto-fix on save` configurable globally and on a per-workspace basis (off by default)
- uses **locally** installed `standard` only

## Requirements

<!--
🎈 If your extension depends on external processes or tools that users will need to have, it's helpful to list those and provide links to their installers:
-->

JavaScript Standard Style requires some additional tools to be installed on your Mac:

A recent [Node.js](https://nodejs.org) version that's supported by [standardJS](https://standardjs.com)

> To install the current stable version of Node, click the "Recommended for Most Users" button to begin the download. When that completes, double-click the **.pkg** installer to begin installation.

`standard` has to be installed **locally** in your workspace (e.g. with `npm i -D standard`). This extension will not use any globally installed `standard` installations. If this is something you want, feel free to open an issue or PR.

> If you would like to check additional syntaxes like `markdown` or `html`, you'll need to install the appropriate ESLint plugin. The extension will let you know which one. Additionally, you **must** add the plugin to `standard.plugins` in `package.json` (see https://standardjs.com for more information).

### Configuration

<!--
🎈 If your extension offers global- or workspace-scoped preferences, consider pointing users toward those settings. For example:
-->

To configure global preferences, open **Extensions → Extension Library...** then select JavaScript Standard Style's **Preferences** tab.

You can also configure preferences on a per-project basis in **Project → Project Settings...**

**Available options:**

- Enable auto-fix on save (off by default)

<!--
👋 That's it! Happy developing!

P.S. If you'd like, you can remove these comments before submitting your extension 😉
-->

## Credits

Lots of inspiration was drawn from these sources:

- [Nova Prettier Extension](https://github.com/alexanderweiss/nova-prettier) by [Alexander Weiss](https://github.com/alexanderweiss)
- [Nova ESLint Extension](https://github.com/apexskier/nova-eslint) by [Cameron Little](https://github.com/apexskier)
