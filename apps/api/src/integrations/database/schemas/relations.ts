import { relations } from "drizzle-orm/relations";
import {
	categories,
	categorizationRules,
	ruleSets,
	transactionsDefault,
	userCategoryOverrides,
	userTransactionOverridesDefault
} from "./schema";

export const categorizationRulesRelations = relations(
	categorizationRules,
	({ one, many }) => ({
		category: one(categories, {
			fields: [categorizationRules.categoryId],
			references: [categories.categoryId]
		}),
		ruleSet: one(ruleSets, {
			fields: [categorizationRules.rulesetVersion],
			references: [ruleSets.version]
		}),
		transactionsDefaults: many(transactionsDefault)
	})
);

export const categoriesRelations = relations(categories, ({ many }) => ({
	categorizationRules: many(categorizationRules),
	userCategoryOverrides_fromCategoryId: many(userCategoryOverrides, {
		relationName: "userCategoryOverrides_fromCategoryId_categories_categoryId"
	}),
	userCategoryOverrides_toCategoryId: many(userCategoryOverrides, {
		relationName: "userCategoryOverrides_toCategoryId_categories_categoryId"
	}),
	transactionsDefaults: many(transactionsDefault),
	userTransactionOverridesDefaults: many(userTransactionOverridesDefault)
}));

export const ruleSetsRelations = relations(ruleSets, ({ many }) => ({
	categorizationRules: many(categorizationRules),
	transactionsDefaults: many(transactionsDefault)
}));

export const userCategoryOverridesRelations = relations(
	userCategoryOverrides,
	({ one }) => ({
		category_fromCategoryId: one(categories, {
			fields: [userCategoryOverrides.fromCategoryId],
			references: [categories.categoryId],
			relationName: "userCategoryOverrides_fromCategoryId_categories_categoryId"
		}),
		category_toCategoryId: one(categories, {
			fields: [userCategoryOverrides.toCategoryId],
			references: [categories.categoryId],
			relationName: "userCategoryOverrides_toCategoryId_categories_categoryId"
		})
	})
);

export const transactionsDefaultRelations = relations(
	transactionsDefault,
	({ one }) => ({
		category: one(categories, {
			fields: [transactionsDefault.categoryId],
			references: [categories.categoryId]
		}),
		ruleSet: one(ruleSets, {
			fields: [transactionsDefault.ruleVersion],
			references: [ruleSets.version]
		}),
		categorizationRule: one(categorizationRules, {
			fields: [transactionsDefault.ruleVersion],
			references: [categorizationRules.rulesetVersion]
		})
	})
);

export const userTransactionOverridesDefaultRelations = relations(
	userTransactionOverridesDefault,
	({ one }) => ({
		category: one(categories, {
			fields: [userTransactionOverridesDefault.categoryId],
			references: [categories.categoryId]
		})
	})
);
