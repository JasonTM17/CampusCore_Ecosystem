# syntax=docker/dockerfile:1
# Bursar service — same builder pattern as restful-api (digests pinned per
# scripts/image-reference-policy.mjs).
FROM maven:3.9.12-eclipse-temurin-21@sha256:c3c9d3ac4ce8431a3995c0318b8d390f448e693dd4fabc16e9b68d2e1f3d7b46 AS build
WORKDIR /workspace
COPY java-services/pom.xml ./pom.xml
COPY java-services/restful-api/pom.xml ./restful-api/pom.xml
COPY java-services/bursar-api/pom.xml ./bursar-api/pom.xml
RUN mvn -q -pl bursar-api -am -DskipTests dependency:go-offline
COPY java-services/bursar-api ./bursar-api
RUN mvn -q -pl bursar-api -am -DskipTests package

FROM eclipse-temurin:21-jre-jammy@sha256:eebd356ad7358b7094758e5787a6726f332917cfd56feab6457c56dab895cdbf
WORKDIR /app
COPY --from=build /workspace/bursar-api/target/bursar-api-*.jar app.jar
EXPOSE 4012
ENTRYPOINT ["java", "-jar", "app.jar"]
