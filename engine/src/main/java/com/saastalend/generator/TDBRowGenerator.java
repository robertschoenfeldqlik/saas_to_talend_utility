package com.saastalend.generator;

import com.saastalend.model.DbDialect;
import com.saastalend.model.DbtModel;
import com.saastalend.model.TalendElementParameter;
import com.saastalend.model.TalendNode;

import java.util.ArrayList;
import java.util.List;

/**
 * Generates a dialect-specific tXxxRow TalendNode (tPostgresqlRow, tMysqlRow, ...)
 * that executes a SQL statement without returning a rowset. Used for dbt model
 * conversion where each model maps to a single execute-only component.
 */
public final class TDBRowGenerator {

    private TDBRowGenerator() {
    }

    public static TalendNode generate(DbtModel model, DbDialect dialect, int posX, int posY) {
        String componentName = dialect != null
                ? dialect.getTalendRowComponent()
                : "tJDBCRow";

        String uniqueName = componentName + "_1";

        List<TalendElementParameter> params = new ArrayList<>();
        params.add(param("TEXT", "UNIQUE_NAME", uniqueName));
        params.add(param("TEXT", "HOST", "context.DB_HOST"));
        params.add(param("TEXT", "PORT", "context.DB_PORT"));
        params.add(param("TEXT", "DBNAME", "context.DB_NAME"));
        params.add(param("TEXT", "SCHEMA", "context.DB_SCHEMA"));
        params.add(param("TEXT", "USER", "context.DB_USERNAME"));
        params.add(param("TEXT", "PASS", "context.DB_PASSWORD"));

        String rawSql = model != null && model.getSql() != null ? model.getSql() : "";
        // Two-layer defense: strip invalid XML 1.0 control chars first,
        // then escape for the Java string literal that Talend evaluates at runtime.
        // (XML attribute escaping of &, <, >, " is handled by dom4j when writing
        // the value attribute, so we don't double-encode it here.)
        String safe = stripInvalidXmlChars(rawSql);
        String quoted = "\"" + escapeSqlForJava(safe) + "\"";
        params.add(param("MEMO", "QUERY", quoted));

        params.add(param("CHECK", "DIE_ON_ERROR", "false"));
        params.add(param("CHECK", "PROPAGATE_QUERY_RESULTSET", "false"));
        params.add(param("CHECK", "USE_EXISTING_CONNECTION", "false"));

        return TalendNode.builder()
                .xmiId(XmiIdGenerator.generate())
                .componentName(componentName)
                .componentVersion("0.102")
                .posX(posX)
                .posY(posY)
                .parameters(params)
                .metadata(new ArrayList<>())
                .build();
    }

    /**
     * Escapes a raw SQL string for embedding inside a Java string literal in the
     * generated .item XML: backslashes first, then quotes, then newlines -> \n literal.
     */
    private static String escapeSqlForJava(String sql) {
        if (sql == null) return "";
        return sql
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r\n", "\\n")
                .replace("\n", "\\n")
                .replace("\r", "\\n");
    }

    /**
     * Strips characters that are illegal in XML 1.0. Valid: tab, LF, CR, and
     * any code point in 0x20-0xD7FF / 0xE000-0xFFFD / 0x10000-0x10FFFF. Anything
     * else (NUL, control chars, surrogate halves) would corrupt the .item file
     * when dom4j writes the attribute and is silently dropped here.
     */
    public static String stripInvalidXmlChars(String s) {
        if (s == null || s.isEmpty()) return s == null ? "" : s;
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == 0x9 || c == 0xA || c == 0xD
                    || (c >= 0x20 && c <= 0xD7FF)
                    || (c >= 0xE000 && c <= 0xFFFD)) {
                sb.append(c);
            }
            // surrogate halves and other illegal chars are dropped
        }
        return sb.toString();
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
