package com.saastalend.parser;

import com.google.common.base.CaseFormat;

import java.util.Set;
import java.util.regex.Pattern;

public final class EndpointFilter {

    private static final Pattern PATH_PARAM_SUFFIX = Pattern.compile("/\\{[^}]+}$");
    private static final Pattern API_VERSION_PREFIX = Pattern.compile("^/?(api/)?v\\d+/");
    private static final Set<String> SKIP_SEGMENTS = Set.of("me", "self", "settings", "config", "health", "status", "ping");

    private EndpointFilter() {
    }

    /**
     * Returns true only for GET endpoints that are list/collection endpoints.
     * Skips paths ending with /{param}, and paths like /me, /self, /settings.
     */
    public static boolean isListEndpoint(String path, String method) {
        if (!"GET".equalsIgnoreCase(method)) {
            return false;
        }

        if (PATH_PARAM_SUFFIX.matcher(path).find()) {
            return false;
        }

        String lastSegment = getLastSegment(path);
        if (lastSegment != null && SKIP_SEGMENTS.contains(lastSegment.toLowerCase())) {
            return false;
        }

        return true;
    }

    /**
     * Derives a stream name from the path.
     * Removes /api/v1/ prefixes, takes the last path segment, converts to snake_case.
     */
    public static String deriveStreamName(String path) {
        String cleaned = API_VERSION_PREFIX.matcher(path).replaceFirst("");
        cleaned = cleaned.replaceAll("^/+", "").replaceAll("/+$", "");

        String[] segments = cleaned.split("/");
        String lastSegment = segments[segments.length - 1];

        // Remove any path parameters like {id}
        lastSegment = lastSegment.replaceAll("\\{[^}]+}", "").replaceAll("/+$", "");
        if (lastSegment.isEmpty() && segments.length > 1) {
            lastSegment = segments[segments.length - 2];
        }

        // Convert camelCase or PascalCase to snake_case
        if (lastSegment.contains("-")) {
            return lastSegment.replace("-", "_").toLowerCase();
        }
        if (lastSegment.chars().anyMatch(Character::isUpperCase)) {
            try {
                return CaseFormat.LOWER_CAMEL.to(CaseFormat.LOWER_UNDERSCORE, lastSegment);
            } catch (Exception e) {
                return lastSegment.toLowerCase();
            }
        }

        return lastSegment.toLowerCase();
    }

    private static String getLastSegment(String path) {
        String cleaned = path.replaceAll("/+$", "");
        String[] segments = cleaned.split("/");
        if (segments.length == 0) {
            return null;
        }
        return segments[segments.length - 1];
    }
}
