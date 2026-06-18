package com.saastalend.generator;

import com.saastalend.model.DiscoveredEndpoint;
import com.saastalend.model.TalendElementParameter;
import com.saastalend.model.TalendMetadata;
import com.saastalend.model.TalendMetadataColumn;
import com.saastalend.model.TalendNode;

import java.util.List;

public final class TFileOutputJSONGenerator {

    private TFileOutputJSONGenerator() {
    }

    /**
     * Generates a tFileOutputJSON TalendNode carrying the SAME FLOW schema as the
     * upstream components, so the records actually written match the extracted
     * fields (and Talend doesn't flag a schema mismatch on import).
     */
    /** Overload for callers without a discovered endpoint (e.g. the DB path). */
    public static TalendNode generate(String outputPath, int posX, int posY) {
        return generate(null, outputPath, posX, posY);
    }

    public static TalendNode generate(DiscoveredEndpoint endpoint, String outputPath, int posX, int posY) {
        List<TalendElementParameter> params = new java.util.ArrayList<>();

        params.add(param("TEXT", "UNIQUE_NAME", "tFileOutputJSON_1"));
        params.add(param("TEXT", "FILENAME", outputPath != null ? outputPath : "\"output.json\""));
        params.add(param("ENCODING_TYPE", "ENCODING", "\"UTF-8\""));
        params.add(param("CHECK", "CREATE_DIR", "true"));
        params.add(param("CHECK", "APPEND_FILE", "false"));

        // Same schema as the extract output — the file gets the real fields.
        List<TalendMetadataColumn> columns = TExtractJSONFieldsGenerator.buildColumns(endpoint);

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
