// Generated from repository schemas. Run npm run scripts:generate-avro
export interface DebitOrderTransaction {
	transactionId: string;
	sourceType: string;
	customerId: string;
	mandateId: string;
	category: string;
	creditorName: string;
	creditorAbbrevName: string;
	collectionType: string;
	frequency: string;
	amount: number;
	currency: string;
	transactionType: string;
	description: string;
	status: string;
	timestamp: number;
}
