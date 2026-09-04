# Steam BBCode

Steam renders Workshop descriptions, changenotes and translations from
BBCode: tags in square brackets, closed with a slash. The rules below are
Steam's own, from its [formatting help](https://steamcommunity.com/comment/Guide/formattinghelp),
and every one of them renders in the toolkit's BBCode preview and in the
Workshop panel.

Two things Steam does that Markdown does not: every newline is a line break,
and a tag that Steam does not know is printed as text.

## Headings and text

| Tag | Renders as |
|---|---|
| `[h1]text[/h1]` | Heading, largest |
| `[h2]text[/h2]` | Heading |
| `[h3]text[/h3]` | Heading, smallest |
| `[b]text[/b]` | **Bold** |
| `[i]text[/i]` | *Italic* |
| `[u]text[/u]` | Underlined |
| `[strike]text[/strike]` | Struck through |
| `[spoiler]text[/spoiler]` | Hidden until the reader hovers or clicks |
| `[code]text[/code]` | Fixed-width font, spaces and line breaks kept |
| `[noparse][b]text[/b][/noparse]` | The tags inside are printed, not applied |
| `[hr][/hr]` | A horizontal rule |

## Links and media

| Tag | Renders as |
|---|---|
| `[url=https://example.com]text[/url]` | A link with its own text |
| `[img]https://example.com/picture.png[/img]` | An image from that address |
| A YouTube link on its own line | A video player |
| A Steam store link on its own line | A store widget |
| A Workshop link on its own line | A Workshop item widget |

The videos of the item's gallery are not BBCode: the Workshop panel keeps
them in `previews/videos.txt`, one YouTube id or link per entry.

## Lists

```
[list]
[*]First item
[*]Second item
[/list]
```

`[olist]` in place of `[list]` numbers the items. Items are opened with
`[*]` and never closed.

## Quotes

```
[quote=author]The quoted text.[/quote]
```

Leave out `=author` for a quote with no name on it.

## Tables

```
[table]
[tr][th]Column[/th][th]Column[/th][/tr]
[tr][td]Cell[/td][td]Cell[/td][/tr]
[/table]
```

`[table noborder=1]` hides the borders. `[table equalcells=1]` stretches
the table to the full width with columns of equal width.

## Limits

A description holds at most 8000 bytes of BBCode. The Workshop panel's
checks say when a draft is over that.

## In the editor

A `.bbcode` file has a rendered preview (the buttons in its title bar, or
Ctrl+Shift+V), and Edit as Markdown opens the same file with Markdown syntax
and converts it back on save. The Workshop panel shows the same preview and
opens the file for editing.
