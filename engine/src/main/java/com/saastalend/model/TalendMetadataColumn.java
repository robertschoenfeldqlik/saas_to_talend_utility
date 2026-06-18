package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TalendMetadataColumn {

    private String name;
    private String talendType;

    @Builder.Default
    private boolean key = false;

    @Builder.Default
    private boolean nullable = true;

    @Builder.Default
    private int length = 0;

    @Builder.Default
    private int precision = 0;

    private String comment;

    /** Date/time format pattern (Talend SimpleDateFormat literal, e.g. "yyyy-MM-dd").
     *  Required by Talend for id_Date columns — without it Studio flags the schema. */
    private String pattern;
}
