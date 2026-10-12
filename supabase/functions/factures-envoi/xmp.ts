// Métadonnées XMP Factur-X, ajoutées au bloc XMP du PDF/A-3 par pdfkit (appendXML).
// PDF/A n'accepte une propriété XMP personnalisée que si son schéma est déclaré
// (pdfaExtension) : d'où les deux descriptions. Le niveau « EN 16931 » (avec l'espace)
// doit correspondre à l'identifiant du profil déclaré dans le XML (urn:cen.eu:en16931:2017).

const FX_NS = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#'

const property = (name: string, description: string) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`

export const FACTURX_XML_FILENAME = 'factur-x.xml'

export const FACTURX_XMP = `
        <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
          <pdfaExtension:schemas>
            <rdf:Bag>
              <rdf:li rdf:parseType="Resource">
                <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
                <pdfaSchema:namespaceURI>${FX_NS}</pdfaSchema:namespaceURI>
                <pdfaSchema:prefix>fx</pdfaSchema:prefix>
                <pdfaSchema:property>
                  <rdf:Seq>${property('DocumentFileName', 'name of the embedded XML invoice file')}${property('DocumentType', 'INVOICE')}${property('Version', 'The actual version of the Factur-X XML schema')}${property('ConformanceLevel', 'The conformance level of the embedded Factur-X data')}
                  </rdf:Seq>
                </pdfaSchema:property>
              </rdf:li>
            </rdf:Bag>
          </pdfaExtension:schemas>
        </rdf:Description>
        <rdf:Description rdf:about="" xmlns:fx="${FX_NS}">
          <fx:DocumentType>INVOICE</fx:DocumentType>
          <fx:DocumentFileName>${FACTURX_XML_FILENAME}</fx:DocumentFileName>
          <fx:Version>1.0</fx:Version>
          <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
        </rdf:Description>
        `
