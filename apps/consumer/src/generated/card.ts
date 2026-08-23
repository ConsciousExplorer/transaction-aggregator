// Generated from repository schemas. Run npm run scripts:generate-avro
export interface CardTransaction {
	transactionId: string;
	sourceType: string;
	customerId: string;
	accountId: string;
	category: string;
	merchantName: string;
	mccCode: string;
	amount: number;
	currency: string;
	transactionType: string;
	cardLast4: string;
	cardNetwork: string;
	posEntryMode: string;
	authCode: string;
	description: string;
	status: string;
	timestamp: number;
}
