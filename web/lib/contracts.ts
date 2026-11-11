// Espejo en zod del contrato canónico (engine/app/domain/models.py). Validación de UX:
// la validación autoritativa la hace Pydantic en el motor. test/contracts.test.ts verifica que no diverjan.
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD");
const iata = z.string().regex(/^[A-Z]{3}$/, "Código IATA de 3 letras");

export const constraintsSchema = z.object({
  min_bathrooms: z.number().int().min(0).max(10),
  min_bedrooms: z.number().int().min(0).max(10),
  max_stops: z.number().int().min(0).max(3),
  earliest_departure_hour: z.number().int().min(0).max(23),
  latest_arrival_hour: z.number().int().min(0).max(23),
  checked_bags_per_pax: z.number().int().min(0).max(3),
  allow_overnight_outbound: z.boolean(),
  max_heavy_rain_prob: z.number().min(0).max(1),
  max_tmax_c: z.number().min(0).max(60),
  max_consecutive_full_days: z.number().int().min(1).max(14),
  activity_free_travel_days: z.boolean(),
  require_kitchen: z.boolean().optional(), // ausente = false (motor)
});

export const cityPlanSchema = z.object({
  code: z.string().regex(/^[A-Z]{2,5}$/, "2 a 5 letras mayúsculas"),
  name: z.string().regex(/^[\p{L} .'-]{1,40}$/u).nullable().optional(), // espejo de CITY_NAME_PATTERN
  airports: z.array(iata).min(1).max(5),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  min_nights: z.number().int().min(1).max(21),
  max_nights: z.number().int().min(1).max(21),
  must_do: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).max(10),
});

export const tripRequestSchema = z.object({
  // espejo de engine/app/domain/models.py::CASE_KEY_PATTERN (otro runtime)
  case_key: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable(),
  origin_airports: z.array(iata).min(1).max(5),
  cities: z.array(cityPlanSchema).min(1).max(4),
  fixed_order: z.boolean(),
  first_checkin_from: isoDate,
  first_checkin_to: isoDate,
  total_nights_min: z.number().int().min(1).max(60),
  total_nights_max: z.number().int().min(1).max(60),
  pax: z.number().int().min(1).max(9),
  budget_minor: z.number().int().min(0).max(10 ** 10),
  currency: z.literal("USD"),
  constraints: constraintsSchema,
  top_n: z.number().int().min(1).max(10),
});

export type TripRequest = z.infer<typeof tripRequestSchema>;
export type Constraints = TripRequest["constraints"];
