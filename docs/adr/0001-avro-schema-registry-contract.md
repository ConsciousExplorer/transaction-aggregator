# 0001. Avro and Schema Registry are the contract between producers and consumers

- **Status:** Accepted
- **Where it lives:** [`schemas/`](../../schemas), [`register.py`](../../infrastructure/schema-registry/register.py), [`producer_core.py`](../../apps/producers/src/producer_core.py), [`avro-deserialiser.ts`](../../apps/consumer/src/integrations/events/avro-deserialiser.ts), [`check-schema-compatibility.ts`](../../apps/consumer/scripts/check-schema-compatibility.ts)
- **Related:** [0003](0003-at-least-once-crash-only.md) (what an unknown schema id does), [message-flow.html](message-flow.html)

## Context

The producers are Python and the consumers are Node. They share no code, so the only thing they can agree on is the message format.

The messages carry money: an amount in cents. A format that lets a missing amount read as zero, or turns cents into a float, would be wrong without anyone noticing.

The schemas change over time. `schemas/v2/card.avsc` already adds a field. A consumer built for one version is still running when a producer starts writing the next.

## Decision

**One Avro schema per source, governed by Confluent Schema Registry.**

- The four schemas live in `schemas/*.avsc`. `register.py` registers each one under its topic's subject (`transactions.card-value`) and sets that subject's compatibility to FORWARD_TRANSITIVE: every earlier version must be able to read the records written with a new one. It is the rule an API contract follows. A producer may add a field, and may not take one away from a reader that is already running.
- Producers never register schemas (`auto.register.schemas: False`). At startup each one fetches its subject's latest version and pins its serializer to it. The registry enforces the rules, and git decides what the schemas are.
- The record key is the field the schema names as `partitionKey`: `customerId`. Each customer's transactions stay in order on one partition.
- The consumer loads every version of its subject at startup. It decodes each message with the writer schema named by the id in the message's frame, and never resolves it against a reader schema of its own: it reads the fields it knows from the decoded record and leaves the rest.
- A message with an id the consumer hasn't loaded makes it fetch that schema from the registry, once, before the message is decoded. A new version costs no restart. If the registry can't supply the schema the consumer stops, and the restart asks again ([0003](0003-at-least-once-crash-only.md)).
- The schema file is also the test data's source. Its `arg.properties` annotations drive the generator, and `register.py` strips them before registering, keeping `partitionKey`.

**Money is a `long` of minor units** (cents). There are no floats and no decimal logical type.

**Closed sets are Avro enums where both sides agree on the values.** `transactionType` and `creditDebitIndicator` are enums whose symbols match the database's enum values. A new symbol is a breaking change under this rule, because a reader on an earlier version can't read it, and the registry refuses one. That matches the consumer: its Zod schemas and the database enums are closed sets too, and a value they don't know is dead-lettered. A new transaction type arrives as a new source, with its own schema, topic and consumer, and the existing schemas keep their symbols. `status` and `currency` are strings, checked by the consumer and the database.

**Rollout rules.**

- **An added field** ships producer-first, with or without a default. Each running consumer fetches the new version on the first message written with it, and keeps running. A consumer release that starts reading the field has to cope with the older records that lack it.
- **A removed field** is refused by the registry, unless every earlier version that has the field gave it a default. No field the consumer reads has one.
- **A change the registry rejects** goes to a new topic, such as `transactions.card.v2`. Removing or renaming a field, changing its type and adding an enum symbol are all of these.
- **Before the first release** the schemas are changed in place, and the stack is rebuilt from empty volumes (`make clean`, then `make up`). `loan` was removed from `TransactionType` that way. A stack that kept its volumes still has the old versions, and the registry checks the new ones against them.

CI's `schemas` workflow checks the newest step of that rule without a registry. Each schema's version on the base branch must read its records, and each base schema must read the records of its `schemas/vN` file. The registry compares with every older version as well, when `schemas-register` runs.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Protobuf | proto3 can't tell a missing field from its zero value, so a missing amount reads as zero cents. The registry's Protobuf checks mostly guard field numbers. |
| JSON Schema | Compatibility checks are weak: with an open content model almost any change passes, and with a closed one almost none does. |
| Plain JSON | There is no compatibility gate. Every record repeats every key name, and `JSON.parse` turns amounts into doubles. |
| Producers auto-register | A producer could publish a schema nobody reviewed. |
| BACKWARD compatibility | It protects a new reader of old records, and lets a producer remove a field a running consumer reads. The consumer decodes each record with the schema it was written with, so old records never needed that protection. |
| FULL compatibility | It also demands a default on every added field, for the old records no reader here resolves against. |
| FORWARD compatibility, not transitive | It compares a version with the one before it only. A producer could give a field a default in one version and remove it in the next, and a consumer still reading it would lose it. |
| An Avro reader schema in the consumer | A reader schema that moves to a new version also has to read the older records still on the topic, which is BACKWARD's rule on top of this one. |
| Strings for every closed set | A string lets a producer add a value with no schema change, and the consumer would dead-letter it. An enum makes the registry refuse it, and stops a producer sending `"Debit"`. |
| Decoding longs as `BigInt` (an avsc `LongType`, with a `bigint` column mode in Drizzle) | A JavaScript number is exact up to 2^53, about 90 trillion rand in cents, far above any amount this system stores. |

## Consequences

- The registry is needed at startup on both sides, and once more by each consumer instance when a new schema version first appears. It is never needed per message.
- When producers roll first, a new schema version costs each consumer instance one registry read. If the registry is down at that moment, the consumer stops and restarts until it answers.
- An enum can't gain a symbol in place. A new value needs a new topic or a new source.
- CI compares a schema with the base branch only. A change that breaks a version older than that one passes CI and is refused when `schemas-register` runs.
- A field that had a default in every version that carried it can still be removed. `merchantCountry` in `schemas/v2/card.avsc` is the only one.
- The unit lives in the schema's `doc`, not in the type: `amount` is cents because the schema says so.
- avsc decodes a `long` to a JavaScript number, which is exact only up to 2^53 (about 90 trillion rand in cents). Nothing converts longs to `BigInt`.
