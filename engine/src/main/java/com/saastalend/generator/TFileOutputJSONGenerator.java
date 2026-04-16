package com.saastalend.generator;

import com.saastalend.model.TalendElementParameter;
import com.saastalend.model.TalendMetadata;
import com.saastalend.model.TalendMetadataColumn;
import com.saastalend.model.TalendNode;

import java.util.ArrayList;
import java.util.List;

public final class TFileOutputJSONGenerator {

    private TFileOutputJSONGenerator() {
    }

    /**
     * Generates a tFileOutputJSON TalendNode for writing output to a JSON file.
     */
    public static TalendNode generate(String outputPath, int posX, int posY) {
        List<TalendElementParameter> params = new ArrayList<>();

        params.add(param("TEXT", "UNIQUE_NAME", "tFileOutputJSON_1"));
        params.add(param("TEXT", "FILENAME", outputPath != null ? outputPath : "\"output.json\""));
        params.add(param("ENCODING_TYPE", "ENCODING", "\"UTF-8\""));
        params.add(param("CHECK", "CREATE_DIR", "true"));
        params.add(param("CHECK", "APPEND_FILE", "false"));

        // Metadata with a generic schema (will be overridden by connection flow)
        List<TalendMetadataColumn> columns = new ArrayList<>();
        columns.add(TalendMetadataColumn.builder()
                .name("record")
                .talendType("id_String")
                .nullable(true)
                .build());

        TalendMetadata metadata = TalendMetadata.builder()
                .name("tFileOutputJSON_1")
                .connectorName("FLOW")
                .columns(columns)
                .build();

        return TalendNode.builder()
                .xmiId(XmiIdGenerator.generate())
                .componentName("tFileOutputJSON")
                .componentVersion("0.102")
                .posX(posX)
                .posY(posY)
                .parameters(params)
                .metadata(List.of(metadata))
                .build();
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
