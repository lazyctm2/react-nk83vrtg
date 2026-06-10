CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE siniestros (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  categoria TEXT NOT NULL,
  subtipo TEXT NOT NULL,
  descripcion TEXT,
  posicion GEOMETRY(POINT, 4326),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE siniestros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_siniestros" ON siniestros FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_siniestros" ON siniestros FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_siniestros" ON siniestros FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_siniestros" ON siniestros FOR DELETE
  TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE siniestros;
