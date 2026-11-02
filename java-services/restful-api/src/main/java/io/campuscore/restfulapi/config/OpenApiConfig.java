package io.campuscore.restfulapi.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * OpenAPI 3.0 / Swagger Documentation Configuration for CampusUTE REST API.
 * Defines institutional metadata, security schemes (JWT Bearer), and server environments.
 */
@Configuration
public class OpenApiConfig {

    private static final String SECURITY_SCHEME_NAME = "bearerAuth";
    private static final String ERROR_SCHEMA = "#/components/schemas/ErrorResponse";
    private static final Set<String> IDEMPOTENCY_KEY_REQUIRED_OPERATIONS = Set.of(
            "POST /api/v1/admissions/applications",
            "POST /api/v1/admissions/applications/{applicationId}/attachments",
            "DELETE /api/v1/admissions/applications/{applicationId}/attachments/{attachmentId}",
            "POST /api/v1/admissions/applications/{applicationId}/submit",
            "POST /api/v1/admissions/applications/{applicationId}/withdraw",
            "POST /api/v1/careers/applications",
            "POST /api/v1/careers/applications/{applicationId}/attachments",
            "POST /api/v1/careers/applications/{applicationId}/withdraw",
            "POST /api/v1/enrollments/enroll",
            "POST /api/v1/enrollments/{id}/drop",
            "POST /api/v1/events/registrations/{registrationId}/cancel",
            "POST /api/v1/events/{eventId}/register",
            "POST /api/v1/learning/assignments/{assignmentId}/draft",
            "POST /api/v1/learning/assignments/{assignmentId}/resubmit",
            "POST /api/v1/learning/assignments/{assignmentId}/submit",
            "POST /api/v1/library/requests",
            "POST /api/v1/library/requests/{requestId}/cancel",
            "POST /api/v1/me/enrollments",
            "POST /api/v1/me/enrollments/{id}/drop");

    @Bean
    public OpenAPI campusCoreOpenAPI(
            @Value("${server.port:4010}") String serverPort,
            @Value("${spring.application.name:campuscore-restful-api}") String appName) {

        return new OpenAPI()
                .info(new Info()
                        .title("TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM (HCM-UTE) - RESTful API")
                        .description("""
                                ### Hệ thống Quản trị Đào tạo & Khóa luận Tốt nghiệp CampusUTE
                                Tài liệu đặc tả kỹ thuật RESTful API theo tiêu chuẩn đào tạo và quy chế quản lý khóa luận của Trường Đại học Công nghệ Kỹ thuật TP.HCM.

                                #### Các phân hệ nghiệp vụ chính:
                                - **Xác thực & Định danh (Auth)**: JWT Token, đăng nhập đa vai trò (Sinh viên, Giảng viên, Phòng Đào tạo).
                                - **Quản lý Học vụ & CTĐT (Academic)**: 8 Khoa đào tạo HCM-UTE, học phần, thời khóa biểu tuần, cơ chế điểm 50% Quá trình + 50% Cuối kỳ.
                                - **Đăng ký Học phần (Registration)**: Kiểm tra xung đột lịch học, sĩ số lớp, hạn mức chuẩn 28 tín chỉ/học kỳ; đơn được Phòng Đào tạo phê duyệt mở tối đa 30 tín chỉ cho đúng sinh viên (triển khai demo có thể đặt hạn mức rộng hơn qua REGISTRATION_CREDIT_LIMIT_OVERRIDE).
                                - **Điểm Rèn Luyện (Conduct - ĐRL)**: 5 tiêu chí rèn luyện chính thức theo Quyết định số 24/2020/QĐ-BGDĐT.
                                - **Khóa luận Tốt nghiệp & Đồ án (Thesis Lifecycle)**:
                                  - Đợt đăng ký (MON_HOC, NCKH, TLCN, KLTN).
                                  - Đề tài theo Bộ môn & Giảng viên hướng dẫn (1-2 GVHD).
                                  - Nhóm sinh viên (3–4 SV, đúng 1 nhóm trưởng).
                                  - Nộp báo cáo luận văn (Chỉ nhóm trưởng nộp trước hạn GVPB).
                                  - Hội đồng chấm bảo vệ 3-5 thành viên (Chủ tịch, Thư ký, Phản biện, Ủy viên).
                                  - Quy tắc loại trừ GVHD không được chấm điểm (`SUPERVISOR_CANNOT_GRADE`).
                                  - Chủ tịch chốt điểm trung bình và công bố kết quả.
                                - **Công văn Thông báo Hành chính (Announcements)**: Soạn thảo theo thể thức văn bản hành chính Nghị định 30/2020/NĐ-CP.

                                #### Hướng dẫn xác thực:
                                1. Gọi endpoint `POST /api/v1/auth/login` để lấy `accessToken`.
                                2. Nhấn nút **Authorize** màu xanh ở góc trên bên phải Swagger UI.
                                3. Nhập token vào ô `bearerAuth` và nhấn **Authorize**.
                                """)
                        .version("2.4.0 (Enterprise Architecture)")
                        .contact(new Contact()
                                .name("Phòng Đào tạo - Trường Đại học Công nghệ Kỹ thuật TP.HCM")
                                .email("daotao@ute.edu.vn")
                                .url("https://ute.edu.vn"))
                        .license(new License()
                                .name("HCM-UTE Educational License - Nghiêm cấm sao chép trái phép")
                                .url("https://ute.edu.vn/ban-quyen")))
                .servers(List.of(
                        new Server()
                                .url("http://127.0.0.1:" + serverPort)
                                .description("Máy chủ phát triển nội bộ (Localhost Dev Server)")))
                .addSecurityItem(new SecurityRequirement().addList(SECURITY_SCHEME_NAME))
                .components(new Components()
                        .addSecuritySchemes(SECURITY_SCHEME_NAME,
                                new SecurityScheme()
                                        .name(SECURITY_SCHEME_NAME)
                                        .type(SecurityScheme.Type.HTTP)
                                        .scheme("bearer")
                                        .bearerFormat("JWT")
                                        .description("Nhập JSON Web Token (JWT) được cấp khi đăng nhập")));
    }

