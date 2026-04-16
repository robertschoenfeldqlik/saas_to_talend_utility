package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DiscoveredColumn {

    private String name;
    private String sqlType;
    private String talendType;
    private int size;

    @Builder.Default
    private boolean nullable = true;

    @Builder.Default
    private boolean primaryKey = false;

    private int ordinalPosition;
}
