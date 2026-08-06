// Generated from repository schemas. Run npm run scripts:generate-avro
export interface InternalTransferTransaction {
	transactionId: string;
	sourceType: string;
	customerId: string;
	fromAccountId: string;
	toAccountId: string;
	fromAccountType: string;
	toAccountType: string;
	amount: number;
	currency: string;
	transactionType: string;
	description: string;
	status: string;
	timestamp: number;
}
