package com.saastalend.parser;

import com.saastalend.model.AuthConfig;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.security.OAuthFlow;
import io.swagger.v3.oas.models.security.OAuthFlows;
import io.swagger.v3.oas.models.security.SecurityScheme;

import java.util.Map;

public final class AuthDetector {

    private AuthDetector() {
    }

    /**
     * Detects authentication configuration from an OpenAPI spec.
     */
    public static AuthConfig detect(OpenAPI spec) {
        if (spec == null || spec.getComponents() == null || spec.getComponents().getSecuritySchemes() == null) {
            return AuthConfig.builder().type(AuthConfig.AuthType.NO_AUTH).build();
        }
        return detect(spec.getComponents().getSecuritySchemes());
    }

    /**
     * Detects authentication configuration from security schemes map.
     */
    public static AuthConfig detect(Map<String, SecurityScheme> securitySchemes) {
        if (securitySchemes == null || securitySchemes.isEmpty()) {
            return AuthConfig.builder().type(AuthConfig.AuthType.NO_AUTH).build();
        }

        for (Map.Entry<String, SecurityScheme> entry : securitySchemes.entrySet()) {
            SecurityScheme scheme = entry.getValue();
            if (scheme == null || scheme.getType() == null) {
                continue;
            }

            switch (scheme.getType()) {
                case APIKEY:
                    return AuthConfig.builder()
                            .type(AuthConfig.AuthType.API_KEY)
                            .apiKeyName(scheme.getName())
                            .apiKeyLocation(scheme.getIn() != null ? scheme.getIn().toString() : "header")
                            .build();

                case HTTP:
                    if ("bearer".equalsIgnoreCase(scheme.getScheme())) {
                        return AuthConfig.builder()
                                .type(AuthConfig.AuthType.BEARER_TOKEN)
                                .build();
                    } else if ("basic".equalsIgnoreCase(scheme.getScheme())) {
                        return AuthConfig.builder()
                                .type(AuthConfig.AuthType.BASIC)
                                .build();
                    }
                    break;

                case OAUTH2:
                    AuthConfig.AuthConfigBuilder builder = AuthConfig.builder()
                            .type(AuthConfig.AuthType.OAUTH2);

                    OAuthFlows flows = scheme.getFlows();
                    if (flows != null) {
                        OAuthFlow flow = null;
                        String grantType = "client_credentials";

                        if (flows.getClientCredentials() != null) {
                            flow = flows.getClientCredentials();
                            grantType = "client_credentials";
                        } else if (flows.getAuthorizationCode() != null) {
                            flow = flows.getAuthorizationCode();
                            grantType = "authorization_code";
                        } else if (flows.getImplicit() != null) {
                            flow = flows.getImplicit();
                            grantType = "implicit";
                        } else if (flows.getPassword() != null) {
                            flow = flows.getPassword();
                            grantType = "password";
                        }

                        if (flow != null && flow.getTokenUrl() != null) {
                            builder.oauth2TokenUrl(flow.getTokenUrl());
                        }
                        builder.oauth2GrantType(grantType);
                    }

                    return builder.build();

                default:
                    break;
            }
        }

        return AuthConfig.builder().type(AuthConfig.AuthType.NO_AUTH).build();
    }
}
