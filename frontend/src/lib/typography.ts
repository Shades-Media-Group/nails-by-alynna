/**
 * Line breaks in text that comes from data (service names and descriptions typed in Admin →
 * Services), where no-break spaces can't be written into the copy by hand as they are in the
 * locale files. A no-break space looks like a space but never ends a line, so the words on both
 * sides move to the next line together.
 */
export const NBSP = '\u00a0';

/** A space a line may break at. Line breaks typed into the text are left as they are. */
const SPACE = '[ \\t]';
/** One word: everything up to a space or a line break (a no-break space keeps a group one word). */
const WORD = '[^ \\t\\n\\r\\f]';

/**
 * A short token: a number ("1", "6.", "15%", "−30%", "14:00", "3D") or a word of at most three
 * letters ("gel", "din", "из", "QR"), punctuation around it aside.
 */
const SHORT = /^[("«„'“]*(?:[−+-]?\p{N}[\p{N}.,:/%]*\p{L}{0,2}|\p{L}{1,3})[)»"'”.,:;!?…]*$/u;
const LAST_WORD = new RegExp(`^(.*${WORD})${SPACE}+(${WORD}+)(\\s*)$`, 'su');
/** A number and the short word after it: "100 MDL", "30 min", "4 din". */
const NUMBER_THEN_SHORT = new RegExp(`(^|[\\s(])([−+-]?\\p{N}[\\p{N}.,:%]*)${SPACE}(?=\\p{L}{1,3}(?:[.,:;!?…)]|\\s|$))`, 'gu');
/** A short word and the number after it: "din 6", "la 14:00", "с 3D-дизайном". */
const SHORT_THEN_NUMBER = new RegExp(`(^|[\\s(])(\\p{L}{1,3})${SPACE}(?=[−+-]?\\p{N})`, 'gu');

/**
 * Keeps short words from standing alone at the edge of a line. A short last word stays with the
 * word before it ("Alungire, mărimea / 1" becomes "Alungire, / mărimea 1"; "Acoperire cu lac /
 * gel" becomes "Acoperire cu / lac gel"), and a number stays with a short word next to it ("100
 * MDL", "din 6"). Only those spaces become no-break spaces. Use it where text is shown, never on
 * values that are searched, compared or sent.
 */
export function noOrphan(text: string): string {
  const bound = text.replace(NUMBER_THEN_SHORT, `$1$2${NBSP}`).replace(SHORT_THEN_NUMBER, `$1$2${NBSP}`);
  const last = LAST_WORD.exec(bound);
  if (!last || !SHORT.test(last[2]!)) return bound;
  return `${last[1]}${NBSP}${last[2]}${last[3]}`;
}
