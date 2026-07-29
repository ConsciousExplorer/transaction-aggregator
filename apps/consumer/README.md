# Getting started

This is a simple comsumer service that runs by using a platformatic consumer and also exposes express http emdpoints for alive and healtz endpoints. 

# Architecture

The service needs to be lightweight and fast. Messages will be consumed in batches. Each message will be unpacked, categorised and sinked in Postgres. Using batches on Postgres inserts improves performance. Unpacking each messages allows us to add OTEL metrics and traces that can be traced through the message lifecycle. 

# Setup and rules
1. There should be no circular dependencies
2. The application should fail fast on startup if config is not aligned
3. There should alwyas be one config object and it should not be mutatabe
3. Dependencies should be passed. Never created in the modules
3. Database connections should be managed by a singlular Pool. We only have a write instance. 
4. Business and application logic should be separated. 
5. There should be metrics and structured logging
6. Graceful shutdown is required, flush consumers and database connections
7. Timeouts should be set 
8. Retries should be easily managed
9. Sinks should be idempotent
10. If there are reties, they should have exponential backoff
11. There should be efficient and well documented error handling
12. Singleton instances should be passed and used
13. Tests should be next to the respective file
14. Data boundries should be validated. 
15. Clear architetural layers should exist between services and logic.
16. App should not create external dependencies and infrastructure. Don't create kafka topics or database tables

# App lifecycle

Load configuration
        │
Validate configuration
        │
Initialize logger
        │
Initialize metrics
        │
Connect database
        │
Connect Kafka
        |
Warm caches (MCC hash table)
        │
Start Consumer
        │
Start HTTP server
        │
Ready

# Layered architecture
app.ts
    │
Initialize
    │
Kafka Consumer
    │
Message Dispatcher
    │
Deserializer
    │
Message Handler
    │
Categorization Service
    │
Repository
    │
PostgreSQL

# App structure
