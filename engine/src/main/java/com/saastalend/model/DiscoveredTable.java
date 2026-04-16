package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DiscoveredTable {

    private String catalog;
    private String schema;
    private String tableName;
    private String tableType; // "TABLE" or "VIEW"

    @Builder.Default
    private List<DiscoveredColumn> columns = new ArrayList<>();

    @Builder.Default
    private List<String> primaryKeys = new ArrayList<>();

    @Builder.Default
    private boolean selected = true;
}
