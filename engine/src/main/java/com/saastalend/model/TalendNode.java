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
public class TalendNode {

    private String xmiId;
    private String componentName;
    private String componentVersion;
    private int posX;
    private int posY;

    @Builder.Default
    private List<TalendElementParameter> parameters = new ArrayList<>();

    @Builder.Default
    private List<TalendMetadata> metadata = new ArrayList<>();
}
