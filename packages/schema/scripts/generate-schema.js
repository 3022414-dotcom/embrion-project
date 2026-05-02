import { zodToJsonSchema } from "zod-to-json-schema";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import from built dist to avoid TypeScript compilation at script time
const { EmbryoSchema } = await import("../dist/index.js");

const jsonSchema = zodToJsonSchema(EmbryoSchema, {
  name: "Embryo",
  $refStrategy: "none",
  definitionPath: "$defs",
});

const output = {
  $schema: "https://json-schema.org/draft/2020-12",
  ...jsonSchema,
  title: "Embryo",
  description: "Full embryo record schema — v1.0.0",
  version: "1.0.0",
};

const outPath = join(__dirname, "../../../specs/001-embryo-data-model/contracts/embryo.schema.generated.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log("Generated:", outPath);
