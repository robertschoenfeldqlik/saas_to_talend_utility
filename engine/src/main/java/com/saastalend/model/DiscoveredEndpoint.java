package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DiscoveredEndpoint {

    private String id;
    private String name;
    private String path;
    private String method;
    private String description;

    private String paginationStyle;

    @Builder.Default
    private Map<String, String> paginationParams = new HashMap<>();

    private String recordsPath;

    @Builder.Default
    private List<String> primaryKeys = new ArrayList<>();

    @Builder.Default
    private List<FieldInfo> responseFields = new ArrayList<>();

    private String replicationMethod;
    private String replicationKey;

    @Builder.Default
    private boolean selected = true;
}
