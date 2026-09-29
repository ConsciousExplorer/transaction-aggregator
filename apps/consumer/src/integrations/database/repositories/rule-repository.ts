import { eq, max, sql } from "drizzle-orm";
import type { Rule } from "#src/services/rule-categoriser.ts";
import type { Database } from "../pool.ts";
import {
	categories,
	categorizationRules,
	ruleSets
} from "../schemas/schema.ts";

/**
 * The active ruleset version, as a correlated subquery so the version and its
 * rules come from one snapshot. Prepared: this runs once per boot, but naming
 * the statement keeps the plan cached if a reload is ever added.
 */
const activeVersion = sql`(select max(${ruleSets.version}) from ${ruleSets})`;

export async function loadActiveRules(db: Database): Promise<Rule[]> {
	const rows = await db
		.select({
			priority: categorizationRules.priority,
			matcherType: categorizationRules.matcherType,
			pattern: categorizationRules.pattern,
			categoryId: categorizationRules.categoryId,
			version: categorizationRules.rulesetVersion
		})
		.from(categorizationRules)
		.where(eq(categorizationRules.rulesetVersion, activeVersion))
		.orderBy(categorizationRules.priority);

	return rows as Rule[];
}

/**
 * Read from `rule_sets` rather than inferred from a rule row, so it is still
 * correct when the active set has no rules.
 */
export async function loadRulesetVersion(db: Database): Promise<number> {
	const rows = await db
		.select({ version: max(ruleSets.version) })
		.from(ruleSets);

	const version = rows[0]?.version;
	if (version == null) {
		throw new Error("No ruleset version found in rule_sets table");
	}

	return version;
}

export async function loadUncategorisedId(db: Database): Promise<number> {
	const rows = await db
		.select({ categoryId: categories.categoryId })
		.from(categories)
		.where(eq(categories.category, "uncategorised"))
		.limit(1);

	const category = rows[0];
	if (!category) {
		throw new Error('Category "uncategorised" not found in categories table');
	}

	return category.categoryId;
}
