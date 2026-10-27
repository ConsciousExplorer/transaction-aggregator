// A bar's width as a percentage of the largest value; zero when there is nothing to compare
export function calculateBarWidth(value: number, maximum: number) {
	if (maximum <= 0) return 0;
	return Math.round((value / maximum) * 100);
}
