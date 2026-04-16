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
public class DbtConversionRequest {

    private String projectName;
    private String targetDialect;
    private DbSourceConfig targetConfig;

    @Builder.Default
    private List<DbtModel> models = new ArrayList<>();
}
