import { eq } from "drizzle-orm";
import type { Rule } from "#src/domain/rule-categoriser.ts";
import type { Database } from "../pool.ts";
import {
	categories,
	categorizationRules,
	ruleSets
} from "../schemas/schema.ts";

/**
 * Stored rows reference rule_sets by foreign key, so a version that isn't
 * there would fail every insert as a bad row. Failing the boot stops that.
 */
async function assertRulesetExists(db: Database, version: number) {
	const rows = await db
		.select({ version: ruleSets.version })
		.from(ruleSets)
		.where(eq(ruleSets.version, version))
		.limit(1);

	if (rows.length === 0) {
		throw new Error(`Ruleset version ${version} not found in rule_sets table`);
	}
}

async function loadRules(db: Database, version: number) {
	const rows = await db
		.select({
			priority: categorizationRules.priority,
			matcherType: categorizationRules.matcherType,
			pattern: categorizationRules.pattern,
			categoryId: categorizationRules.categoryId
		})
		.from(categorizationRules)
		.where(eq(categorizationRules.rulesetVersion, version))
		.orderBy(categorizationRules.priority);

	return rows as Rule[];
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

/** The configured ruleset version, loaded once at boot for the categoriser. */
export async function loadRuleset(db: Database, version: number) {
	await assertRulesetExists(db, version);

	return {
		version,
		rules: await loadRules(db, version),
		uncategorisedId: await loadUncategorisedId(db)
	};
}
