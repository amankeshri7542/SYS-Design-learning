// How a lesson's text marks a glossary term. On its own, so the page that shows terms needn't load the beats runtime.

/** `[[key|plain words]]` and `[[key]]`: glossary terms in a text. */
export const TERM = /\[\[([\w-]+)(?:\|([^\]]+))?\]\]/g;
