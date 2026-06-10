CREATE TABLE historial_avisos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo_siniestro TEXT NOT NULL,
  ubicacion TEXT NOT NULL,
  hora TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE historial_avisos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_historial_avisos" ON historial_avisos FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_historial_avisos" ON historial_avisos FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_historial_avisos" ON historial_avisos FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_historial_avisos" ON historial_avisos FOR DELETE
  TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE historial_avisos;
