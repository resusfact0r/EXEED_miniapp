/** Fired when the server is unreachable or its gateway answers 502/504 (backend restarting). */
export const SERVICE_DOWN_EVENT = 'tma-service-down';

/**
 * Whether any request has succeeded since the app started. If the outage hit right at launch,
 * nothing on screen ever loaded and recovery needs a reload; otherwise the screens keep their
 * state (a half-filled checkout, for one) and the overlay just goes away.
 */
export const serviceState = { everReached: false };
