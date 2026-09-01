/**
 * Serialize untrusted data as one JavaScript string literal for an inline
 * script. JSON.stringify handles quotes and backslashes; the extra escapes keep
 * HTML parsers from seeing a closing script tag and cover JavaScript's two
 * legacy line-separator characters.
 */
export function inlineScriptString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
