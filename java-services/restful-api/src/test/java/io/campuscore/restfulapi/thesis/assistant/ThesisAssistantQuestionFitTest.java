package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

class ThesisAssistantQuestionFitTest {
    private static final String QUESTION = "Giải thích ngắn gọn Dependency Injection trong Spring Boot và cho một ví dụ constructor injection.";

    private static ThesisAssistantService service(String content, String title) {
        var repository = mock(ThesisAssistantKnowledgeRepository.class);
        when(repository.search(anyString(), anyList(), anyInt(), eq("specialized"))).thenReturn(List.of(
                new ThesisAssistantKnowledgeRepository.KnowledgeDocument("11111111-1111-1111-1111-111111111111",
                        "focus-test", "vi", title, content, "curated", "SPECIALIZED",
                        null, null, null, null, null, null, null, null, 50)));
        return new ThesisAssistantService(repository, null, null, null, null, null, null,
                new AssistantProperties(6000, 2000, 20, 200, 90, true));
    }

    @Test
    void longDependencyQuestionMustNotReturnThePublishedBroadArchitectureArticle() throws Exception {
        String sql = Files.readString(Path.of("src/main/resources/db/migration/V93__specialized_domain_knowledge_markdown.sql"));
        int start = sql.indexOf("SET content = '## Kiến trúc");
        assertTrue(start > 0, "use the actual published architecture text");
        int end = sql.indexOf("',", start);
        String article = sql.substring(start + "SET content = '".length(), end);
        assertNull(service(article, "Monolith vs microservices architecture and Spring Boot")
                .lexicalFastPath(QUESTION, "vi", "specialized"));
    }

    @Test
    void anArticleMentioningDiWithoutTheRequestedConstructorExampleEscalates() {
        assertNull(service("## Spring Boot\nDependency Injection uses the IoC container. Spring Boot uses MVC.", "Dependency Injection in Spring Boot")
                .lexicalFastPath(QUESTION, "vi", "specialized"));
    }

    @Test
    void anUnrelatedCodeFenceDoesNotGroundAConstructorExampleRequest() {
        String article = "## Dependency Injection / constructor injection\nSpring Boot supports Dependency Injection and constructor injection.\n```java\nclass Empty { public Empty() {} }\n```";
        assertNull(service(article, "Dependency Injection in Spring Boot").lexicalFastPath(QUESTION, "vi", "specialized"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "class Example { public void Example(Object input) {} }",
            "class Example { /* public Example(Object input) {} */ }",
            "class Example { String example = \"class Fake { public Fake(Object input) {} }\"; }"
    })
    void methodsCommentsAndStringLiteralsCannotMasqueradeAsInjectingConstructors(String code) {
        String article = "## Dependency Injection / constructor injection\nSpring Boot supports Dependency Injection and constructor injection.\n```java\n" + code + "\n```";
        assertNull(service(article, "Dependency Injection in Spring Boot").lexicalFastPath(QUESTION, "vi", "specialized"));
    }

    @Test
    void degradedFallbackDoesNotCiteAnUnrelatedArchitectureArticle() {
        var response = service("## Spring Boot architecture\nSpring Boot uses MVC and repositories.", "Spring Boot architecture")
                .groundedFallback(QUESTION, "vi", false, "specialized");
        assertEquals("NO_MATCH", response.reasonCode());
        assertTrue(response.citations().isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            QUESTION,
            "Explain Dependency Injection in Spring Boot with a constructor injection example.",
            "Constructor injection là gì? Cho ví dụ ngắn.",
            "Giai thich tiem phu thuoc va tiem qua ham khoi tao, cho vi du.",
            "Please explain this clearly and briefly for a beginner who is preparing a presentation on dependency injection and provide a constructor injection example."
    })
    void curatedInjectionArticleAnswersVariantsWithTheExampleAndCitation(String question) throws Exception {
        String content = injectionSeed("vi");
        var response = service(content, "Dependency Injection / constructor injection in Spring Boot")
                .lexicalFastPath(question, "vi", "specialized");
        assertNotNull(response);
        assertTrue(response.answer().contains("public OrderService(PaymentGateway gateway)"));
        assertTrue(response.answer().contains("private final PaymentGateway gateway"));
        assertEquals(1, response.citations().size());
    }

    @Test
    void longPreambleCannotCrowdNamedInjectionConceptsOutOfTheRetrievalWindow() {
        var terms = ThesisAssistantService.retrievalTerms("Please explain this clearly and briefly for a beginner who is preparing a presentation on dependency injection and provide a constructor injection example.");
        assertEquals(List.of("dependency injection", "constructor injection"), terms.subList(0, 2));
        assertTrue(terms.size() <= 16);
    }

    @Test
    void sqlInjectionDoesNotActivateSpringDependencyInjectionRules() {
        assertTrue(SpringInjectionQuestionFocus.retrievalPhrases("Explain SQL injection with an example").isEmpty());
        assertTrue(SpringInjectionQuestionFocus.coveredBy("Explain SQL injection with an example", "Use parameterized SQL"));
    }

    @Test
    void codeExampleInBothLocalesActuallyCompiles() throws Exception {
        var compiler = javax.tools.ToolProvider.getSystemJavaCompiler();
        assertNotNull(compiler, "a JDK is required for the published Java example");
        for (String locale : List.of("vi", "en")) {
            String content = injectionSeed(locale);
            int start = content.indexOf("```java\n") + 8;
            String code = content.substring(start, content.indexOf("\n```", start));
            var directory = Files.createTempDirectory("campuscore-di-example-");
            var file = directory.resolve("Example.java");
            Files.writeString(file, code);
            try {
                assertEquals(0, compiler.run(null, null, null, "-classpath", System.getProperty("java.class.path"),
                        "-d", directory.toString(), file.toString()));
            } finally {
                try (var paths = Files.walk(directory)) {
                    for (var path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(path);
                }
            }
        }
    }

    private static String injectionSeed(String locale) throws Exception {
        var rows = new ObjectMapper().readTree(Files.readString(Path.of("../../supabase/seed/assistant-specialized-knowledge.json")));
        for (var row : rows) {
            if (row.path("slug").asText().equals("specialized-spring-dependency-constructor-injection-" + locale))
                return row.path("content").asText();
        }
        throw new AssertionError("Missing localized injection article");
    }
}
