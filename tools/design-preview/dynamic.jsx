import React, { lazy, Suspense } from "react";
/** Only the local closed preview: production keeps Next's real split bundles. */
export default function dynamic(load, options = {}) {
  const Component = lazy(() => load().then(value => ({ default: value.default ?? value })));
  return function PreviewDynamic(props) { return <Suspense fallback={options.loading ? React.createElement(options.loading) : null}><Component {...props}/></Suspense>; };
}
