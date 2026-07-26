#!/bin/bash
# Runs once after Kafka starts. Creates SCRAM-SHA-512 credentials.
# Connects via PLAINTEXT (internal Docker network) to bootstrap credentials
# that clients use on the SASL_PLAINTEXT listener.

set -e

echo "Waiting for Kafka to be ready..."
until /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server kafka1:9092 > /dev/null 2>&1; do
  sleep 2
done
echo "Kafka is ready."

# --- SCRAM-SHA-512 credentials ---
# These users authenticate on the EXTERNAL (SASL_PLAINTEXT) listener.
# Services running on the host use these credentials to connect to localhost:29092.

echo "Creating SCRAM credentials..."

/opt/kafka/bin/kafka-configs.sh --bootstrap-server kafka1:9092 \
  --alter --add-config 'SCRAM-SHA-512=[iterations=8192,password=producer-secret]' \
  --entity-type users --entity-name producer

/opt/kafka/bin/kafka-configs.sh --bootstrap-server kafka1:9092 \
  --alter --add-config 'SCRAM-SHA-512=[iterations=8192,password=consumer-secret]' \
  --entity-type users --entity-name consumer

/opt/kafka/bin/kafka-configs.sh --bootstrap-server kafka1:9092 \
  --alter --add-config 'SCRAM-SHA-512=[iterations=8192,password=admin]' \
  --entity-type users --entity-name admin

echo "SCRAM credentials created: producer, consumer, admin"

# --- ACLs ---
# StandardAuthorizer is default-deny: SASL principals can do NOTHING until
# granted here. admin is a super user (see docker-compose) and needs no ACLs —
# only admins can create topics. NOTE: deliberately NOT using the kafka-acls
# --producer convenience flag; it would also grant CREATE on the topic.

echo "Applying ACLs..."

# producer: write-only on transaction topics (prefix covers transactions + transactions.dlq)
/opt/kafka/bin/kafka-acls.sh --bootstrap-server kafka1:9092 --add \
  --allow-principal User:producer \
  --operation Write --operation Describe \
  --topic transactions --resource-pattern-type prefixed

# Belt-and-braces: explicit DENY on topic creation for producer. Default-deny
# already blocks it, but a DENY ACL outranks any ALLOW someone adds later.
/opt/kafka/bin/kafka-acls.sh --bootstrap-server kafka1:9092 --add \
  --deny-principal User:producer \
  --operation Create --topic '*'

/opt/kafka/bin/kafka-acls.sh --bootstrap-server kafka1:9092 --add \
  --deny-principal User:producer \
  --operation Create --cluster

# consumer: read-only on transaction topics, any consumer group
/opt/kafka/bin/kafka-acls.sh --bootstrap-server kafka1:9092 --add \
  --allow-principal User:consumer \
  --operation Read --operation Describe \
  --topic transactions --resource-pattern-type prefixed

/opt/kafka/bin/kafka-acls.sh --bootstrap-server kafka1:9092 --add \
  --allow-principal User:consumer \
  --operation Read --group '*'

echo "ACLs applied."

# --- Topics ---
# Auto-create is disabled on the broker. Create application topics explicitly
# so producers and consumers can attach on first startup.

echo "Creating topics..."

/opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka1:9092 \
  --create --if-not-exists \
  --topic transactions \
  --partitions 12 \
  --replication-factor 1 \
  --config retention.ms=604800000 \
  --config compression.type=producer

/opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka1:9092 \
  --create --if-not-exists \
  --topic transactions.dlq \
  --partitions 3 \
  --replication-factor 1 \
  --config retention.ms=2592000000 \
  --config compression.type=producer

echo "Topics created: transactions, transactions.dlq"
echo "Kafka init complete."
