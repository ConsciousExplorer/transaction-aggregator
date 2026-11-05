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

const dateTimeFormatter = new Intl.DateTimeFormat("en-ZA", {
	day: "2-digit",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
	timeZone: "Africa/Johannesburg"
});

export function formatTransactionDateTime(occurredAt: string) {
	return dateTimeFormatter.format(new Date(occurredAt));
}
