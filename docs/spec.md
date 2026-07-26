# Spec

Backend Project (3)

1. Transaction Aggregation API
   Brief:
   Build a system that aggregates customer financial transaction data from multiple mock data sources and categorizes the transactions. It will need an extensive API for retrieving aggregated information.

# Requirements

1. Users: 2 million,
1. 5 transactions per day
1. API reponse time: < 200 milliseconds
1. Data retention: 18 months
1. Sources - card, loan, transfers, airtime purchases

# Constraints

1. API contract validation
1. Schema Validation on every level
1. Realtime requirements

# Infrastructure

1. Source generation - create mock data
1. Infrastructure:
   1.1 Kafka
   1.2 Postgres
   1.3 Cache if we know user queries
   1.4 Schema registry

# Considerations

1. Security on the API, JWT
1. money values in database, minor denomination
1. No sensitive or user data
1. uuidV7 on database layer, no transaction guessing
1. Load tests on API
1. Consumer inserts in batches
1. No duplicate transactions (code should be idempotent)
1. Database should have a reader and write split (Not on docker level)
1. DI container for dependency injection
1. Logging and metrics
