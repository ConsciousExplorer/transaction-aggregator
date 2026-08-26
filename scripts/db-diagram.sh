sql2dbml './db/migrations/V001__types_and_tables.sql' --postgres -o db-model.dbml && cat >> db-model.dbml << 'EOF'
// Documentation-only relationship — the database deliberately has NO FK here (D28):
// an FK to a partitioned parent blocks partition drops. This Ref makes the diagram
// show the logical join the read path performs.
Ref: "transactions".("transaction_id", "occurred_at") - "user_transaction_overrides".("transaction_id", "occurred_at")
EOF