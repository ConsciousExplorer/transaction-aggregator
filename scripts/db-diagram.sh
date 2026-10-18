sql2dbml './database/migrations/0000_types_and_tables.sql' --postgres -o db-model.dbml && cat >> db-model.dbml << 'EOF'
// Documentation-only relationship — the database deliberately has NO FK here:
// an FK to a partitioned parent blocks partition drops. This Ref makes the diagram
// show the logical join the read path performs.
Ref: "txn_agg"."transactions".("transaction_id", "occurred_at") - "txn_agg"."user_transaction_overrides".("transaction_id", "occurred_at")
EOF