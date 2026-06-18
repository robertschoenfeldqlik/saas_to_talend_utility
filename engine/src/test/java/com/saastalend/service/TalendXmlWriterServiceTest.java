package com.saastalend.service;

import com.saastalend.generator.TFileOutputJSONGenerator;
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
        TalendNode out = TFileOutputJSONGenerator.generate("\"output.json\"", 100, 100);
        TalendJob job = TalendJob.builder().name("Test").nodes(List.of(out)).build();

        String xml = new TalendXmlWriterService().writeItemXml(job);

        assertTrue(xml.matches("(?s).*<column\\b[^>]*\\btype=\"id_String\"[^>]*/?>.*"),
                "schema column must carry the Talend 'type' attribute");
        assertFalse(xml.contains("talendType="),
                "must not emit 'talendType' — Talend reads 'type', so that left it null on import");
    }
}
