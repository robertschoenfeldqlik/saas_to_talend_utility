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

        ParseOptions options = new ParseOptions();
        options.setResolve(true);
        options.setResolveFully(true);

        SwaggerParseResult parseResult = new OpenAPIV3Parser().readContents(specContent, null, options);

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

        // Detect spec version and parse accordingly
        List<DiscoveredEndpoint> endpoints;
        boolean isSwagger2 = specContent.contains("\"swagger\"") && specContent.contains("\"2.");
        if (!isSwagger2) {
            isSwagger2 = specContent.contains("swagger:") && specContent.contains("'2.");
        }

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
}
