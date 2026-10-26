/** Splits a delimited list, trimming each entry and dropping empty ones. */
export function separateByDelimiter(value: string, delimiter: string) {
	const entries: string[] = [];
	for (const entry of value.split(delimiter)) {
		const trimmed = entry.trim();
		if (trimmed !== "") {
			entries.push(trimmed);
		}
	}
	return entries;
}