    @Bean
    public OpenApiCustomizer documentRuntimeContractDetails() {
        return openApi -> {
            if (openApi.getPaths() == null) {
                return;
            }

            openApi.getPaths().forEach((path, pathItem) -> pathItem.readOperationsMap().forEach((method, operation) -> {
                String operationKey = method.name() + " " + path;
                if (IDEMPOTENCY_KEY_REQUIRED_OPERATIONS.contains(operationKey) && operation.getParameters() != null) {
                    operation.getParameters().stream()
                            .filter(parameter -> "header".equals(parameter.getIn())
                                    && "Idempotency-Key".equals(parameter.getName()))
                            .forEach(parameter -> parameter.setRequired(true));
                }

                if (operation.getParameters() != null) {
                    operation.getParameters().stream()
                            .filter(parameter -> "query".equals(parameter.getIn())
                                    && "queryParameters".equals(parameter.getName()))
                            .forEach(this::documentQueryParameterMap);
                }

                if (operation.getResponses() != null) {
                    operation.getResponses().forEach((status, response) -> {
                        if (isErrorStatus(status)) {
                            response.setContent(new Content().addMediaType(
                                    "application/json",
                                    new MediaType().schema(new Schema<>().$ref(ERROR_SCHEMA))));
                        }
                    });
                }

                if ("GET".equals(method.name())
                        && ("/session/login".equals(path) || "/session/callback".equals(path))
                        && operation.getResponses() != null) {
                    operation.getResponses().remove("200");
                    io.swagger.v3.oas.models.responses.ApiResponse redirect =
                            operation.getResponses().get("302");
                    if (redirect != null) {
                        redirect.setContent(null);
                    }
                }

                if ("GET".equals(method.name())
                        && "/api/v1/thesis/topics/{id}/report".equals(path)
                        && operation.getResponses() != null) {
                    io.swagger.v3.oas.models.responses.ApiResponse noContent =
                            operation.getResponses().get("204");
                    if (noContent != null) {
                        noContent.setContent(null);
                    }
                }
            }));
        };
    }

    private void documentQueryParameterMap(Parameter parameter) {
        parameter.setRequired(false);
        parameter.setDescription("Optional free-form map of query parameter names to string values.");
        parameter.setSchema(new ObjectSchema().additionalProperties(new StringSchema()));
        parameter.setStyle(Parameter.StyleEnum.FORM);
        parameter.setExplode(true);
    }

    private static boolean isErrorStatus(String status) {
        return status != null && (status.startsWith("4") || status.startsWith("5"));
    }
}
