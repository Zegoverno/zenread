---
name: reading-notes
description: When the user wants to read, browse or find their Markdown notes in the zenread plugin, list and open them with zenread_list, zenread_open and zenread_read; never guess paths.
---

# Reading notes

The reader shows Markdown notes from one folder (the files folder). All paths are relative to it.

1. To see what exists, call `zenread_list` (no argument for the root, or a folder). Folders end in `/`.
2. To show a note to the user, call `zenread_open` with its path. It opens in the reader with the reading aids; say
   which note you opened, not its whole text.
3. To work with a note's content yourself (summarize, answer from it), call `zenread_read`. It gives the text, the
   front matter, the note's web link (`source`) and the notes before and after it in the folder (`prev`, `next`).
4. Links: `resolved` maps each `[[wiki link]]` and relative `.md` link to a path, or null when the note is missing.
   Follow a link by calling `zenread_open` or `zenread_read` on that path.
5. Only `.md` notes are read; hidden files and folders and anything outside the files folder are refused. If a call
   says no files folder is set, tell the user the reader needs one, or suggest the standalone app for local files.
6. Never invent a path: list the folder first when unsure.
