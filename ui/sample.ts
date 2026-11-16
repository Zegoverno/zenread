// The notes shown when no folder is open, so a first visit has something to read and to try the aids on.
export const SAMPLE: Record<string, string> = {
  'Welcome.md': `---
title: Welcome
tags: [reading, sample]
source: https://example.com/welcome
---
# Welcome

This is a small reading room. Open a folder of Markdown notes from the start page, or just try the aids on this sample.

## Reading aids

Press **<** and **>** to change the line width, **:** to loosen the spacing, and **b** for bionic reading, which bolds the start of each word so the eye moves faster.

Press **f** to focus: one paragraph, or one line, stays in full ink while the rest dims. **d** changes how strongly. Press **p** to play the note one word at a time, **+** and **-** to change the speed.

## Moving around

- **[** and **]** jump between headings.
- **l** selects the next link, **Enter** follows it, and the left arrow comes back. Try [[Links]] or [the same note, by path](Links.md).
- **n** and **N** open the next and previous note in the folder.
- **i** unfolds the properties above the text, and **Alt+O** opens the note's web link.

> [!note] Offline
> Once loaded, this app works without a network. Nothing you open leaves your device.

## Changelog

- First draft of the welcome note.
- Added the section on moving around.
`,
  'Links.md': `# Links

A link to another note in this folder is written as a wiki link, [[Welcome]], or as a relative Markdown link, [Welcome](Welcome.md). Both open inside the reader. A link such as [the example site](https://example.com) opens in a new tab.

A link to a heading in this note: [back to the top](#links).

## Tables and code

| Aid | Key |
|---|---|
| Width | < > |
| Bionic | b |

Inline \`code\` and blocks stay as they are:

\`\`\`
no words are played here
\`\`\`
`,
};
