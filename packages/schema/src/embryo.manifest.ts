export const CURRENT_SCHEMA_VERSION = "1.0.0";

export type SchemaChangelogEntry = {
  version: string;
  date: string;
  changes: string[];
};

export type SchemaManifest = {
  current_version: string;
  changelog: SchemaChangelogEntry[];
};

export const SCHEMA_MANIFEST: SchemaManifest = {
  current_version: CURRENT_SCHEMA_VERSION,
  changelog: [
    {
      version: "1.0.0",
      date: "2026-05-01",
      changes: ["Initial schema ratification"],
    },
  ],
};
