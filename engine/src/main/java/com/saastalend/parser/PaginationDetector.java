package com.saastalend.parser;

import io.swagger.v3.oas.models.parameters.Parameter;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class PaginationDetector {

    private static final Set<String> CURSOR_PARAMS = Set.of(
            "cursor", "after", "next_token", "page_token", "starting_after", "next_cursor"
    );
    private static final Set<String> OFFSET_PARAMS = Set.of(
            "offset", "skip", "start"
    );
    private static final Set<String> PAGE_PARAMS = Set.of(
            "page", "page_number", "pageNumber", "page_num"
    );

    private PaginationDetector() {
    }

    /**
     * Detects pagination style from query parameters.
     * Returns a Map with "style" key and any relevant parameter names.
     */
    public static Map<String, String> detect(List<Parameter> queryParams) {
        Map<String, String> result = new HashMap<>();

        if (queryParams == null || queryParams.isEmpty()) {
            result.put("style", "none");
            return result;
        }

        for (Parameter param : queryParams) {
            if (param == null || param.getName() == null) {
                continue;
            }
            String name = param.getName().toLowerCase();

            if (CURSOR_PARAMS.contains(name)) {
                result.put("style", "cursor");
                result.put("cursorParam", param.getName());
                findLimitParam(queryParams, result);
                return result;
            }
        }

        for (Parameter param : queryParams) {
            if (param == null || param.getName() == null) {
                continue;
            }
            String name = param.getName().toLowerCase();

            if (OFFSET_PARAMS.contains(name)) {
                result.put("style", "offset");
                result.put("offsetParam", param.getName());
                findLimitParam(queryParams, result);
                return result;
            }
        }

        for (Parameter param : queryParams) {
            if (param == null || param.getName() == null) {
                continue;
            }
            String name = param.getName().toLowerCase();

            if (PAGE_PARAMS.contains(name)) {
                result.put("style", "page");
                result.put("pageParam", param.getName());
                findLimitParam(queryParams, result);
                return result;
            }
        }

        result.put("style", "none");
        return result;
    }

    private static void findLimitParam(List<Parameter> queryParams, Map<String, String> result) {
        Set<String> limitNames = Set.of("limit", "per_page", "page_size", "pageSize", "count", "size", "max_results");
        for (Parameter param : queryParams) {
            if (param != null && param.getName() != null) {
                if (limitNames.contains(param.getName().toLowerCase())) {
                    result.put("limitParam", param.getName());
                    return;
                }
            }
        }
    }
}
