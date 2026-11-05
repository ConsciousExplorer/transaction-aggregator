import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle.tsx";

type TopBarProps = { customerName: string };

// The shell's one bar. On the left the product's mark, its name and the word Demo; on the
// right who is signed in, the switch between day and night, and the way out. No nav links:
// the portal is one screen.
export function TopBar({ customerName }: TopBarProps) {
	return (
		<header className="top-bar">
			<div className="top-bar-inner">
				<Link href="/overview" className="brand">
					<ProductMark />
					<span className="brand-name">Transaction portal</span>
					<span className="demo-marker">Demo</span>
				</Link>
				<div className="account">
					<span className="account-name">{customerName}</span>
					<ThemeToggle />
					<form action="/bff/auth/logout" method="post">
						<button type="submit" className="button button-text">
							Sign out
						</button>
					</form>
				</div>
			</div>
		</header>
	);
}

// Two square columns either side of a short baseline: money in above the line, money out
// below it. Drawn on whole pixels so it stays crisp at 16px, in currentColor so it takes
// the name's ink in both modes. Decorative: the name beside it says what it is.
function ProductMark() {
	return (
		<svg
			className="brand-mark"
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="currentColor"
			aria-hidden="true"
			focusable="false"
		>
			<rect x="3" y="2" width="4" height="4" />
			<rect x="2" y="7" width="12" height="2" />
			<rect x="9" y="10" width="4" height="4" />
		</svg>
	);
}
