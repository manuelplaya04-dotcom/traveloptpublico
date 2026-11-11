// Port exacto de engine/app/optimizer/{skeletons,filters}.py para los vuelos: qué ofertas sirven a cada tramo
// del itinerario elegido, cuáles se descartan y cuánto cuestan. Debe conciliar al centavo con el motor.
import type { Constraints, TripRequest } from "@/lib/contracts";
import type { FlightOffer, ItineraryPayload } from "@/lib/types";

export type Leg = {
  index: number;
  from: string; // código de ciudad o "HOME"
  to: string;
  originAirports: string[];
  destAirports: string[];
  departDates: string[]; // YYYY-MM-DD admitidas
  arriveOn: string | null; // debe llegar ese día (check-in); null = regreso a casa
};

export type FlightOption = {
  offer: FlightOffer;
  costMinor: number;
  rejection: string | null; // motivo del filtro duro, igual que el embudo del motor
};

const day = (iso: string) => iso.slice(0, 10);
const minutes = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const prevDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

export function legsFor(req: TripRequest, it: ItineraryPayload): Leg[] {
  const airports = (code: string) => req.cities.find((c) => c.code === code)?.airports ?? [];
  const stays = it.stays;
  const first = stays[0];
  const legs: Leg[] = [{
    index: 0, from: "HOME", to: first.city, originAirports: req.origin_airports, destAirports: airports(first.city),
    departDates: req.constraints.allow_overnight_outbound ? [prevDay(first.check_in), first.check_in] : [first.check_in],
    arriveOn: first.check_in,
  }];
  for (let i = 1; i < stays.length; i++) {
    legs.push({
      index: i, from: stays[i - 1].city, to: stays[i].city, originAirports: airports(stays[i - 1].city),
      destAirports: airports(stays[i].city), departDates: [stays[i].check_in], arriveOn: stays[i].check_in,
    });
  }
  const last = stays[stays.length - 1];
  legs.push({
    index: stays.length, from: last.city, to: "HOME", originAirports: airports(last.city),
    destAirports: req.origin_airports, departDates: [last.check_out], arriveOn: null,
  });
  return legs;
}

export function legMatches(f: FlightOffer, leg: Leg): boolean {
  return leg.originAirports.includes(f.origin) && leg.destAirports.includes(f.destination)
    && leg.departDates.includes(day(f.depart_at)) && (leg.arriveOn === null || day(f.arrive_at) === leg.arriveOn);
}

export function flightRejection(f: FlightOffer, leg: Leg, c: Constraints, pax: number): string | null {
  if (f.stops > c.max_stops) return "flight.too_many_stops";
  if (minutes(f.depart_at) < c.earliest_departure_hour * 60) return "flight.departs_too_early";
  if (leg.arriveOn !== null && minutes(f.arrive_at) > c.latest_arrival_hour * 60) return "flight.arrives_too_late";
  if (f.seats_available < pax) return "flight.insufficient_seats";
  return null;
}

export function flightCost(f: FlightOffer, c: Constraints, pax: number): number {
  const extraBags = Math.max(0, c.checked_bags_per_pax - f.included_bags);
  return pax * (f.price_per_pax_minor + extraBags * f.bag_fee_minor);
}

// Opciones por tramo: primero las elegibles (de menor a mayor costo), después las descartadas.
export function legOptions(leg: Leg, offers: FlightOffer[], req: TripRequest): FlightOption[] {
  return offers
    .filter((f) => legMatches(f, leg))
    .map((offer) => ({
      offer,
      costMinor: flightCost(offer, req.constraints, req.pax),
      rejection: flightRejection(offer, leg, req.constraints, req.pax),
    }))
    .sort((a, b) => Number(!!a.rejection) - Number(!!b.rejection) || a.costMinor - b.costMinor
      || a.offer.id.localeCompare(b.offer.id));
}
