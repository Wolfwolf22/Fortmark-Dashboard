/** Keep a view's fragment out of record IDs and query values. */
export function previewRouteParts(view = "/") {
  const url = new URL(view, "http://preview.local");
  return { pathname: url.pathname, search: url.search, hash: url.hash, route: url.pathname + url.search };
}
