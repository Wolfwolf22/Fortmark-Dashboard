-- Optional private client context and explicit descriptions of Other needs.
-- Defaults preserve existing contacts; nullable need descriptions preserve legacy Other rows.
ALTER TABLE contacts
  ADD COLUMN about text NOT NULL DEFAULT '',
  ADD COLUMN personal_details jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE contacts
  ADD CONSTRAINT contacts_about_check CHECK (char_length(about) <= 2000),
  ADD CONSTRAINT contacts_personal_details_check CHECK (
    CASE WHEN jsonb_typeof(personal_details) = 'array'
      THEN jsonb_array_length(personal_details) <= 20 AND octet_length(personal_details::text) <= 50000
      ELSE false END
  );
--> statement-breakpoint
ALTER TABLE contact_needs
  ADD COLUMN kind_other text,
  ADD COLUMN property_type_other text,
  ADD COLUMN financing_other text;
--> statement-breakpoint
ALTER TABLE contact_needs
  ADD CONSTRAINT contact_needs_kind_other_check CHECK (
    kind_other IS NULL OR (kind = 'other' AND char_length(btrim(kind_other)) BETWEEN 1 AND 200)
  ),
  ADD CONSTRAINT contact_needs_property_type_other_check CHECK (
    property_type_other IS NULL OR ('other' = ANY(property_types) AND char_length(btrim(property_type_other)) BETWEEN 1 AND 200)
  ),
  ADD CONSTRAINT contact_needs_financing_other_check CHECK (
    financing_other IS NULL OR (financing IS NOT NULL AND financing = 'other' AND char_length(btrim(financing_other)) BETWEEN 1 AND 200)
  );
