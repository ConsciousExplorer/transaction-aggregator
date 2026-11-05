"use client";

import { Icon } from "@/components/Icons.tsx";
import { buildThemeCookie, chooseOppositeTheme } from "@/lib/theme.ts";

// Changes the page's mode at once and remembers it for the next request
function switchTheme() {
	const root = document.documentElement;
	const isSystemDark = window.matchMedia(
		"(prefers-color-scheme: dark)"
	).matches;
	const theme = chooseOppositeTheme(root.dataset.theme, isSystemDark);
	root.dataset.theme = theme;
	// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API reached Safari and Firefox only in 2025, and this one write needs nothing it adds
	document.cookie = buildThemeCookie(theme);
}

// A moon by day and a sun by night, each with its words for a screen reader. The stylesheet
// shows the right one, so the first paint needs no script and no state to agree with.
export function ThemeToggle() {
	return (
		<button type="button" className="theme-toggle" onClick={switchTheme}>
			<span className="theme-toggle-to-dark">
				<Icon name="moon" size={18} />
				<span className="visually-hidden">Switch to night mode</span>
			</span>
			<span className="theme-toggle-to-light">
				<Icon name="sun" size={18} />
				<span className="visually-hidden">Switch to day mode</span>
			</span>
		</button>
	);
}
