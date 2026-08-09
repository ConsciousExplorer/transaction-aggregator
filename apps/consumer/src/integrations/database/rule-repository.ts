import type { Pool } from "pg";

// biome-ignore lint/suspicious/noExplicitAny: # TODO: Implement return
export async function loadActiveRules(pool: Pool): Promise<any> {
	const { rows } = await pool.query(
		`SELECT 
            categorization_rule_id, 
            version, 
            priority, 
            matcher_type, 
            pattern, 
            category_id
		FROM categorization_rules
		WHERE active
		ORDER BY priority`
	);
	return rows.map((r) => ({
		id: r.categorization_rule_id,
		version: r.version,
		priority: r.priority,
		matcherType: r.matcher_type,
		pattern: r.pattern,
		categoryId: r.category_id
	}));
}
