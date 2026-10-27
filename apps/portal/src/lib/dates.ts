// Transactions are stored in UTC; a South African customer reads them in their own time
const dateFormatter = new Intl.DateTimeFormat("en-ZA", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "Africa/Johannesburg"
});

export function formatTransactionDate(occurredAt: string) {
	return dateFormatter.format(new Date(occurredAt));
}
