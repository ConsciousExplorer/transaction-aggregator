import type { NextConfig } from "next";

// The portal is one screen. Links to the old Transactions and Categories pages land on it.
// Temporary (307) rather than permanent, so no browser caches the move for good.
async function listRedirects() {
	return [
		{ source: "/transactions", destination: "/overview", permanent: false },
		{ source: "/categories", destination: "/overview", permanent: false }
	];
}

// standalone: the build copies only the files the server needs, so the image runs `node server.js`
const nextConfig: NextConfig = {
	output: "standalone",
	poweredByHeader: false,
	redirects: listRedirects
};

export default nextConfig;
