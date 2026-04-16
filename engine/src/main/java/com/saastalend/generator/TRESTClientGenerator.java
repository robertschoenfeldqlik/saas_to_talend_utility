package com.saastalend.generator;

import com.saastalend.model.*;

import java.util.ArrayList;
import java.util.List;

/**
 * Generates tRESTClient TalendNode using Talend context variables for all
 * credentials, URLs, and tenant-specific values. This ensures generated jobs
 * are portable and never contain hardcoded secrets.
 *
 * Context variable references use the Talend expression: context.VARIABLE_NAME
 */
public final class TRESTClientGenerator {

    private TRESTClientGenerator() {
    }

    /**
     * Generates a tRESTClient TalendNode that references context variables
     * for URL, auth credentials, Qlik tenant, and DB credentials.
     */
    public static TalendNode generate(DiscoveredEndpoint endpoint, AuthConfig auth,
                                       String baseUrl, int posX, int posY) {
        List<TalendElementParameter> params = new ArrayList<>();

        // Core parameters — URL uses context variable
        params.add(param("TEXT", "UNIQUE_NAME", "tRESTClient_1"));
        params.add(param("TEXT", "URL",
                "context.API_BASE_URL + \"" + endpoint.getPath() + "\""));
        params.add(param("CLOSED_LIST", "METHOD", "GET"));
        params.add(param("CLOSED_LIST", "ACCEPT_TYPE", "application/json"));
        params.add(param("CLOSED_LIST", "CONTENT_TYPE", "application/json"));
        params.add(param("CHECK", "NEED_AUTH",
                String.valueOf(auth != null && auth.getType() != AuthConfig.AuthType.NO_AUTH)));

        // Authentication parameters — ALL use context variables, never hardcoded
        if (auth != null) {
            switch (auth.getType()) {
                case BEARER_TOKEN:
                    params.add(param("CLOSED_LIST", "AUTH_TYPE", "BEARER"));
                    params.add(param("TEXT", "BEARER_TOKEN", "context.API_BEARER_TOKEN"));
                    break;

                case API_KEY:
                    params.add(param("CLOSED_LIST", "AUTH_TYPE", "API_KEY"));
                    params.add(param("TEXT", "API_KEY", "context.API_KEY"));
                    params.add(param("TEXT", "API_KEY_NAME",
                            auth.getApiKeyName() != null
                                    ? "\"" + auth.getApiKeyName() + "\""
                                    : "\"X-API-Key\""));
                    params.add(param("CLOSED_LIST", "API_KEY_LOC",
                            auth.getApiKeyLocation() != null ? auth.getApiKeyLocation() : "header"));
                    break;

                case BASIC:
                    params.add(param("CLOSED_LIST", "AUTH_TYPE", "BASIC"));
                    params.add(param("TEXT", "USERNAME", "context.API_USERNAME"));
                    params.add(param("TEXT", "PASSWORD", "context.API_PASSWORD"));
                    break;

                case OAUTH2:
                    params.add(param("CLOSED_LIST", "AUTH_TYPE", "OAUTH2"));
                    params.add(param("TEXT", "OAUTH2_TOKEN_URL", "context.OAUTH2_TOKEN_URL"));
                    params.add(param("TEXT", "OAUTH2_CLIENT_ID", "context.OAUTH2_CLIENT_ID"));
                    params.add(param("TEXT", "OAUTH2_CLIENT_SECRET", "context.OAUTH2_CLIENT_SECRET"));
                    params.add(param("CLOSED_LIST", "OAUTH2_GRANT_TYPE",
                            auth.getOauth2GrantType() != null ? auth.getOauth2GrantType() : "client_credentials"));
                    break;

                case NO_AUTH:
                default:
                    params.add(param("CLOSED_LIST", "AUTH_TYPE", "NO_AUTH"));
                    break;
            }
        }

        // Connection parameters
        params.add(param("TEXT", "CONNECTION_TIMEOUT", "30000"));
        params.add(param("TEXT", "RECEIVE_TIMEOUT", "60000"));
        params.add(param("CHECK", "FOLLOW_REDIRECTS", "true"));
        params.add(param("CHECK", "DIE_ON_ERROR", "false"));

        // Headers table parameter
        params.add(param("TABLE", "HEADERS", "[]"));

        // Query parameters for pagination
        if (endpoint.getPaginationStyle() != null && !"none".equals(endpoint.getPaginationStyle())) {
            params.add(param("TABLE", "QUERY_PARAMS", "[]"));
        }

        // Metadata with standard REST response columns
        List<TalendMetadataColumn> columns = new ArrayList<>();
        columns.add(TalendMetadataColumn.builder()
                .name("statusCode")
                .talendType("id_Integer")
                .key(false)
                .nullable(true)
                .build());
        columns.add(TalendMetadataColumn.builder()
                .name("body")
                .talendType("id_Document")
                .key(false)
                .nullable(true)
                .build());
        columns.add(TalendMetadataColumn.builder()
                .name("string")
                .talendType("id_String")
                .key(false)
                .nullable(true)
                .build());

        TalendMetadata metadata = TalendMetadata.builder()
                .name("tRESTClient_1")
                .connectorName("FLOW_RESPONSE")
                .columns(columns)
                .build();

        return TalendNode.builder()
                .xmiId(XmiIdGenerator.generate())
                .componentName("tRESTClient")
                .componentVersion("0.102")
                .posX(posX)
                .posY(posY)
                .parameters(params)
                .metadata(List.of(metadata))
                .build();
    }

    private static TalendElementParameter param(String field, String name, String value) {
        return TalendElementParameter.builder()
                .field(TalendElementParameter.FieldType.valueOf(field))
                .name(name)
                .value(value)
                .show(true)
                .build();
    }
}
