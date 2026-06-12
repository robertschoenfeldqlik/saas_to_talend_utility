const test = require('node:test');
const assert = require('node:assert');
const { isEdmx, odataVersion, parseEdmxToConfig } = require('./odataMetadata');

const EDMX_V4 = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
 <edmx:DataServices>
  <Schema Namespace="LMS" xmlns="http://docs.oasis-open.org/odata/ns/edm">
   <EntityType Name="Student">
     <Key><PropertyRef Name="studentId"/></Key>
     <Property Name="studentId" Type="Edm.String"/>
     <Property Name="name" Type="Edm.String"/>
   </EntityType>
   <EntityType Name="Curriculum">
     <Key><PropertyRef Name="curriculumId"/></Key>
     <Property Name="curriculumId" Type="Edm.String"/>
   </EntityType>
   <EntityContainer Name="Container">
     <EntitySet Name="Students" EntityType="LMS.Student"/>
     <EntitySet Name="Curricula" EntityType="LMS.Curriculum"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`;

const EDMX_V2 = `<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
 <edmx:DataServices>
  <Schema Namespace="SF">
   <EntityType Name="LearningHistory"><Key><PropertyRef Name="id"/></Key><Property Name="id" Type="Edm.String"/></EntityType>
   <EntityContainer Name="C"><EntitySet Name="learninghistorys" EntityType="SF.LearningHistory"/></EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`;

test('isEdmx detects EDMX, rejects OpenAPI/HTML', () => {
  assert.equal(isEdmx(EDMX_V4), true);
  assert.equal(isEdmx(EDMX_V2), true);
  assert.equal(isEdmx('{"openapi":"3.0.0","paths":{}}'), false);
  assert.equal(isEdmx('<html><body>SAP Help Portal</body></html>'), false);
});

test('odataVersion distinguishes v4 and v2', () => {
  assert.equal(odataVersion(EDMX_V4), 4);
  assert.equal(odataVersion(EDMX_V2), 2);
});

test('parseEdmxToConfig extracts every EntitySet with keys + v4 records_path', () => {
  const cfg = parseEdmxToConfig(EDMX_V4, 'https://x.lms.example/learning/odatav4');
  assert.equal(cfg.streams.length, 2);
  const students = cfg.streams.find((s) => s.path === '/Students');
  assert.ok(students, 'Students entity set present');
  assert.deepStrictEqual(students.primary_keys, ['studentId']);
  assert.equal(students.records_path, '$.value');
  assert.equal(students.pagination_style, 'odata');
  assert.equal(students.name, 'students');
  assert.equal(cfg.api_url, 'https://x.lms.example/learning/odatav4');
});

test('parseEdmxToConfig uses v2 records_path and resolves keys', () => {
  const cfg = parseEdmxToConfig(EDMX_V2);
  assert.equal(cfg.streams.length, 1);
  assert.equal(cfg.streams[0].records_path, '$.d.results');
  assert.equal(cfg.streams[0].name, 'learninghistorys');
  assert.deepStrictEqual(cfg.streams[0].primary_keys, ['id']);
});
