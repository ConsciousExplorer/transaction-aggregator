// export interface RuleRow {
// 	id: number;
// 	version: number;
// 	priority: number;
// 	matcherType: "mcc" | "keyword" | "source_txn_type" | "source_default";
// 	pattern: string;
// 	categoryId: number;
// }
// export interface Verdict {
// 	categoryId: number;
// 	ruleVersion: number;
// }
// export interface Categorizer {
// 	categorize(txn: CanonicalTransaction): Verdict;
// }
// export class RulesCategorizer implements Categorizer {
// 	constructor(rules: RuleRow[], uncategorizedId: number) {}
// }
