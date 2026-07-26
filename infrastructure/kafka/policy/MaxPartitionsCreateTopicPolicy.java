package dev.txn.kafka;

import java.util.Map;
import org.apache.kafka.common.errors.PolicyViolationException;
import org.apache.kafka.server.policy.CreateTopicPolicy;

/**
 * Rejects topic creation requests that exceed a partition budget. Runs inside the
 * broker/controller for every CreateTopics call — unlike ACLs it also applies to
 * super users and the UI, guarding against fat-fingered "partitions=500" mistakes.
 * Cap is configured via create.topic.policy.max.partitions (default 50).
 */
public class MaxPartitionsCreateTopicPolicy implements CreateTopicPolicy {

  static final String MAX_PARTITIONS_CONFIG = "create.topic.policy.max.partitions";

  private int maxPartitions = 50;

  @Override
  public void configure(Map<String, ?> configs) {
    Object value = configs.get(MAX_PARTITIONS_CONFIG);
    if (value != null) {
      maxPartitions = Integer.parseInt(value.toString().trim());
    }
  }

  @Override
  public void validate(RequestMetadata request) throws PolicyViolationException {
    Integer partitions = request.numPartitions();
    if (partitions == null && request.replicasAssignments() != null) {
      // Manual replica assignment: partition count is the number of assignments
      partitions = request.replicasAssignments().size();
    }
    if (partitions != null && partitions > maxPartitions) {
      throw new PolicyViolationException(
          "Topic '" + request.topic() + "' requests " + partitions
              + " partitions, above the allowed maximum of " + maxPartitions);
    }
  }

  @Override
  public void close() {}
}
