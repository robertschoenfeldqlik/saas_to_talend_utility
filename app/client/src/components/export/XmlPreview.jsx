export default function XmlPreview({ projectName, jobName }) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<talendfile:ProcessType
    xmi:version="2.0"
    xmlns:xmi="http://www.omg.org/XMI"
    xmlns:talendfile="platform:/resource/org.talend.model/model/TalendFile.xsd"
    defaultContext="Default">
  <context confirmationNeeded="false" name="Default">
    <contextParameter
        comment="API Base URL"
        name="API_BASE_URL"
        prompt="API Base URL?"
        type="id_String"
        value="https://api.example.com"/>
    <contextParameter
        comment="Auth Token"
        name="AUTH_TOKEN"
        prompt="Auth Token?"
        type="id_String"
        value=""/>
  </context>
  <node componentName="HTTPClient"
        componentVersion="5"
        offsetLabelX="0" offsetLabelY="0"
        posX="128" posY="160">
    <elementParameter field="TECHNICAL" name="TACOKIT_COMPONENT_ID"
        value="aHR0cC1zdHVkaW8jSFRUUCNDbGllbnQ"/>
    <elementParameter field="TEXT" name="configuration.dataset.datastore.base"
        value="context.API_BASE_URL"/>
    <elementParameter field="CLOSED_LIST" name="configuration.dataset.datastore.authentication.type"
        value="Bearer"/>
    <elementParameter field="TACOKIT_VALUE_SELECTION" name="configuration.dataset.methodType"
        value="GET"/>
    <elementParameter field="TEXT" name="configuration.dataset.resource"
        value="&quot;/endpoint&quot;"/>
  </node>
  <node componentName="tExtractJSONFields"
        componentVersion="0.102"
        offsetLabelX="0" offsetLabelY="0"
        posX="384" posY="160">
    <elementParameter field="TEXT" name="JSON_LOOP_QUERY"
        value="&quot;$.data[*]&quot;"/>
  </node>
  <node componentName="tFileOutputJSON"
        componentVersion="0.102"
        offsetLabelX="0" offsetLabelY="0"
        posX="640" posY="160">
    <elementParameter field="TEXT" name="FILE_PATH"
        value="&quot;context.OUTPUT_DIR + &quot;/${jobName}.json&quot;&quot;"/>
    <elementParameter field="CLOSED_LIST" name="ENCODING"
        value="UTF-8"/>
  </node>
  <connection connectorName="FLOW" label="row1"
      lineStyle="0" metaname="${jobName}_metadata"
      offsetLabelX="0" offsetLabelY="0"
      source="tHTTPClient_1" target="tExtractJSONFields_1"/>
  <connection connectorName="FLOW" label="row3"
      lineStyle="0" metaname="${jobName}_metadata"
      offsetLabelX="0" offsetLabelY="0"
      source="tExtractJSONFields_1" target="tFileOutputJSON_1"/>
</talendfile:ProcessType>`;

  // Basic syntax highlighting for XML
  const highlighted = xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((line, i) => {
      let html = line
        // Tag names
        .replace(/(<\/?)([\w:]+)/g, '<span style="color:#3B82F6">$1$2</span>')
        // Attribute names
        .replace(/\s([\w:]+)=/g, ' <span style="color:#22C55E">$1</span>=')
        // Attribute values
        .replace(/"([^"]*)"/g, '<span style="color:#F59E0B">"$1"</span>')
        // XML declaration
        .replace(/(<\?.*?\?>)/g, '<span style="color:#8B5CF6">$1</span>');
      return html;
    })
    .join('\n');

  return (
    <div
      className="rounded-xl overflow-hidden border"
      style={{ borderColor: 'rgb(var(--color-border))' }}
    >
      <div
        className="px-4 py-2 text-xs font-medium border-b flex items-center justify-between"
        style={{
          background: 'rgb(var(--color-surface-alt))',
          borderColor: 'rgb(var(--color-border))',
          color: 'rgb(var(--color-text-secondary))',
        }}
      >
        <span>{jobName}.item</span>
        <span>XML</span>
      </div>
      <pre
        className="p-4 overflow-x-auto text-xs leading-5 font-mono"
        style={{
          background: 'rgb(var(--color-surface))',
          color: 'rgb(var(--color-text))',
          maxHeight: '400px',
        }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  );
}
