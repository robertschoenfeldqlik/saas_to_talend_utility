package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Structured diff between two fixture captures. Drives the "did the API
 * change since last time?" check in the UI.
 *
 *   summary       — one-line human label, e.g. "+2 fields, 1 type change"
 *   fieldsAdded   — present in B, not in A
 *   fieldsRemoved — present in A, not in B
 *   typeChanges   — present in both but Talend type differs
 *   countA / countB — record count at recordsPath for each capture
 *   breaking      — true when any removal or type change happened
 *                   (added fields alone are non-breaking)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FixtureDiff {

    private String summary;

    @Builder.Default
    private List<FieldInfo> fieldsAdded = new ArrayList<>();

    @Builder.Default
    private List<FieldInfo> fieldsRemoved = new ArrayList<>();

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TypeChange {
        private String name;
        private String oldType;
        private String newType;
    }

    @Builder.Default
    private List<TypeChange> typeChanges = new ArrayList<>();

    private int countA;
    private int countB;

    private boolean breaking;
}
