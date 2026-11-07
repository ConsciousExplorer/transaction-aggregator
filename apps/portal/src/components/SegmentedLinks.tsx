import Link from "next/link";
import type { ReactNode } from "react";

export interface SegmentedLink {
	href: string;
	label: string;
	current: boolean;
}

// A row of links that reads as one control: the current one is filled and carries
// aria-current, so the choice is in the URL and the page stays linkable. A choice changes the
// same screen, so the page stays where it is rather than scrolling back to the top: on a phone
// the spending card's tabs sit well down the page.
export function SegmentedLinks({
	label,
	links
}: {
	label: string;
	links: SegmentedLink[];
}) {
	const segments: ReactNode[] = [];
	for (const link of links) {
		segments.push(
			<Link
				key={link.href}
				href={link.href}
				scroll={false}
				className="segment"
				aria-current={link.current ? "page" : undefined}
			>
				{link.label}
			</Link>
		);
	}
	return (
		<nav className="segments" aria-label={label}>
			{segments}
		</nav>
	);
}
