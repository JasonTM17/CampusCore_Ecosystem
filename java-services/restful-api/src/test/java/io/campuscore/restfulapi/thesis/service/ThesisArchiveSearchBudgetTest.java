package io.campuscore.restfulapi.thesis.service;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.common.LikePattern;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/**
 * The archive search emits ten {@code LIKE} predicates per accepted word, so
 * the word list and each word must share the term budget every other list
 * search applies. Unbounded input would otherwise let one request build a
 * statement proportional to the query string.
 */
class ThesisArchiveSearchBudgetTest {

    @Test
    void capsTheAcceptedWordCountAtTheSharedLimit() {
        String search = IntStream.range(0, LikePattern.MAX_TOKENS * 4)
                .mapToObj(index -> "term" + index)
                .collect(Collectors.joining(" "));

        assertThat(ThesisArchiveSearch.tokens(search)).hasSize(LikePattern.MAX_TOKENS);
    }

    @Test
    void capsEachWordAtTheSharedTermLength() {
        List<String> tokens = ThesisArchiveSearch.tokens("x".repeat(LikePattern.MAX_TERM_LENGTH * 4));

        assertThat(tokens).hasSize(1);
        assertThat(tokens.getFirst()).hasSize(LikePattern.MAX_TERM_LENGTH);
    }
}
