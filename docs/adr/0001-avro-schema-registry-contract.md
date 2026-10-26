# 0001. Avro and Schema Registry are the contract between producers and consumers

- **Status:** Accepted
- **Where it lives:** [`schemas/`](../../schemas), [`register.py`](../../infrastructure/schema-registry/register.py), [`producer_core.py`](../../apps/producers/src/producer_core.py), [`avro-deserialiser.ts`](../../apps/consumer/src/integrations/events/avro-deserialiser.ts), [`check-schema-compatibility.ts`](../../apps/consumer/scripts/check-schema-compatibility.ts)
- **Related:** [0003](0003-at-least-once-crash-only.md) (what an unknown schema id does), [message-flow.html](message-flow.html)

## Context

The producers are Python and the consumers are Node. They share no code, so the only thing they can agree on is the message format.

The messages carry money: an amount in cents. A format that lets a missing amount read as zero, or turns cents into a float, would be wrong without anyone noticing.

The schemas change over time. `schemas/v2/card.avsc` already adds a field.

## Decision

**One Avro schema per source, governed by Confluent Schema Registry.**

- The four schemas live in `schemas/*.avsc`. `register.py` registers each one under its topic's subject (`transactions.card-value`) and sets that subject's compatibility to BACKWARD: every new version must be able to read the records written with the one before.
- Producers never register schemas (`auto.register.schemas: False`). At startup each one fetches its subject's latest version and pins its serializer to it. The registry enforces the rules, and git decides what the schemas are.
- The record key is the field the schema names as `partitionKey`: `customerId`. Each customer's transactions stay in order on one partition.
- The consumer loads every version of its subject at startup. It decodes each message with the writer schema named by the id in the message's frame, and never resolves it against a reader schema of its own. A message with an id it didn't load stops the consumer, and the restart loads the new version ([0003](0003-at-least-once-crash-only.md)).
- The schema file is also the test data's source. Its `arg.properties` annotations drive the generator, and `register.py` strips them before registering, keeping `partitionKey`.

**Money is a `long` of minor units** (cents). There are no floats and no decimal logical type.

**Closed sets are Avro enums where both sides agree on the values.** `transactionType` and `creditDebitIndicator` are enums whose symbols match the database's enum values. This is safe here because no reader resolves against an older reader schema: a message is decoded with the schema it was written with, so a new symbol decodes. The consumer's Zod schemas and the database enums still decide which values are accepted. A new value therefore reaches the database and the consumer before any producer sends it. `status` and `currency` are still strings, checked by the consumer and the database.

**Rollout rules.**

- **A field added with a default** can ship producer-first. Each running consumer restarts once, on the first message with the new id.
- **A removed field** that the consumer reads ships consumer-first. BACKWARD allows a removal, so the registry won't stop it.
- **A change BACKWARD rejects** goes to a new topic, such as `transactions.card.v2`.

CI's `schemas` workflow checks the same rule without a registry. Each schema must read the records of its version on the base branch, and each `schemas/vN` file must read its base schema.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Protobuf | proto3 can't tell a missing field from its zero value, so a missing amount reads as zero cents. The registry's Protobuf checks mostly guard field numbers. |
| JSON Schema | Compatibility checks are weak: with an open content model almost any change passes, and with a closed one almost none does. |
| Plain JSON | There is no compatibility gate. Every record repeats every key name, and `JSON.parse` turns amounts into doubles. |
| Producers auto-register | A producer could publish a schema nobody reviewed. |
| Strings for every closed set | Strings are safer only for readers that resolve against their own reader schema, and none do here. An enum stops a producer sending `"Debit"`. |

## Consequences

- The registry is needed at startup on both sides, but never per message.
- When producers roll first, a new schema version costs each consumer instance one restart.
- A future reader that resolves against its own reader schema (a Java consumer with generated classes, say) would fail on a new enum symbol. It needs the symbol first, or an enum `default`.
- The unit lives in the schema's `doc`, not in the type: `amount` is cents because the schema says so.
- avsc decodes a `long` to a JavaScript number, which is exact only up to 2^53 (about 90 trillion rand in cents). Nothing converts longs to `BigInt`.

## Open

- **`long` precision:** either accept the 2^53 bound in writing, or decode longs as `BigInt` (an avsc `LongType`, with a `bigint` column mode in Drizzle).
- **`status`:** decide whether it becomes an enum like the other two closed sets.

## Revisit when

- A producer we don't control writes to a source topic.
- The organisation standardises on Protobuf and gRPC.
