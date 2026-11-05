// "Money-market Account" as "Money-market " and "Account". The table draws a chevron after a
// description, and a browser may break a line just before it, leaving the chevron alone on a
// line of its own; the table keeps the last word and the chevron together instead, so the
// words before it are set apart. A description of one word is all last word. It splits on
// ordinary spaces only. A hyphen is no split, so a hyphenated last word such as "Dis-Chem"
// stays whole; nor is any other space, such as a no-break space or a tab, so a description
// with no ordinary space is all last word and never wraps. The seeded descriptions separate
// their words with ordinary spaces only.
export function splitLastWord(text: string) {
	const trimmed = text.trimEnd();
	const lastSpaceIndex = trimmed.lastIndexOf(" ");
	return {
		leading: trimmed.slice(0, lastSpaceIndex + 1),
		lastWord: trimmed.slice(lastSpaceIndex + 1)
	};
}
