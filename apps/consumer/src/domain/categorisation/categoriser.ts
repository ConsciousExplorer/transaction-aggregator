export interface RuleRow {
	priority: number;
	matcherType: "mcc" | "keyword" | "source_txn_type" | "source_default";
	pattern: string;
	categoryId: number;
}
export interface Verdict {
	categoryId: number;
	ruleVersion: number;
}

// How the categoriser works. Basically like a database cross join and selecting the first priority
