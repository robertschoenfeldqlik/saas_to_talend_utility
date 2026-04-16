package com.saastalend.generator;

import com.saastalend.model.*;

import java.util.ArrayList;
import java.util.List;

public final class TMapGenerator {

    private TMapGenerator() {
    }

    /**
     * Generates a tMap TalendNode for field mapping between input and output schemas.
     */
    public static TalendNode generate(List<FieldMapping> mappings, int posX, int posY) {
        List<TalendElementParameter> params = new ArrayList<>();

        params.add(param("TEXT", "UNIQUE_NAME", "tMap_1"));
        params.add(param("CHECK", "LKUP_PARALLELIZE", "false"));
        params.add(param("CHECK", "MAP_FLAG_AUTO_PROPAGATE", "true"));

        // Build mapping table representation
        if (mappings != null && !mappings.isEmpty()) {
            StringBuilder mappingTable = new StringBuilder("[");
            for (int i = 0; i < mappings.size(); i++) {
                FieldMapping mapping = mappings.get(i);
                if (i > 0) {
                    mappingTable.append(",");
                }
                mappingTable.append("{\"source\":\"")
                        .append(mapping.getSourceField())
                        .append("\",\"target\":\"")
                        .append(mapping.getTargetField())
                        .append("\",\"type\":\"")
                        .append(mapping.getTargetType() != null ? mapping.getTargetType() : "id_String")
                        .append("\"}");
            }
            mappingTable.append("]");
            params.add(param("TABLE", "MAP_TABLE", mappingTable.toString()));
        }

        // Generate input and output metadata
        List<TalendMetadata> metadataList = new ArrayList<>();

        // Input metadata
        List<TalendMetadataColumn> inputColumns = new ArrayList<>();
        if (mappings != null) {
            for (FieldMapping mapping : mappings) {
                inputColumns.add(TalendMetadataColumn.builder()
                        .name(sanitizeColumnName(mapping.getSourceField()))
                        .talendType("id_String")
                        .nullable(true)
                        .build());
            }
        }
        metadataList.add(TalendMetadata.builder()
                .name("row1")
                .connectorName("FLOW")
                .columns(inputColumns)
                .build());

        // Output metadata
        List<TalendMetadataColumn> outputColumns = new ArrayList<>();
        if (mappings != null) {
            for (FieldMapping mapping : mappings) {
                outputColumns.add(TalendMetadataColumn.builder()
                        .name(sanitizeColumnName(mapping.getTargetField()))
                        .talendType(mapping.getTargetType() != null ? mapping.getTargetType() : "id_String")
                        .nullable(true)
                        .build());
            }
        }
        metadataList.add(TalendMetadata.builder()
                .name("out1")
                .connectorName("FLOW")
                .columns(outputColumns)
                .build());

        return TalendNode.builder()
                .xmiId(XmiIdGenerator.generate())
                .componentName("tMap")
                .componentVersion("0.102")
                .posX(posX)
                .posY(posY)
                .parameters(params)
                .metadata(metadataList)
                .build();
    }

    private static String sanitizeColumnName(String name) {
        if (name == null || name.isEmpty()) {
            return "column";
        }
        return name.replaceAll("[^a-zA-Z0-9_]", "_");
    }

    private static TalendElementParameter param(String field, String name, String value) {
        return TalendElementParameter.builder()
                .field(TalendElementParameter.FieldType.valueOf(field))
                .name(name)
                .value(value)
                .show(true)
                .build();
    }
}
