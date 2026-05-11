package com.saastalend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.Configuration;
import com.jayway.jsonpath.JsonPath;
import com.jayway.jsonpath.Option;
import com.saastalend.model.FieldInfo;
import com.saastalend.model.FixtureDiff;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Diffs two fixture captures and produces a structured FixtureDiff.
 *
 * Compares the FIRST RECORD at recordsPath in each fixture — that's the
 * level the Talend job's tExtractJSONFields walks. Anything that changes
 * at that level (added field, removed field, type swap) is what would
 * break the downstream pipeline if the user re-imports the existing job.
 */
@Service
public class FixtureComparator {

    private final ObjectMapper mapper = new ObjectMapper();
    private final Configuration jsonPathConfig = Configuration.builder()
            .options(Option.SUPPRESS_EXCEPTIONS, Option.DEFAULT_PATH_LEAF_TO_NULL)
            .build();

    public FixtureDiff compare(String fixtureAPath, String fixtureBPath, String recordsPath) throws Exception {
        String bodyA = readFixture(fixtureAPath);
        String bodyB = readFixture(fixtureBPath);
        return compareBodies(bodyA, bodyB, recordsPath);
    }

    /** Convenience: caller hands the raw bodies, no disk read. Used by unit tests. */
    public FixtureDiff compareBodies(String bodyA, String bodyB, String recordsPath) {
        String path = (recordsPath == null || recordsPath.isBlank()) ? "$" : recordsPath;
        Snapshot a = parse(bodyA, path);
        Snapshot b = parse(bodyB, path);

        Map<String, FieldInfo> mapA = new LinkedHashMap<>();
        for (FieldInfo f : a.fields) mapA.put(f.getName(), f);
        Map<String, FieldInfo> mapB = new LinkedHashMap<>();
        for (FieldInfo f : b.fields) mapB.put(f.getName(), f);

        List<FieldInfo> added = new ArrayList<>();
        List<FieldInfo> removed = new ArrayList<>();
        List<FixtureDiff.TypeChange> typeChanges = new ArrayList<>();

        for (Map.Entry<String, FieldInfo> e : mapB.entrySet()) {
            FieldInfo prior = mapA.get(e.getKey());
            if (prior == null) {
                added.add(e.getValue());
            } else if (!nullSafeEquals(prior.getType(), e.getValue().getType())) {
                typeChanges.add(FixtureDiff.TypeChange.builder()
                        .name(e.getKey())
                        .oldType(prior.getType())
                        .newType(e.getValue().getType())
                        .build());
            }
        }
        for (Map.Entry<String, FieldInfo> e : mapA.entrySet()) {
            if (!mapB.containsKey(e.getKey())) {
                removed.add(e.getValue());
            }
        }

        boolean breaking = !removed.isEmpty() || !typeChanges.isEmpty();

        // Build a concise summary line. Order: removed > type-changed > added.
        StringBuilder s = new StringBuilder();
        if (!removed.isEmpty()) s.append("-").append(removed.size()).append(" fields");
        if (!typeChanges.isEmpty()) {
            if (s.length() > 0) s.append(", ");
            s.append(typeChanges.size()).append(" type change").append(typeChanges.size() == 1 ? "" : "s");
        }
        if (!added.isEmpty()) {
            if (s.length() > 0) s.append(", ");
            s.append("+").append(added.size()).append(" field").append(added.size() == 1 ? "" : "s");
        }
        if (a.recordCount != b.recordCount) {
            if (s.length() > 0) s.append(", ");
            s.append("record count ").append(a.recordCount).append("→").append(b.recordCount);
        }
        if (s.length() == 0) s.append("no changes");

        return FixtureDiff.builder()
                .summary(s.toString())
                .fieldsAdded(added)
                .fieldsRemoved(removed)
                .typeChanges(typeChanges)
                .countA(a.recordCount)
                .countB(b.recordCount)
                .breaking(breaking)
                .build();
    }

    private Snapshot parse(String body, String path) {
        Snapshot s = new Snapshot();
        try {
            Object resolved = JsonPath.using(jsonPathConfig).parse(body).read(path);
            JsonNode first = null;
            if (resolved instanceof List<?>) {
                List<?> list = (List<?>) resolved;
                s.recordCount = list.size();
                if (!list.isEmpty()) first = mapper.valueToTree(list.get(0));
            } else if (resolved != null) {
                s.recordCount = 1;
                first = mapper.valueToTree(resolved);
            }
            if (first != null && first.isObject()) {
                Iterator<String> names = first.fieldNames();
                while (names.hasNext()) {
                    String n = names.next();
                    s.fields.add(FieldInfo.builder().name(n).type(typeOf(first.get(n))).build());
                }
            }
        } catch (Exception ignored) {
            s.recordCount = -1;
        }
        return s;
    }

    private static String typeOf(JsonNode n) {
        if (n == null || n.isNull())  return "id_String";
        if (n.isTextual())            return "id_String";
        if (n.isBoolean())            return "id_Boolean";
        if (n.isInt() || n.isLong())  return "id_Long";
        if (n.isFloat() || n.isDouble() || n.isBigDecimal()) return "id_Double";
        return "id_String";
    }

    private static String readFixture(String path) throws Exception {
        return Files.readString(Path.of(path));
    }

    private static boolean nullSafeEquals(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    private static class Snapshot {
        int recordCount = -1;
        List<FieldInfo> fields = new ArrayList<>();
    }
}
