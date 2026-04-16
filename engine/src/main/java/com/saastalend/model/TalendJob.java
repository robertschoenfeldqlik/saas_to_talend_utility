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
public class TalendJob {

    private String id;
    private String name;
    private String description;

    @Builder.Default
    private List<TalendNode> nodes = new ArrayList<>();

    @Builder.Default
    private List<TalendConnection> connections = new ArrayList<>();

    private DiscoveredEndpoint endpoint;
    private AuthConfig authConfig;
    private String outputType;

    @Builder.Default
    private String status = "GENERATED";
}
