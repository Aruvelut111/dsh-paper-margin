# Paper Margin

Read files in the DeepSeek Harness sidebar, comment on selected text, and send the notes with your next message.

[中文](README.md) · [Downloads](https://github.com/Aruvelut111/dsh-paper-margin/releases) · [Reader bridge](docs/reader-bridge.md)

## Quick start

Select a passage and click **Add to conversation**. Write a comment beside the source, then use the annotation list above the main composer to edit, remove, or return to a passage. Send your question to include the selected text, comments, file address, and available page or cell information.

Blue markers show pending notes. Numbers start at 1 for each conversation and batch, and close gaps after deletion. A successful send removes the source markers; the message keeps its annotation snapshot. Pending notes survive file switches and reloads in the same browser. Closing the sidebar hides its overlays.

Selections inside a sidenote side chat are added to that child chat and sent from its composer. Main and side conversations keep separate notes, numbering, and submissions.

## Install

Supports DSH 0.2.2; tested with 0.2.2-rc.1.

On Windows, quit DSH and run in PowerShell:

```powershell
irm https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.5.7/install.ps1 | iex
```

The [installer](scripts/install.ps1) locates DSH, downloads and verifies both packages, and calls the official plugin command. Restart DSH afterward.

With `dsh` on PATH, install directly from the release URLs:

```sh
dsh plugin --profile desktop add https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.5.7/dsh-paper-margin-2.5.7.tgz https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.5.7/dsh-sidenote-0.8.5-reader.5.tgz --ignore-scripts --save-exact
```

For Web, replace `desktop` with `web`. To install manually, download both tarballs from [v2.5.7](https://github.com/Aruvelut111/dsh-paper-margin/releases/tag/v2.5.7) and add them through DSH Plugins:

- `dsh-paper-margin-2.5.7.tgz`
- `dsh-sidenote-0.8.5-reader.5.tgz`

The paired sidenote package replaces an existing package of the same name. It adds the reader bridge to [g-yixuan/dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote); source and history are preserved in the [reader fork](https://github.com/Aruvelut111/dsh-sidenote/tree/fix/external-reader-annotations).

```sh
dsh plugin --profile desktop add ./dsh-paper-margin-2.5.7.tgz ./dsh-sidenote-0.8.5-reader.5.tgz --ignore-scripts --save-exact
```

## Formats

PDF uses a range-based reader with page references. Markdown, code, text, and Diff use the host preview. Excel captures the selected sheet, cell range, and values; Word uses the host Office conversion. Static HTML has an optional annotation viewer. Images support whole-image text comments and a file reference.

The desktop native sidebar browser supports selecting page text, writing comments inline, and reopening sources. Notes are stored by conversation and full URL. This uses DSH's browser; it does not control external Chrome, Quark, or other browser plugins. Cross-origin subframes, Canvas, and closed Shadow DOM are outside this integration. Changed source text can prevent reanchoring while the note remains saved. Login behavior follows DSH's native policy, without reading external browser profiles.

Scanned PDFs need a text layer or external OCR. The static HTML viewer disables document scripts and external resources. PPT integration has not had dedicated host testing. Image comments do not attach image pixels automatically.

## Development

Use Node.js 24.9 or later:

```sh
npm ci
npm run check
npm pack
```

The check covers architecture, types, build, and unit tests, including a self-contained sidenote protocol fixture. Host checks cover sidebar cleanup, numbering and payload isolation between two conversations, deletion, and reload recovery.

Notes use localStorage in the current browser origin. Clearing site data removes them.

## License

[MIT](LICENSE). Paper Margin uses the annotation lifecycle from [dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote), an adapted quote search from [dsh-cite-lens](https://github.com/adithyanraj03/dsh-cite-lens), PDF.js, DOMPurify, Schemastery, and Cosmokit. See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) for attribution and included licenses.
