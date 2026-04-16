package com.saastalend.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuthConfig {

    public enum AuthType {
        NO_AUTH("NO_AUTH"),
        API_KEY("API_KEY"),
        BEARER_TOKEN("BEARER_TOKEN"),
        BASIC("BASIC"),
        OAUTH2("OAUTH2");

        private final String value;

        AuthType(String value) {
            this.value = value;
        }

        @JsonValue
        public String getValue() {
            return value;
        }

        @JsonCreator
        public static AuthType fromValue(String value) {
            for (AuthType type : values()) {
                if (type.value.equalsIgnoreCase(value)) {
                    return type;
                }
            }
            return NO_AUTH;
        }
    }

    @Builder.Default
    private AuthType type = AuthType.NO_AUTH;

    private String bearerToken;
    private String apiKey;
    private String apiKeyName;
    private String apiKeyLocation;
    private String username;
    private String password;
    private String oauth2TokenUrl;
    private String oauth2ClientId;
    private String oauth2ClientSecret;
    private String oauth2GrantType;
}
