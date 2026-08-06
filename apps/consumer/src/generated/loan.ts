// Generated from repository schemas. Run npm run scripts:generate-avro
export interface LoanTransaction {
	transactionId: string;
	sourceType: string;
	customerId: string;
	loanAccountId: string;
	loanType: string;
	operation: string;
	amount: number;
	principalAmount: number;
	interestAmount: number;
	currency: string;
	transactionType: string;
	description: string;
	status: string;
	timestamp: number;
}
