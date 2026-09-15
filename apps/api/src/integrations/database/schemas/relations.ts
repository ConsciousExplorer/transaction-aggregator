import { relations } from "drizzle-orm/relations";
import { categories, categorizationRules, ruleSets, userCategoryOverrides } from "./schema";

export const categorizationRulesRelations = relations(categorizationRules, ({one}) => ({
	category: one(categories, {
		fields: [categorizationRules.categoryId],
		references: [categories.categoryId]
	}),
	ruleSet: one(ruleSets, {
		fields: [categorizationRules.rulesetVersion],
		references: [ruleSets.version]
	}),
}));

export const categoriesRelations = relations(categories, ({many}) => ({
	categorizationRules: many(categorizationRules),
	userCategoryOverrides_fromCategoryId: many(userCategoryOverrides, {
		relationName: "userCategoryOverrides_fromCategoryId_categories_categoryId"
	}),
	userCategoryOverrides_toCategoryId: many(userCategoryOverrides, {
		relationName: "userCategoryOverrides_toCategoryId_categories_categoryId"
	}),
}));

export const ruleSetsRelations = relations(ruleSets, ({many}) => ({
	categorizationRules: many(categorizationRules),
}));

export const userCategoryOverridesRelations = relations(userCategoryOverrides, ({one}) => ({
	category_fromCategoryId: one(categories, {
		fields: [userCategoryOverrides.fromCategoryId],
		references: [categories.categoryId],
		relationName: "userCategoryOverrides_fromCategoryId_categories_categoryId"
	}),
	category_toCategoryId: one(categories, {
		fields: [userCategoryOverrides.toCategoryId],
		references: [categories.categoryId],
		relationName: "userCategoryOverrides_toCategoryId_categories_categoryId"
	}),
}));