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
public class DbtModel {

    private String name;
    private String path;
    private String layer;
    private String sql;

    @Builder.Default
    private List<String> refs = new ArrayList<>();

    @Builder.Default
    private List<String> sources = new ArrayList<>();

    private String materialization;
    private String description;
}
