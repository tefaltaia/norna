const SMART_DATA_MODELS_CTX = "https://smart-data-models.github.io/dataModel.Agrifood/context.jsonld";

export async function buildFiwarePayloads({ runId, location, sowingDate, phenologyJson, genomeSummary }) {
  const parcelId = `urn:ngsi-ld:AgriParcel:${runId}`;
  const cropId = `urn:ngsi-ld:AgriCrop:${runId}`;
  const entities = [];

  entities.push({
    "@context": SMART_DATA_MODELS_CTX,
    "id": parcelId,
    "type": "AgriParcel",
    "location": {
      "type": "GeoProperty",
      "value": { "type": "Point", "coordinates": [location.lon, location.lat] }
    },
    "area": { "type": "Property", "value": 100, "unitCode": "MTK" },
    "hasAgriCrop": { "type": "Relationship", "object": cropId },
    "name": { "type": "Property", "value": location.label }
  });

  entities.push({
    "@context": SMART_DATA_MODELS_CTX,
    "id": cropId,
    "type": "AgriCrop",
    "name": { "type": "Property", "value": phenologyJson.cultivar_descripcion },
    "alternateName": { "type": "Property", "value": "Solanum lycopersicum" },
    "plantingFrom": {
      "type": "Property",
      "value": [{ "@type": "DateTime", "@value": sowingDate }]
    },
    "wateringFrequency": { "type": "Property", "value": "weekly" },
    "agroVocConcept": { "type": "Property", "value": "http://aims.fao.org/aos/agrovoc/c_7715" },
    "genomeVariants": {
      "type": "Property",
      "value": genomeSummary.keyVariants.map(v => ({ qtl: v.qtl_match, trait: v.trait, effect: v.effect }))
    }
  });

  for (const week of phenologyJson.weeks) {
    entities.push({
      "@context": [
        SMART_DATA_MODELS_CTX,
        { "DigitalTwinSimulation": "https://lavegainnova.es/schemas/DigitalTwinSimulation" }
      ],
      "id": `urn:ngsi-ld:DigitalTwinSimulation:${runId}:w${week.week}`,
      "type": "DigitalTwinSimulation",
      "refAgriCrop": { "type": "Relationship", "object": cropId },
      "weekNumber": { "type": "Property", "value": week.week },
      "bbchStage": { "type": "Property", "value": week.bbch_stage },
      "estimatedHeight": { "type": "Property", "value": week.estimated_height_cm, "unitCode": "CMT" },
      "biologicalSummary": { "type": "Property", "value": week.biological_summary },
      "modelAsset": { "type": "Property", "value": `/api/runs/${runId}/glb/${week.week}` },
      "imageAsset": { "type": "Property", "value": `/api/runs/${runId}/image/${week.week}` }
    });
  }

  return entities;
}
