import type { ReactNode } from "react";
import type { IconName } from "@/lib/category-style.ts";

// One outline set on a 24px grid. Each entry is only the shapes; the svg around them sets the
// stroke, so every icon draws at the same weight in the colour of the text it sits in.
const ICON_SHAPES: Record<IconName, ReactNode> = {
	transfers: <path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3" />,
	car: (
		<>
			<path d="M5 16v2m14-2v2M4 11l1.6-4.2A2 2 0 0 1 7.5 5.5h9a2 2 0 0 1 1.9 1.3L20 11M4 11h16v5H4z" />
			<circle cx="8" cy="13.5" r=".9" />
			<circle cx="16" cy="13.5" r=".9" />
		</>
	),
	cart: (
		<>
			<path d="M3 4h2l2.4 10.5h10.2L20 7H6.3" />
			<circle cx="9" cy="19" r="1.2" />
			<circle cx="16.5" cy="19" r="1.2" />
		</>
	),
	bank: (
		<path d="M4 9.5 12 5l8 4.5M5 10v7m4.7-7v7m4.6-7v7M19 10v7M3.5 19.5h17" />
	),
	bag: <path d="M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2" />,
	health: (
		<>
			<path d="M12 5v14M5 12h14" />
			<rect x="3.5" y="3.5" width="17" height="17" rx="4" />
		</>
	),
	shield: <path d="M12 3.5 5 6v6c0 4.2 3 7.2 7 8.5 4-1.3 7-4.3 7-8.5V6z" />,
	ticket: (
		<path d="M4 8.5a2 2 0 0 0 0 7V19h16v-3.5a2 2 0 0 1 0-7V5H4zM13 7v2m0 3v2m0 3v1" />
	),
	repeat: (
		<path d="M17 4l3 3-3 3M4 11V9a2 2 0 0 1 2-2h14M7 20l-3-3 3-3m13-1v2a2 2 0 0 1-2 2H4" />
	),
	dining: (
		<path d="M7 3.5v6a2 2 0 0 0 4 0v-6M9 11.5v9M16 3.5c-1.5 1.2-2.5 3.3-2.5 6.5H16v10.5" />
	),
	income: (
		<path d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
	),
	book: (
		<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 18.5V5.5M8 7h8" />
	),
	fitness: <path d="M3 12h2m14 0h2M6 8v8m12-8v8M9 9v6m6-6v6M9 12h6" />,
	calendar: (
		<>
			<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
			<path d="M3.5 10h17M8 3v4m8-4v4" />
		</>
	),
	bolt: <path d="M13 3 5 13.5h6L11 21l8-10.5h-6z" />,
	unknown: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" />
		</>
	),
	card: (
		<>
			<rect x="2" y="5" width="20" height="14" rx="2.5" />
			<path d="M2 10h20" />
		</>
	),
	kebab: (
		<>
			<circle cx="12" cy="5.5" r="1.4" />
			<circle cx="12" cy="12" r="1.4" />
			<circle cx="12" cy="18.5" r="1.4" />
		</>
	),
	check: <path d="M5 12.5l4.5 4.5L19 7" />,
	search: (
		<>
			<circle cx="11" cy="11" r="6.5" />
			<path d="m20 20-4.3-4.3" />
		</>
	),
	swap: <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />,
	reset: <path d="M4 10a8 8 0 1 1 2.3 5.7M4 4v6h6" />,
	detail: <path d="M5 12h14M12 5l7 7-7 7" />,
	sun: (
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
		</>
	),
	moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
};

// Decoration only: whatever the icon sits beside or inside carries the words
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
	return (
		<svg
			className="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{ICON_SHAPES[name]}
		</svg>
	);
}
