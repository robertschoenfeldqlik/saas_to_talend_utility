package com.saastalend.service;

import com.saastalend.model.AuthConfig;
import com.saastalend.model.DiscoveredEndpoint;
import com.saastalend.parser.AuthDetector;
import com.saastalend.parser.OpenApiV3Parser;
import com.saastalend.parser.SwaggerV2Parser;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.servers.Server;
import io.swagger.v3.parser.OpenAPIV3Parser;
import io.swagger.v3.parser.converter.SwaggerConverter;
import io.swagger.v3.parser.core.models.ParseOptions;
import io.swagger.v3.parser.core.models.SwaggerParseResult;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class OpenApiParserService {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DiscoveryResult {
        private String apiName;
        private String baseUrl;
        private AuthConfig auth;
        private List<DiscoveredEndpoint> endpoints;
        private List<String> warnings;
    }

    /**
     * Parses an OpenAPI/Swagger spec string and discovers endpoints.
     */
    public DiscoveryResult parseSpec(String specContent) {
        List<String> warnings = new ArrayList<>();

        // Block SSRF / local-file disclosure: a malicious spec can carry a
        // $ref pointing at a remote URL (e.g. cloud metadata) or a local file
        // (file:///…), which swagger-parser would dereference during
        // resolution. We accept only internal refs ("#/…") — multi-file specs
        // aren't supported here anyway since we parse a single spec string.
        assertNoExternalRefs(specContent);

        ParseOptions options = new ParseOptions();
        options.setResolve(true);
        options.setResolveFully(true);

        // Swagger 2.0 specs must be routed through the v2->v3 converter
        // explicitly. OpenAPIV3Parser is supposed to auto-detect 2.0 via a
        // ServiceLoader extension, but that lookup doesn't resolve inside the
        // Spring Boot fat jar, so a 2.0 doc would otherwise fail with the
        // misleading "attribute openapi is missing".
        boolean isSwagger2 = looksLikeSwagger2(specContent);
        SwaggerParseResult parseResult = isSwagger2
                ? new SwaggerConverter().readContents(specContent, null, options)
                : new OpenAPIV3Parser().readContents(specContent, null, options);

        if (parseResult.getMessages() != null) {
            warnings.addAll(parseResult.getMessages());
        }

        OpenAPI openAPI = parseResult.getOpenAPI();
        if (openAPI == null) {
            throw new IllegalArgumentException(
                    "Failed to parse OpenAPI spec. Errors: " + String.join(", ", warnings));
        }

        // Extract API name
        String apiName = "Unknown API";
        Info info = openAPI.getInfo();
        if (info != null && info.getTitle() != null) {
            apiName = info.getTitle();
        }

        // Extract base URL
        String baseUrl = "";
        if (openAPI.getServers() != null && !openAPI.getServers().isEmpty()) {
            Server server = openAPI.getServers().get(0);
            baseUrl = server.getUrl();
            if (baseUrl != null && baseUrl.endsWith("/")) {
                baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
            }
        }

        // Detect auth
        AuthConfig auth = AuthDetector.detect(openAPI);

        // Parse endpoints with the version-appropriate extractor.
        List<DiscoveredEndpoint> endpoints;
        if (isSwagger2) {
            SwaggerV2Parser v2Parser = new SwaggerV2Parser();
            endpoints = v2Parser.parse(openAPI);
        } else {
            OpenApiV3Parser v3Parser = new OpenApiV3Parser();
            endpoints = v3Parser.parse(openAPI);
        }

        if (endpoints.isEmpty()) {
            warnings.add("No GET list endpoints discovered. The spec may contain only detail or mutation endpoints.");
        }

        return DiscoveryResult.builder()
                .apiName(apiName)
                .baseUrl(baseUrl)
                .auth(auth)
                .endpoints(endpoints)
                .warnings(warnings)
                .build();
    }

    private static final java.util.regex.Pattern REF_RE =
            java.util.regex.Pattern.compile("\\$ref\\s*['\"]?\\s*:\\s*['\"]?([^'\"\\s,}\\]]+)");

    /**
     * Rejects any spec that references an external document. A $ref whose
     * target does not begin with '#' points outside the spec (a remote URL or
     * a local file path) and would cause swagger-parser to fetch it — an SSRF
     * and local-file-read vector when the spec is attacker-supplied.
     */
    static void assertNoExternalRefs(String specContent) {
        if (specContent == null) return;
        java.util.regex.Matcher m = REF_RE.matcher(specContent);
        while (m.find()) {
            String ref = m.group(1);
            if (isExternalRef(ref)) {
                throw new IllegalArgumentException(
                        "External $ref is not allowed in the spec: \"" + ref
                        + "\". Inline the referenced definition and retry.");
            }
        }
    }

    /**
     * True only for $ref values that actually point outside the document — a URL
     * or a file path (optionally with a #fragment). Internal pointers ("#/…") and
     * loose-regex false matches (e.g. a YAML "$ref: >-" folded scalar, seen in the
     * OpenAI spec) are not external refs and must not be rejected.
     */
    private static boolean isExternalRef(String ref) {
        if (ref == null || ref.isEmpty() || ref.startsWith("#")) return false;
        return ref.contains("://")
                || ref.contains("/") || ref.contains("\\")
                || ref.matches("(?i).*\\.(ya?ml|json)(#.*)?$");
    }

    private static final java.util.regex.Pattern SWAGGER2_RE =
            java.util.regex.Pattern.compile("[\"']?swagger[\"']?\\s*:\\s*[\"']?2\\.");

    /** True if the spec declares Swagger/OpenAPI 2.0 (vs OpenAPI 3.x). */
    static boolean looksLikeSwagger2(String spec) {
        return spec != null && SWAGGER2_RE.matcher(spec).find();
    }
}
