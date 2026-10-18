# Category list sources

| File | Source | License |
| --- | --- | --- |
| `adult.txt` | [HaGeZi DNS Blocklists](https://github.com/hagezi/dns-blocklists) — `wildcard/nsfw-onlydomains.txt` | GPL-3.0 |
| `gambling.txt` | [HaGeZi DNS Blocklists](https://github.com/hagezi/dns-blocklists) — `wildcard/gambling.mini-onlydomains.txt` | GPL-3.0 |
| `social.txt`, `news.txt`, `video.txt`, `shopping.txt` | Hand-curated for ClearMind | MIT (this repository) |

The HaGeZi files are redistributed unmodified apart from normalisation (lowercase,
`www.` stripped, deduplicated, sorted), under the GPL-3.0 included next to them in
`LICENSE-GPL-3.0.txt`. They are separate data files that the extension reads at
runtime; the extension's own code stays MIT (see `LICENSE` at the package root). Refresh them with `npm run lists`; the
extension itself never downloads anything.
