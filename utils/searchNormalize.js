/**
 * searchNormalize.js
 *
 * Shared text-normalization utility for product search.
 *
 * The SAME function is used on both sides of a keyword search so they always
 * match byte-for-byte:
 *   - when a product is saved (populating `searchName` / `searchDescription`)
 *   - when a user's keyword is normalized before building the `$regex`
 *
 * This makes searches tolerant of accented Latin (Résumé → resume) and of
 * Arabic letter variants (أ/إ/آ → ا, ة → ه, ى → ي).
 */

/**
 * Normalize a search string for consistent matching:
 *   lowercase → NFD decompose → strip combining marks (Latin + Arabic)
 *   → Arabic letter equivalences → collapse whitespace.
 *
 * @param {string} str - Raw text (a product name/description or a keyword).
 * @returns {string} - Normalized, trimmed text.
 */
const normalizeSearchText = (str) => {
  if (typeof str !== "string" || !str) return "";

  return str
    .toLowerCase()
    .normalize("NFD")
    // Strip combining diacritical marks: Latin (U+0300–036F) and Arabic
    // harakat (U+064B–065F) plus the superscript alef (U+0670).
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, "")
    // Arabic letter equivalences (defensive — also covers characters that
    // do not canonical-decompose on every JS engine).
    .replace(/[\u0622\u0623\u0625]/g, "\u0627") // أ إ آ → ا
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/\u0649/g, "\u064a") // ى → ي
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
};

module.exports = { normalizeSearchText };
