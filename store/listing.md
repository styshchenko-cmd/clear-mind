# Store listing: ClearMind 1.1

Paste-ready text for the Chrome Web Store dashboard (and Firefox AMO, see the end).
Regenerate the images with `npm run build && node scripts/store-assets.mjs`.

## Package

Upload `dist/clearmind-chrome-1.1.0.zip` (`npm run build`).

## Store listing tab

**Name:** ClearMind

**Summary** (from the manifest, 107 of 132 characters):

> Block, time-limit and tidy distracting sites. Password + cooldown to unlock. All data stays on your device.

**Category:** Productivity › Workflow & Planning
**Language:** English

**Description:**

```
ClearMind gives you back your attention. You set the rules for yourself: block a site, give it a daily time limit, or keep it but hide the parts that keep you scrolling. When you really need a blocked site, a password and a short cooldown stand between you and it. Just enough friction to ask: do I actually need this?

BLOCK OR LIMIT ANY SITE
• Block: the block page shows every time, with a message you wrote to yourself.
• Time limit: e.g. 30 minutes a day on reddit.com. Resets at midnight.
• Watch: just track the time, never block.
• Or redirect to somewhere better, like your reading list.
• Type the site any way you like (reddit.com, www.reddit.com, https://…): one rule covers it.

UNLOCK WITH INTENT
• "Still need it?" → your password → a 30-second cooldown (you choose the length).
• The unlock lasts for that tab only, until you close it or until midnight.
• Loosening any rule later also asks for the password.

AUTO MODE: WHOLE CATEGORIES
• Social feeds, news, video & streaming, shopping, adult content, gambling.
• For each category: off, a focus window (25 min, 2 h, until 18:00, rest of the day), a shared daily limit, or always blocked.
• Built-in lists, stored on your device. Sites you configure yourself override the category.

MODIFY VIEW: KEEP THE SITE, LOSE THE FEED
• reddit, YouTube, X, Instagram, Facebook and LinkedIn.
• Hide the home feed, Shorts and Reels, recommendations, trends, notification badges or comments, or show images in grayscale.

SEE WHERE THE TIME GOES
• Time on your listed sites, blocks shown, unlocks, and your streak of days under the limit.
• Today, 7 or 30 days, per site and per category.

PRIVATE BY DESIGN
• No account, no servers, no analytics, no ads.
• ClearMind makes no network requests. Everything stays in your browser's storage on this device.
• Free and open source (GPL-3.0): https://github.com/styshchenko-cmd/clear-mind
```

**Graphic assets** (all in `store/`):

| Field | File |
| --- | --- |
| Store icon (128×128) | `src/icons/icon-128.png` |
| Screenshot 1 | `screenshot-1-block-page.png` |
| Screenshot 2 | `screenshot-2-popup.png` |
| Screenshot 3 | `screenshot-3-stats.png` |
| Screenshot 4 | `screenshot-4-auto-mode.png` |
| Screenshot 5 | `screenshot-5-modify-view.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `promo-marquee-1400x560.png` |

**Official URL:** none. **Homepage URL:** https://github.com/styshchenko-cmd/clear-mind
**Support URL:** https://github.com/styshchenko-cmd/clear-mind/issues

## Privacy tab

**Single purpose:**

> Helps users limit distracting websites: block, time-limit or tidy the sites they choose, with a password and a cooldown to unlock.

**Permission justifications:**

- **tabs:** Reads the address of the current tab to apply the user's block and time-limit rules and to count time spent on the sites the user listed. When rules change, re-checks tabs that are already open.
- **webNavigation:** Detects a top-level navigation before the page loads, so a blocked site is replaced by the extension's own block page.
- **storage:** Stores the user's rules, a salted hash of their unblock password and daily usage statistics, locally in the browser.
- **alarms:** A 30-second timer for time tracking, and an alarm at the moment a daily limit runs out.
- **idle:** Pauses time counting while the user is away from the computer or the screen is locked.
- **Host permission** (reddit.com, youtube.com, x.com, twitter.com, instagram.com, facebook.com, fb.com, linkedin.com): Injects CSS that hides feeds, Shorts/Reels and recommendations when the user enables "modify view" for that site. Reads no page content and sends nothing anywhere.

**Are you using remote code?** No, I am not using remote code.

**Data usage.** Tick only **Web browsing activity**: the domains of the sites on the user's lists, time spent on them, and block/unlock counts. All of it is processed and stored locally only.

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/styshchenko-cmd/clear-mind/blob/main/PRIVACY.md

## Distribution tab

- Visibility: Public (or Unlisted for a soft launch: installable only by link).
- Regions: all.

## Notes for the reviewer (Test instructions field, if asked)

```
No account or login. On install a setup page opens: set any password (8+ characters).
To try blocking: blocked sites → add "reddit.com" → choose Block → save, then open reddit.com.
On the block page: "[ still need it? ]" → the password → 30-second cooldown → "continue".
The extension makes no network requests; category lists are bundled (lists/, sources in lists/SOURCES.md).
```

## Firefox AMO

- Upload `dist/clearmind-firefox-1.1.0.zip`. No source upload is needed: the code isn't minified or bundled.
- Platform: desktop only (Firefox for Android lacks the `idle` and `windows` APIs).
- License: GPL-3.0 (or later).
- Privacy policy: same text as PRIVACY.md (optional on AMO, since the manifest declares no data collection).
- Reuse the summary, description and screenshots above.
