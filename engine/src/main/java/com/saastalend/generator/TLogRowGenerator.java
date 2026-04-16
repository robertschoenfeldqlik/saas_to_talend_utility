package com.saastalend.generator;

import com.saastalend.model.TalendElementParameter;
import com.saastalend.model.TalendMetadata;
import com.saastalend.model.TalendMetadataColumn;
import com.saastalend.model.TalendNode;

import java.util.ArrayList;
import java.util.List;

public final class TLogRowGenerator {

    private TLogRowGenerator() {
    }

    /**
     * Generates a simple tLogRow TalendNode for logging row data to the console.
     */
    public static TalendNode generate(int posX, int posY) {
        List<TalendElementParameter> params = new ArrayList<>();

        params.add(param("TEXT", "UNIQUE_NAME", "tLogRow_1"));
        params.add(param("CHECK", "BASIC_MODE", "true"));
        params.add(param("TEXT", "FIELD_SEPARATOR", "\"|\""));
        params.add(param("CHECK", "PRINT_HEADER", "true"));
        params.add(param("CHECK", "PRINT_UNIQUE_NAME", "false"));
        params.add(param("CHECK", "PRINT_COLNAMES", "true"));

        // Metadata with generic schema
        List<TalendMetadataColumn> columns = new ArrayList<>();
        columns.add(TalendMetadataColumn.builder()
                .name("record")
                .talendType("id_String")
                .nullable(true)
                .build());

        TalendMetadata metadata = TalendMetadata.builder()
                .name("tLogRow_1")
                .connectorName("FLOW")
                .columns(columns)
                .build();

        return TalendNode.builder()
                .xmiId(XmiIdGenerator.generate())
                .componentName("tLogRow")
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
