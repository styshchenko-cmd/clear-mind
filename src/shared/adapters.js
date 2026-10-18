// Modify-view adapters: CSS that hides the distracting parts of supported sites.
// Loaded as a classic script by the content script and by extension pages.
(function () {
  // Normalised lowercase pathname without trailing slashes ('/' for the root).
  function cleanPath(url) {
    try {
      const p = String((url && url.pathname) || '/').toLowerCase().replace(/\/+$/, '');
      return p || '/';
    } catch (e) {
      return '/';
    }
  }

  function origin(url) {
    try {
      return url.origin;
    } catch (e) {
      return '';
    }
  }

  const PLACEHOLDER =
    'content: "feed hidden by clearmind"; display: block; padding: 48px 16px; text-align: center; ' +
    'font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #8d968e; ' +
    'letter-spacing: 0.04em;';

  const adapters = [
    // Reddit: new "shreddit" web-component UI, plus old.reddit.com.
    {
      id: 'reddit',
      label: 'reddit.com',
      domains: ['reddit.com'],
      route(url) {
        const p = cleanPath(url);
        if (p === '/' || /^\/(best|hot|new|top|rising|controversial)$/.test(p)) return 'home';
        if (/^\/r\/(popular|all)(\/|$)/.test(p)) return 'popular';
        if (/^\/(r\/[^/]+\/)?comments\//.test(p)) return 'post';
        if (/^\/(r\/[^/]+\/)?search(\/|$)/.test(p)) return 'search';
        if (/^\/r\/[^/]+/.test(p)) return 'subreddit';
        if (/^\/(user|u)\//.test(p)) return 'user';
        if (/^\/(notifications|message)(\/|$)/.test(p)) return 'inbox';
        return 'other';
      },
      redirect() {
        return null;
      },
      options: [
        {
          key: 'feed',
          label: 'Hide the main feed (home wall)',
          summary: 'feed hidden',
          default: true,
          redirect: false,
          css: `
html:is([data-cm-route="home"], [data-cm-route="popular"]) shreddit-feed,
html:is([data-cm-route="home"], [data-cm-route="popular"]) shreddit-gallery-carousel,
html:is([data-cm-route="home"], [data-cm-route="popular"]) shreddit-sort-dropdown,
html:is([data-cm-route="home"], [data-cm-route="popular"]) #siteTable,
html:is([data-cm-route="home"], [data-cm-route="popular"]) .content .nav-buttons { display: none !important; }
html:is([data-cm-route="home"], [data-cm-route="popular"]) main#main-content::before { ${PLACEHOLDER} }`,
        },
        {
          key: 'notifications',
          label: 'Hide notifications & badges',
          summary: 'notifications hidden',
          default: true,
          redirect: false,
          css: `
#notifications-inbox-button,
a[href^="/notifications"][aria-label],
#header-action-item-chat-button faceplate-number,
#header-action-item-chat-button .badge,
#mail.havemail, #mailCount, .message-count, #modmail.havemail { display: none !important; }`,
        },
        {
          key: 'popular',
          label: 'Hide "popular" / recommendations',
          summary: 'popular hidden',
          default: true,
          redirect: false,
          css: `
reddit-sidebar-nav a[href^="/r/popular"],
reddit-sidebar-nav a[href^="/r/all"],
reddit-sidebar-nav a[href^="/explore"],
reddit-sidebar-nav faceplate-tracker[noun="games_drawer"],
reddit-sidebar-nav faceplate-tracker[noun="games_drawer"] + hr,
recent-posts,
community-highlight-carousel,
shreddit-gallery-carousel,
#reddit-trending-searches-partial-container,
[bundlename*="related_communit"],
[bundlename*="recommend"],
faceplate-partial[src*="related-communit"],
#sr-header-area,
.sr-list a[href*="/r/popular"], .sr-list a[href*="/r/all"],
.trending-subreddits,
div.spacer:has(div.sidecontentbox) { display: none !important; }`,
        },
        {
          key: 'comments',
          label: 'Hide comments',
          summary: 'comments hidden',
          default: false,
          redirect: false,
          css: `
html[data-cm-route="post"] shreddit-comment-tree,
html[data-cm-route="post"] #comment-tree,
html[data-cm-route="post"] comment-body-header,
html[data-cm-route="post"] shreddit-comments-sort-dropdown,
html[data-cm-route="post"] faceplate-partial[src*="more-comments"],
html[data-cm-route="post"] .commentarea { display: none !important; }`,
        },
      ],
    },

    // YouTube: desktop Polymer UI (ytd-*) and m.youtube.com (ytm-*).
    {
      id: 'youtube',
      label: 'youtube.com',
      domains: ['youtube.com'],
      route(url) {
        const p = cleanPath(url);
        if (p === '/') return 'home';
        if (p === '/watch') return 'watch';
        if (/^\/shorts(\/|$)/.test(p)) return 'shorts';
        if (p === '/results') return 'search';
        if (p === '/feed/subscriptions') return 'subscriptions';
        if (p === '/playlist') return 'playlist';
        if (/^\/(@|channel\/|c\/|user\/)/.test(p)) return 'channel';
        return 'other';
      },
      redirect(url) {
        try {
          const m = /^\/shorts\/([A-Za-z0-9_-]{6,})/.exec(url.pathname);
          if (!m) return null;
          return origin(url) + '/watch?v=' + m[1];
        } catch (e) {
          return null;
        }
      },
      options: [
        {
          key: 'feed',
          label: 'Hide the home feed',
          summary: 'feed hidden',
          default: true,
          redirect: false,
          css: `
html[data-cm-route="home"] ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
html[data-cm-route="home"] ytm-browse ytm-rich-grid-renderer,
html[data-cm-route="home"] ytm-browse ytm-chip-cloud-renderer { display: none !important; }
html[data-cm-route="home"] ytd-browse[page-subtype="home"]::before { ${PLACEHOLDER} }`,
        },
        {
          key: 'shorts',
          label: 'Hide Shorts',
          summary: 'shorts hidden',
          default: true,
          redirect: true,
          css: `
ytd-reel-shelf-renderer,
ytd-rich-shelf-renderer[is-shorts],
ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
grid-shelf-view-model:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2),
ytd-rich-item-renderer:has(a[href^="/shorts/"]),
ytd-video-renderer:has(a[href^="/shorts/"]),
ytd-grid-video-renderer:has(a[href^="/shorts/"]),
ytd-compact-video-renderer:has(a[href^="/shorts/"]),
yt-lockup-view-model:has(a[href^="/shorts/"]),
ytd-guide-entry-renderer:has(a[title="Shorts"]),
ytd-guide-entry-renderer:has(a[href="/shorts"], a[href^="/shorts/"]),
ytd-mini-guide-entry-renderer[aria-label="Shorts"],
ytd-mini-guide-entry-renderer:has(a[title="Shorts"], a[href^="/shorts"]),
yt-chip-cloud-chip-renderer:has([title="Shorts"]),
yt-tab-shape[tab-title="Shorts"],
ytm-reel-shelf-renderer,
ytm-shorts-lockup-view-model,
ytm-shorts-lockup-view-model-v2,
ytm-video-with-context-renderer:has(a[href^="/shorts/"]),
ytm-pivot-bar-item-renderer:has(.pivot-shorts) { display: none !important; }`,
        },
        {
          key: 'recommendations',
          label: 'Hide recommendations',
          summary: 'recommendations hidden',
          default: true,
          redirect: false,
          css: `
html[data-cm-route="watch"] #related,
html[data-cm-route="watch"] ytd-watch-next-secondary-results-renderer,
html[data-cm-route="watch"] ytm-item-section-renderer[section-identifier="related-items"],
.ytp-endscreen-content,
.ytp-fullscreen-grid,
.ytp-fullscreen-grid-peek,
.ytp-ce-element,
.ytp-autonav-endscreen-countdown-overlay,
.ytp-autonav-endscreen-upnext-container,
.ytp-autonav-toggle-button-container,
.ytp-button[data-tooltip-target-id="ytp-autonav-toggle-button"],
.ytp-suggested-action,
.ytp-pause-overlay,
.videowall-endscreen { display: none !important; }`,
        },
        {
          key: 'comments',
          label: 'Hide comments',
          summary: 'comments hidden',
          default: false,
          redirect: false,
          css: `
ytd-comments#comments,
ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"],
ytm-comment-section-renderer,
ytm-comments-entry-point-header-renderer,
#comments-button { display: none !important; }`,
        },
        {
          key: 'notifications',
          label: 'Hide notifications & badges',
          summary: 'notifications hidden',
          default: true,
          redirect: false,
          css: `
ytd-notification-topbar-button-renderer,
ytd-masthead #buttons yt-icon-badge-shape .yt-spec-icon-badge-shape__badge,
ytd-guide-entry-renderer #newness-dot,
ytd-mini-guide-entry-renderer #newness-dot,
ytm-notification-topbar-button-renderer { display: none !important; }`,
        },
      ],
    },

    // X / Twitter: React web app; data-testid hooks.
    {
      id: 'x',
      label: 'x.com',
      domains: ['x.com', 'twitter.com'],
      route(url) {
        const p = cleanPath(url);
        if (p === '/' || p === '/home') return 'home';
        if (/^\/explore(\/|$)/.test(p)) return 'explore';
        if (/^\/notifications(\/|$)/.test(p)) return 'notifications';
        if (/^\/search(\/|$)/.test(p)) return 'search';
        if (/^\/(messages|i\/chat)(\/|$)/.test(p)) return 'messages';
        if (/^\/i\//.test(p)) return 'other';
        if (/^\/[^/]+\/status\//.test(p)) return 'status';
        if (/^\/[^/]+\/(followers|following|verified_followers|followers_you_follow)$/.test(p)) return 'follows';
        if (/^\/(settings|compose|login|logout|signup|tos|privacy)(\/|$)/.test(p)) return 'other';
        if (/^\/[a-z0-9_]{1,15}(\/(with_replies|media|likes|highlights|articles|superfollows))?$/.test(p)) return 'profile';
        return 'other';
      },
      redirect() {
        return null;
      },
      options: [
        {
          key: 'feed',
          label: 'Hide the home timeline (For you / Following)',
          summary: 'timeline hidden',
          default: true,
          redirect: false,
          css: `
html[data-cm-route="home"] [data-testid="primaryColumn"] section[role="region"],
html[data-cm-route="home"] [aria-label="Home timeline"] section[role="region"] { display: none !important; }`,
        },
        {
          key: 'trends',
          label: 'Hide trends & "what\'s happening"',
          summary: 'trends hidden',
          default: true,
          redirect: false,
          css: `
[data-testid="sidebarColumn"] section:has([data-testid="trend"]),
[data-testid="sidebarColumn"] div:has(> div[data-testid="news_sidebar"]),
[data-testid="sidebarColumn"] div:has(> div[data-testid^="news_sidebar_article_"]),
section:has(> div[aria-label="Timeline: Trending now"]),
html[data-cm-route="explore"] [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]:has([data-testid="trend"], article[data-testid="tweet"]) { display: none !important; }`,
        },
        {
          key: 'follow',
          label: 'Hide "who to follow" & suggestions',
          summary: 'suggestions hidden',
          default: true,
          redirect: false,
          css: `
[data-testid="sidebarColumn"] aside:has([data-testid="UserCell"]),
[data-testid="sidebarColumn"] div:has(> aside [data-testid="UserCell"]),
html:is([data-cm-route="home"], [data-cm-route="status"], [data-cm-route="profile"], [data-cm-route="explore"]) [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]:has([data-testid="UserCell"]),
html:is([data-cm-route="home"], [data-cm-route="status"], [data-cm-route="profile"], [data-cm-route="explore"]) [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]:has(+ [data-testid="cellInnerDiv"] [data-testid="UserCell"]),
html:is([data-cm-route="home"], [data-cm-route="status"], [data-cm-route="profile"], [data-cm-route="explore"]) [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]:has(a[href^="/i/connect_people"]) { display: none !important; }`,
        },
        {
          key: 'notifications',
          label: 'Hide notification badges',
          summary: 'badges hidden',
          default: true,
          redirect: false,
          css: `
header[role="banner"] nav[role="navigation"] a [aria-live="polite"],
nav[role="navigation"] a[data-testid^="AppTabBar_"] [aria-live="polite"],
[data-testid="BottomBar"] a [aria-live="polite"] { display: none !important; }`,
        },
        {
          key: 'explore',
          label: 'Hide explore nav',
          summary: 'explore hidden',
          default: false,
          redirect: false,
          css: `
a[data-testid="AppTabBar_Explore_Link"],
nav[role="navigation"] a[href="/explore"],
[data-testid="BottomBar"] a[href="/explore"] { display: none !important; }`,
        },
      ],
    },

    // Instagram: React web app; mostly hashed classes, so lean on hrefs/structure.
    {
      id: 'instagram',
      label: 'instagram.com',
      domains: ['instagram.com'],
      route(url) {
        const p = cleanPath(url);
        if (p === '/') return 'home';
        if (p === '/explore') return 'explore';
        if (/^\/explore\//.test(p)) return 'search';
        if (/^\/(reels|reel)(\/|$)/.test(p)) return 'reels';
        if (/^\/stories(\/|$)/.test(p)) return 'stories';
        if (/^\/(p|tv)\//.test(p)) return 'post';
        if (/^\/direct(\/|$)/.test(p)) return 'direct';
        if (/^\/(accounts|challenge|emails|legal|about|developer|web)(\/|$)/.test(p)) return 'other';
        if (/^\/[a-z0-9._]{1,30}(\/(tagged|reels|saved))?$/.test(p)) return 'profile';
        return 'other';
      },
      redirect(url) {
        try {
          const p = cleanPath(url);
          const o = origin(url);
          if (!o) return null;
          const m = /^\/(?:reels|reel)\/([a-z0-9_-]+)$/i.exec(url.pathname.replace(/\/+$/, ''));
          if (m) return o + '/p/' + m[1] + '/';
          if (p === '/reels' || p === '/explore') return o + '/';
          return null;
        } catch (e) {
          return null;
        }
      },
      options: [
        {
          key: 'feed',
          label: 'Hide the main feed',
          summary: 'feed hidden',
          default: true,
          redirect: false,
          css: `
html[data-cm-route="home"] main article,
html[data-cm-route="home"] main div:has(> article),
html[data-cm-route="home"] main div:has(> div > a[href="/explore/people/"]) { display: none !important; }
html[data-cm-route="home"] main::after { ${PLACEHOLDER} }`,
        },
        {
          key: 'stories',
          label: 'Hide stories',
          summary: 'stories hidden',
          default: true,
          redirect: false,
          css: `
html[data-cm-route="home"] main [role="menu"]:has(canvas),
html[data-cm-route="home"] main ul:has(> li canvas),
html[data-cm-route="home"] main div:has(> ul > li canvas) { display: none !important; }`,
        },
        {
          key: 'reels',
          label: 'Hide reels & explore',
          summary: 'reels hidden',
          default: true,
          redirect: true,
          css: `
a[href="/reels/"],
a[href="/explore/"],
a[href$="/reels/"][role="tab"],
html[data-cm-route="explore"] main,
html[data-cm-route="reels"] main { display: none !important; }`,
        },
        {
          key: 'notifications',
          label: 'Hide notification badges',
          summary: 'badges hidden',
          default: true,
          redirect: false,
          css: `
a[href^="/direct/inbox"] svg ~ :is(div, span),
a[href="/notifications/"] svg ~ :is(div, span),
a[href="#"]:has(svg[aria-label="Notifications"]) svg ~ :is(div, span) { display: none !important; }`,
        },
      ],
    },

    // Facebook: desktop "comet" UI; hashed classes, so use role/aria/href hooks.
    {
      id: 'facebook',
      label: 'facebook.com',
      domains: ['facebook.com', 'fb.com'],
      route(url) {
        const p = cleanPath(url);
        if (p === '/' || p === '/home.php') return 'home';
        if (p === '/groups/feed') return 'groups-feed';
        if (/^\/watch(\/|$)/.test(p)) return 'watch';
        if (/^\/(reel|reels)(\/|$)/.test(p)) return 'reels';
        if (/^\/stories(\/|$)/.test(p)) return 'stories';
        if (/^\/marketplace(\/|$)/.test(p)) return 'marketplace';
        if (/^\/notifications(\/|$)/.test(p)) return 'notifications';
        if (/^\/messages(\/|$)/.test(p)) return 'messages';
        return 'other';
      },
      redirect() {
        return null;
      },
      options: [
        {
          key: 'feed',
          label: 'Hide the news feed',
          summary: 'feed hidden',
          default: true,
          redirect: false,
          css: `
html:is([data-cm-route="home"], [data-cm-route="groups-feed"]) [role="main"] [role="feed"],
html[data-cm-route="home"] [role="main"] h3 ~ div:has([aria-posinset]),
html[data-cm-route="home"] [role="main"] div[aria-posinset],
html[data-cm-route="home"] [data-pagelet^="FeedUnit"] { display: none !important; }`,
        },
        {
          key: 'stories',
          label: 'Hide stories & reels',
          summary: 'stories hidden',
          default: true,
          redirect: false,
          css: `
html[data-cm-route="home"] [data-pagelet="Stories"],
html[data-cm-route="home"] [role="main"] [aria-label="Stories"],
html[data-cm-route="home"] [role="main"] [aria-label="Reels"],
html[data-cm-route="home"] [role="main"] div:has(> div > div > a[href*="/stories/create"]),
html[data-cm-route="home"] [role="main"] div:has(> div > div > div > a[href*="/stories/"]),
[role="navigation"] a[href*="/reel/"],
[role="navigation"] a[href$="/reels/"] { display: none !important; }`,
        },
        {
          key: 'sidebar',
          label: 'Hide sponsored / suggestions sidebars',
          summary: 'sidebars hidden',
          default: true,
          redirect: false,
          css: `
html[data-cm-route="home"] [role="complementary"],
html[data-cm-route="home"] [data-pagelet="RightRail"],
[role="complementary"] div:has(> span > div > a[href^="https://l.facebook.com/"]),
[role="complementary"] a[aria-label][href*="/ads/"] { display: none !important; }`,
        },
        {
          key: 'notifications',
          label: 'Hide notification badges',
          summary: 'badges hidden',
          default: true,
          redirect: false,
          css: `
[role="banner"] [role="navigation"] a [data-visualcompletion="ignore"]:has(span),
[role="banner"] [aria-label^="Notifications"] span:not(:has(svg)),
[role="banner"] [aria-label^="Messenger"] span:not(:has(svg)),
[role="banner"] div[aria-label^="Notifications"] + div,
[role="banner"] div[aria-label^="Messenger"] + div { display: none !important; }`,
        },
        {
          key: 'watch',
          label: 'Hide watch / marketplace nav',
          summary: 'watch hidden',
          default: false,
          redirect: false,
          css: `
:is([role="banner"], [role="navigation"]) a[href*="/watch/"],
:is([role="banner"], [role="navigation"]) a[href*="/marketplace/"],
:is([role="banner"], [role="navigation"]) a[href*="/gaming/"] { display: none !important; }`,
        },
      ],
    },

    // LinkedIn: classic "scaffold" UI and the 2025+ componentkey UI.
    {
      id: 'linkedin',
      label: 'linkedin.com',
      domains: ['linkedin.com'],
      route(url) {
        const p = cleanPath(url);
        if (/^\/feed\/update\//.test(p)) return 'post';
        if (p === '/' || p === '/feed' || p === '/feed/following') return 'feed';
        if (/^\/notifications(\/|$)/.test(p)) return 'notifications';
        if (/^\/messaging(\/|$)/.test(p)) return 'messaging';
        if (/^\/mynetwork(\/|$)/.test(p)) return 'network';
        if (/^\/jobs(\/|$)/.test(p)) return 'jobs';
        if (/^\/(in|company|school)\//.test(p)) return 'profile';
        if (/^\/search\//.test(p)) return 'search';
        return 'other';
      },
      redirect() {
        return null;
      },
      options: [
        {
          key: 'feed',
          label: 'Hide the feed',
          summary: 'feed hidden',
          default: true,
          redirect: false,
          css: `
html[data-cm-route="feed"] main .scaffold-finite-scroll,
html[data-cm-route="feed"] main [data-finite-scroll-hotkey-context="FEED"],
html[data-cm-route="feed"] div[componentkey^="container-update-list_mainFeed"],
html[data-cm-route="feed"] main .feed-sort-toggle-dsa__wrapper,
html[data-cm-route="feed"] main .artdeco-dropdown:has(.feed-sort-toggle-dsa__dropdown) { display: none !important; }`,
        },
        {
          key: 'news',
          label: 'Hide LinkedIn News, puzzles & "add to your feed"',
          summary: 'news hidden',
          default: true,
          redirect: false,
          css: `
#feed-news-module,
.news-module,
.feed-follows-module,
[data-view-name="news-module"],
[data-view-name="games-module"],
[data-view-name="feed-follows-module"],
div:has(> div > div[data-view-name="news-module"]),
div:has(> div > div[data-view-name="games-module"]),
aside:has(> div > a[href*="/games/"]) { display: none !important; }`,
        },
        {
          key: 'notifications',
          label: 'Hide notification badges',
          summary: 'badges hidden',
          default: true,
          redirect: false,
          css: `
.notification-badge,
.notification-badge--show,
.global-nav__primary-item .notification-badge,
nav a[href*="/notifications/"] [data-test-notification-badge] { display: none !important; }`,
        },
      ],
    },
  ];

  globalThis.ClearMindAdapters = adapters;
})();
