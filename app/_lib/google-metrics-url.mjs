export const GOOGLE_METRICS_HOST = "odml.pa.googleapis.com";

export function isGoogleMetricsUrl(url) {
  try {
    return new URL(url).hostname === GOOGLE_METRICS_HOST;
  } catch {
    return false;
  }
}
