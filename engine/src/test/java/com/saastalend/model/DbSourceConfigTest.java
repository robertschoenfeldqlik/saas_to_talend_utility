package com.saastalend.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Locks in the JDBC connection-string injection fix: validate() must reject any
 * value that could inject extra JDBC connection properties (socketFactory,
 * allowLoadLocalInfile, …) or break out of the URL structure.
 */
class DbSourceConfigTest {

    private DbSourceConfig cfg(String host, String database) {
        DbSourceConfig c = new DbSourceConfig();
        c.setDialect("postgresql");
        c.setHost(host);
        c.setDatabase(database);
        return c;
    }

    @Test
    void acceptsNormalValues() {
        assertDoesNotThrow(() -> cfg("db.internal.example.com", "analytics").validate());
        DbSourceConfig ip = cfg("10.0.0.5", "app");
        ip.setPort("5432");
        ip.setSchema("public");
        assertDoesNotThrow(ip::validate);
    }

    @Test
    void rejectsPgjdbcPropertyInjection() {
        // The pgjdbc socketFactory RCE class injects via a '?' query param.
        assertThrows(IllegalArgumentException.class,
                () -> cfg("localhost", "app?socketFactory=evil&socketFactoryArg=x").validate());
    }

    @Test
    void rejectsAmpersandAndSemicolon() {
        assertThrows(IllegalArgumentException.class,
                () -> cfg("localhost", "app&allowLoadLocalInfile=true").validate());
        assertThrows(IllegalArgumentException.class,
                () -> cfg("localhost", "app;encrypt=false").validate());
    }

    @Test
    void rejectsBadHostAndPort() {
        assertThrows(IllegalArgumentException.class, () -> cfg("evil/../x", "app").validate());
        DbSourceConfig p = cfg("localhost", "app");
        p.setPort("5432; DROP");
        assertThrows(IllegalArgumentException.class, p::validate);
    }
}
