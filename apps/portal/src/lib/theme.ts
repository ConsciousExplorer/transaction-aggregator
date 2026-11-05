// The portal follows the system's light or dark mode until the customer chooses one in the top
// bar. The choice lives in a cookie, so the server can render the first paint in that mode.
export const THEME_COOKIE = "portal_theme";

const SECONDS_IN_A_YEAR = 60 * 60 * 24 * 365;

// The cookie is the browser's to change, so anything but the two names counts as no choice
export function readThemeChoice(cookieValue: string | undefined) {
	if (cookieValue === "light" || cookieValue === "dark") return cookieValue;
	return undefined;
}

// What the toggle switches to: the opposite of the choice, or of the system's mode before one
// is made
export function chooseOppositeTheme(
	currentTheme: string | undefined,
	isSystemDark: boolean
) {
	const isDark =
		currentTheme === undefined ? isSystemDark : currentTheme === "dark";
	return isDark ? "light" : "dark";
}

// The browser's toggle writes it, so it cannot be HttpOnly. It holds a preference and no
// secret, and the session cookie stays what guards the portal.
export function buildThemeCookie(theme: "light" | "dark") {
	return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${SECONDS_IN_A_YEAR}; SameSite=Lax`;
}
