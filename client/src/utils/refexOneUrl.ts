/** RefexOne portal — same destination P2P uses on logout / Refresh. */
export const DEFAULT_REFEXONE_URL = 'https://refexone.com'

export function getRefexOneUrl(): string {
  return DEFAULT_REFEXONE_URL
}

/** Full-page navigate to RefexOne portal (logout / back to host). */
export function goToRefexOne(): void {
  window.location.replace(getRefexOneUrl())
}
