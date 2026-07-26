# apache/kafka + a CreateTopicPolicy plugin that caps partitions per topic
# (policy/MaxPartitionsCreateTopicPolicy.java, wired up via
# create.topic.policy.class.name in docker-compose).
FROM apache/kafka:4.0.0 AS kafka

FROM eclipse-temurin:21-jdk AS build
COPY --from=kafka /opt/kafka/libs /opt/kafka/libs
COPY policy/ /src/
RUN javac -cp "/opt/kafka/libs/*" -d /classes /src/*.java && \
    jar cf /topic-policy.jar -C /classes .

FROM apache/kafka:4.0.0
COPY --from=build /topic-policy.jar /opt/kafka/libs/topic-policy.jar
