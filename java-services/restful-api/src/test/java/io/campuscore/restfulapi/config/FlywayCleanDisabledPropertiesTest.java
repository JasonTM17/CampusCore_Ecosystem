package io.campuscore.restfulapi.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.bind.PropertySourcesPlaceholdersResolver;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.flyway.autoconfigure.FlywayProperties;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

/**
 * Locks Flyway clean-off in the persistence profile. Flyway and Spring Boot
 * already default clean-disabled to true; the explicit YAML key keeps that
 * safety from depending on an upstream default and from being flipped without
 * an intentional edit.
 */
class FlywayCleanDisabledPropertiesTest {

    @Test
    void flywayPropertiesDefaultToCleanDisabled() {
        assertThat(new FlywayProperties().isCleanDisabled()).isTrue();
    }

    @Test
    void persistenceProfileExplicitlyDisablesFlywayClean() throws Exception {
        PropertySource<?> persistence = persistenceProfileDocument();

        assertThat(persistence.getProperty("spring.flyway.clean-disabled")).isEqualTo(true);

        MutablePropertySources propertySources = new MutablePropertySources();
        propertySources.addLast(persistence);
        Binder binder = new Binder(ConfigurationPropertySources.from(propertySources),
                new PropertySourcesPlaceholdersResolver(propertySources));

        FlywayProperties properties =
                binder.bind("spring.flyway", Bindable.of(FlywayProperties.class)).get();

        assertThat(properties.isCleanDisabled()).isTrue();
    }

    private static PropertySource<?> persistenceProfileDocument() throws Exception {
        List<PropertySource<?>> documents =
                new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml"));
        return documents.stream()
                .filter(document -> "persistence".equals(
                        document.getProperty("spring.config.activate.on-profile")))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "application.yml must keep a persistence profile document"));
    }
}
