package com.saastalend.service;

import com.saastalend.generator.TExtractJSONFieldsGenerator;
import com.saastalend.generator.TFileOutputJSONGenerator;
import com.saastalend.model.DiscoveredEndpoint;
import com.saastalend.model.FieldInfo;
import com.saastalend.model.TalendJob;
import com.saastalend.model.TalendNode;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Regression: schema columns must be written with the "type" attribute Talend
 * Studio reads on import. The writer previously emitted "talendType", leaving
 * the real "type" null, which NPE'd on import:
 *   "Cannot invoke String.equals(Object) because typevalue is null".
 */
class TalendXmlWriterServiceTest {

    @Test
    void schemaColumnCarriesTypeAttribute() {
        DiscoveredEndpoint ep = DiscoveredEndpoint.builder()
                .responseFields(List.of(FieldInfo.builder().name("id").type("id_String").build()))
                .build();
        TalendNode out = TFileOutputJSONGenerator.generate(ep, "\"output.json\"", 100, 100);
        TalendJob job = TalendJob.builder().name("Test").nodes(List.of(out)).build();

        String xml = new TalendXmlWriterService().writeItemXml(job);

        assertTrue(xml.matches("(?s).*<column\\b[^>]*\\btype=\"id_String\"[^>]*/?>.*"),
                "schema column must carry the Talend 'type' attribute");
        assertFalse(xml.contains("talendType="),
                "must not emit 'talendType' — Talend reads 'type', so that left it null on import");
    }

    @Test
    void dateColumnCarriesADatePattern() {
        DiscoveredEndpoint ep = DiscoveredEndpoint.builder()
                .responseFields(List.of(
                        FieldInfo.builder().name("date").type("id_Date").build(),
                        FieldInfo.builder().name("base").type("id_String").build()))
                .build();
        TalendNode extract = TExtractJSONFieldsGenerator.generate(ep, 100, 100);
        TalendJob job = TalendJob.builder().name("Test").nodes(List.of(extract)).build();

        String xml = new TalendXmlWriterService().writeItemXml(job);

        // id_Date column must carry a pattern (Talend can't parse a date without one)
        assertTrue(xml.matches("(?s).*name=\"date\"[^>]*type=\"id_Date\"[^>]*pattern=\"[^\"]+\".*"),
                "id_Date column must carry a date pattern");
    }
}
