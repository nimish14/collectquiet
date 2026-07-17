/**
 * Sanitize inbound HTML — strip scripts, event handlers, and dangerous URLs.
 * Treat all inbound content as untrusted.
 */

const SCRIPT_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const STYLE_RE = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi;
const TAG_RE = /<\/?[^>]+>/g;
const EVENT_ATTR_RE = /\son\w+\s*=\s*(['"]).*?\1/gi;
const JS_URL_RE = /(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi;

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  let out = html;
  out = out.replace(SCRIPT_RE, '');
  out = out.replace(STYLE_RE, '');
  out = out.replace(EVENT_ATTR_RE, '');
  out = out.replace(JS_URL_RE, '$1=$2#$2');
  // Drop remaining tags for stored text-safe HTML snapshot
  out = out.replace(TAG_RE, ' ');
  return decodeBasicEntities(out).replace(/\s+/g, ' ').trim();
}

export function htmlToPlainText(html: string | null | undefined): string {
  return sanitizeHtml(html);
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** Prefer text body; fall back to sanitized HTML. */
export function extractPlainBody(
  text: string | null | undefined,
  html: string | null | undefined
): string {
  const t = (text ?? '').trim();
  if (t) return t.slice(0, 50_000);
  return htmlToPlainText(html).slice(0, 50_000);
}
