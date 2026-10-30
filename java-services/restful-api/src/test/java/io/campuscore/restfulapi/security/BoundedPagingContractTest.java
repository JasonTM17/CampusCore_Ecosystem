package io.campuscore.restfulapi.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:bounded_paging_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class BoundedPagingContractTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JdbcTemplate jdbc;

    private RequestPostProcessor userJwt;

    @BeforeEach
    void fixture() {
        userJwt = CurrentAccountJwt.fixtureJwt(jdbc, "paging-user");
    }

    @Test
    void rejectsRepeatedAndInvalidPagingParametersBeforeReadingRows() throws Exception {
        expectBadRequest(get("/api/v1/events").param("page", "0", "1").param("limit", "1"));
        expectBadRequest(get("/api/v1/events").param("page", "0").param("limit", "1", "2"));
        expectBadRequest(get("/api/v1/events").param("page", "0"));
        expectBadRequest(get("/api/v1/events").param("page", "-1").param("limit", "1"));
        expectBadRequest(get("/api/v1/events").param("page", "0").param("limit", "101"));
        expectBadRequest(get("/api/v1/events").param("page", "2147483648").param("limit", "1"));
    }

    private void expectBadRequest(MockHttpServletRequestBuilder request) throws Exception {
        mvc.perform(request.with(userJwt)).andExpect(status().isBadRequest());
    }
}
