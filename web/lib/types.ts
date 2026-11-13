// Forma de search_runs e itineraries.payload (ver engine/app/optimizer/service.py::itinerary_to_dict).
export type RunStatus = "queued" | "extracting" | "optimizing" | "done" | "infeasible" | "failed";

export type Run = {
  id: string;
  status: RunStatus;
  summary: {
    query_plan?: Record<string, number>;
    result_status?: "ok" | "over_budget" | "infeasible";
    best_total_minor?: number | null;
    budget_gap_minor?: number;
    diagnostics?: {
      rejections: Record<string, string[]>;
      infeasible_skeletons: Record<string, string>;
      warnings: string[];
    };
    stats?: Record<string, unknown>;
    // datos no críticos que no se pudieron traer, o precios históricos / búsquedas parciales de vuelos y alojamiento
    degraded?: Partial<Record<"weather" | "activities" | "flights" | "lodging" | "transport", string>>;
    quota_narrowed?: string[]; // recortes del plan para cuidar la cuota de precios en vivo (flex, overnight, rentals)
  };
  error: { code: string; message?: string; node?: string } | null;
  timings: Record<string, string>;
};

export type BreakdownLine = {
  category: "vuelos" | "alojamiento" | "actividades" | "transporte";
  description: string;
  quantity: number;
  unit_minor: number;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  ref: string;
  deeplink: string | null;
};

// Modelo canónico FlightOffer (engine/app/domain/models.py). Fechas locales sin zona: "YYYY-MM-DDTHH:MM[:SS]".
export type FlightOffer = {
  id: string;
  provider: string;
  origin: string;
  destination: string;
  depart_at: string;
  arrive_at: string;
  depart_utc?: string | null; // instantes reales; ausentes si falta la zona de un aeropuerto o es dato de prueba
  arrive_utc?: string | null;
  duration_min?: number | null; // duración real (en UTC)
  stops: number;
  carrier: string;
  price_per_pax_minor: number;
  included_bags: number;
  bag_fee_minor: number;
  bag_fee_known?: boolean; // false: sin tarifa publicada (internacional, 3+ valijas): no sumada al total
  seats_available: number;
  deeplink: string | null;
  fetched_at?: string | null; // UTC: cuándo se cotizó en el proveedor real (ausente en datos de prueba)
};

export type LodgingUnit = {
  unit_type: string; qty: number; capacity: number; bedrooms: number; bathrooms: number; bathrooms_source: string;
  available: number;
};

// engine/app/optimizer/lodging.py::lodging_options: mejor combinación de unidades por propiedad, o motivo de descarte.
export type LodgingOption = {
  offer_id: string;
  provider: string;
  name: string;
  stars?: number | null; // categoría, si el proveedor la informa
  rating?: number | null; // puntuación de huéspedes 0 a 10, si el proveedor la informa
  lat?: number | null;
  lon?: number | null;
  amenities?: string[]; // comodidades tal como las informa el proveedor
  kitchen?: boolean | null; // true = informa cocina · false = el alquiler no la tiene · null = no se sabe
  photo_url?: string | null; // miniatura del proveedor; se muestra por /api/photo
  deeplink: string | null;
  fetched_at?: string | null; // UTC: cuándo se cotizó en el proveedor real
  rejection: string | null;
  cost_minor: number | null;
  units: LodgingUnit[];
};

// Modelo canónico ActivityOffer: una actividad en una fecha (engine/app/domain/models.py).
export type ActivityOfferRow = {
  id: string; provider: string; city: string; activity_key: string; name: string; date: string;
  price_per_pax_minor: number; outdoor: boolean; slots: 1 | 2; deeplink: string | null;
  lat?: number | null; lon?: number | null;
  price_source?: "provider" | "curated" | "box_office"; // ver lib/activityPrice.ts
  price_date_based?: boolean;
};

export type WeatherDay = { city: string; date: string; tmax_c: number; heavy_rain_prob: number; source: string };

export type TransportQuote = {
  id: string; provider: string; city: string; mode: "car_rental" | "transfers";
  per_day_minor: number; per_trip_minor: number; trips: number; fixed_minor: number; tax_bps: number;
  deeplink: string | null;
};

export type ItineraryPayload = {
  flights: { leg: number; offer: FlightOffer; cost_minor: number }[];
  rank: number;
  skeleton_id: string;
  order: string[];
  first_checkin: string;
  nights: Record<string, number>;
  total_minor: number;
  within_budget: boolean;
  currency: string;
  stays: {
    city: string;
    check_in: string;
    check_out: string;
    nights: number;
    lodging: { // null: alojamiento no cotizado (la persona ya tiene el suyo)
      offer_id: string;
      name: string;
      lat?: number | null; // ubicación, si el proveedor la informa
      lon?: number | null;
      deeplink: string | null;
      cost_minor: number;
      units: { unit_type: string; qty: number; bathrooms: number; bathrooms_source: string; capacity: number }[];
    } | null;
    activities: {
      date: string; name: string; outdoor: boolean; cost_minor: number; deeplink: string | null;
      price_source?: "provider" | "curated" | "box_office"; price_date_based?: boolean;
      lat?: number | null; lon?: number | null;
      weather_verified?: boolean; // false: al aire libre y sin clima para ese día (proveedor caído)
    }[];
    transport_cost_minor: number;
    lodging_options?: LodgingOption[]; // alternativas calculadas por el motor (4b.3)
  }[];
  breakdown: {
    lines: BreakdownLine[];
    by_category: Record<string, number>;
    total_minor: number;
    per_pax_minor: number[];
  };
};

export type ItineraryRow = { rank: number; total_minor: number; within_budget: boolean; payload: ItineraryPayload };
