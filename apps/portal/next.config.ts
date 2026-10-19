import type { NextConfig } from "next";

// standalone: the build copies only the files the server needs, so the image runs `node server.js`
const nextConfig: NextConfig = {
	output: "standalone",
	poweredByHeader: false
};

export default nextConfig;
