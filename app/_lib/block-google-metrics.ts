import { isGoogleMetricsUrl } from "./google-metrics-url.mjs";

let installed = false;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function blockGoogleMetrics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (isGoogleMetricsUrl(requestUrl(input))) {
      return Promise.resolve(new Response(null, { status: 403 }));
    }
    return originalFetch(input, init);
  };
}
