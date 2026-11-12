const hasLaunchData = (url: string | undefined) => Boolean(url && url.includes('tgWebAppData='));

/**
 * Whether Telegram handed this page fresh launch data. Telegram puts it in the URL on every real
 * launch; when it instead restores an old Mini App window (minimized or "recent" apps), the URL
 * has none and the SDK falls back to data stored from an earlier launch - possibly days old, or
 * signed by a bot that no longer exists, which the server rightly refuses. Evaluated once, when
 * this module loads, before the router rewrites the hash.
 */
export const launchedFresh =
  hasLaunchData(window.location.href) ||
  hasLaunchData((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.name);

export const SESSION_REJECTED_EVENT = 'tma-session-rejected';
