import type { ReactNode } from "react";

// A select's choices as value and label, for the filter row's selects

export interface SelectOption {
	value: string;
	label: string;
}

export function buildOptions(options: SelectOption[]) {
	const elements: ReactNode[] = [];
	for (const option of options) {
		elements.push(
			<option key={option.value} value={option.value}>
				{option.label}
			</option>
		);
	}
	return elements;
}
