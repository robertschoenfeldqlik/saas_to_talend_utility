package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TalendConnection {

    private String xmiId;
    private String connectorName;
    private String source;
    private String target;
    private String label;

    @Builder.Default
    private int lineStyle = 0;
}
