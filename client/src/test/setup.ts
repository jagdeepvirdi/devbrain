import '@testing-library/jest-dom'

// jsdom doesn't implement scrollIntoView — several pages (e.g. DocChat's
// auto-scroll-to-latest-message effect) call it unconditionally on mount.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
