package com.saastalend.generator;

import java.util.UUID;

public final class XmiIdGenerator {

    private XmiIdGenerator() {
    }

    /**
     * Generates an XMI-style ID: underscore followed by 24 hex characters derived from a UUID.
     */
    public static String generate() {
        String uuid = UUID.randomUUID().toString().replace("-", "");
        return "_" + uuid.substring(0, 24);
    }
}
