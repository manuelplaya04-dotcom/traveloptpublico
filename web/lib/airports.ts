// Coordenadas de los aeropuertos del catálogo (posición pública de cada terminal principal), para calcular el traslado
// real por calle desde el alojamiento.
export const AIRPORT_COORDS: Record<string, { lat: number; lon: number; name: string }> = {
  JFK: { lat: 40.6413, lon: -73.7781, name: "JFK" },
  LGA: { lat: 40.7769, lon: -73.874, name: "LaGuardia" },
  EWR: { lat: 40.6895, lon: -74.1745, name: "Newark" },
  MCO: { lat: 28.4312, lon: -81.3081, name: "Orlando (MCO)" },
  MIA: { lat: 25.7959, lon: -80.287, name: "Miami (MIA)" },
  PHL: { lat: 39.8744, lon: -75.2424, name: "Filadelfia (PHL)" },
  BOS: { lat: 42.3656, lon: -71.0096, name: "Boston Logan" },
  IAD: { lat: 38.9531, lon: -77.4565, name: "Dulles (IAD)" },
  DCA: { lat: 38.8512, lon: -77.0402, name: "Reagan (DCA)" },
};
