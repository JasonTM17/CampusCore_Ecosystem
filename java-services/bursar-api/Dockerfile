# syntax=docker/dockerfile:1
# Bursar service — same builder pattern as restful-api.
FROM maven:3.9.12-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY java-services/pom.xml ./pom.xml
COPY java-services/restful-api/pom.xml ./restful-api/pom.xml
COPY java-services/bursar-api/pom.xml ./bursar-api/pom.xml
RUN mvn -q -pl bursar-api -am -DskipTests dependency:go-offline
COPY java-services/bursar-api ./bursar-api
RUN mvn -q -pl bursar-api -am -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/bursar-api/target/bursar-api-*.jar app.jar
EXPOSE 4012
ENTRYPOINT ["java", "-jar", "app.jar"]
