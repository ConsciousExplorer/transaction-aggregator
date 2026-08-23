// Generated from repository schemas. Run npm run scripts:generate-avro
export interface EftTransaction {
	transactionId: string;
	sourceType: string;
	customerId: string;
	accountId: string;
	beneficiaryName: string;
	beneficiaryAccountNumber: string;
	beneficiaryBank: string;
	branchCode: string;
	reference: string;
	amount: number;
	currency: string;
	transactionType: string;
	clearingType: string;
	description: string;
	status: string;
	timestamp: number;
}
