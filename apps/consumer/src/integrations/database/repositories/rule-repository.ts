import { eq, max, sql } from "drizzle-orm";
import type { Rule } from "#src/services/rule-categoriser.ts";
import type { Database } from "../pool.ts";
import {
	categories,
	categorizationRules,
	ruleSets
} from "../schemas/schema.ts";

/**
 * The newest ruleset version, as a subquery inside the rules query. It runs
 * once, at boot. `loadRuleset` reads the version the verdicts carry in a
 * statement of its own, so the two agree unless a ruleset is added while the
 * consumer is starting.
 */
const activeVersion = sql`(select max(${ruleSets.version}) from ${ruleSets})`;

async function loadActiveRules(db: Database) {
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
async function loadRulesetVersion(db: Database) {
	const rows = await db
		.select({ version: max(ruleSets.version) })
		.from(ruleSets);

	const version = rows[0]?.version;
	if (version == null) {
		throw new Error("No ruleset version found in rule_sets table");
	}

	return version;
}

async function loadUncategorisedId(db: Database) {
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

/** The active ruleset, loaded once at boot for the categoriser. */
export async function loadRuleset(db: Database) {
	return {
		version: await loadRulesetVersion(db),
		rules: await loadActiveRules(db),
		uncategorisedId: await loadUncategorisedId(db)
	};
}
