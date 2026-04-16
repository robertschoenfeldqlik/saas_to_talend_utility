package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TalendElementParameter {

    public enum FieldType {
        TEXT,
        CHECK,
        CLOSED_LIST,
        TABLE,
        MEMO,
        ENCODING_TYPE,
        SCHEMA_TYPE,
        LABEL,
        HIDDEN_TEXT,
        COMPONENT_LIST,
        RADIO
    }

    private FieldType field;
    private String name;
    private String value;

    @Builder.Default
    private boolean show = true;
}
